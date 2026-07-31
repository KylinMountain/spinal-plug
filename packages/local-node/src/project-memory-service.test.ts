import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EventEnvelope, ProjectSpace } from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { ProjectMemoryService } from "./project-memory-service.js";

const space: ProjectSpace = {
  schema: "spinal-plug.project-space/v0.1",
  spaceId: "spc_local_test",
  type: "project",
  displayName: "local-test"
};

function openTestDatabase(): { database: SpinalPlugDatabase; service: ProjectMemoryService } {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-local-"));
  const database = new SpinalPlugDatabase(join(directory, "local.db"));
  database.init();
  return { database, service: new ProjectMemoryService(database) };
}

test("persists candidate provenance and promotes it explicitly", () => {
  const { database, service } = openTestDatabase();
  const candidate = service.remember({
    space,
    kind: "decision",
    statement: "Use Kafka",
    semanticKey: "decision:queue",
    origin: "agent_inferred",
    confidence: 0.74,
    asCandidate: true
  });

  assert.equal(database.getMemory(candidate.memoryId)?.status, "candidate");
  assert.equal(database.getMemory(candidate.memoryId)?.origin, "agent_inferred");
  assert.equal(database.getMemory(candidate.memoryId)?.confidence, 0.74);
  const heldCandidate = database.listHeldOutboxForSpace(space.spaceId)[0];
  assert.equal(heldCandidate.eventType, "memory.candidate.created");

  const promoted = service.promote(space, candidate.memoryId);
  assert.equal(promoted.status, "active");
  assert.equal(promoted.sourceEventIds?.length, 2);
  assert.equal(database.listActiveMemories(space.spaceId)[0].memoryId, candidate.memoryId);
  assert.deepEqual(
    database.listPendingOutboxForSpace(space.spaceId).map(event => event.eventType).sort(),
    ["memory.candidate.created", "memory.promoted"]
  );
});

test("marks explicit memory with user provenance by default", () => {
  const { database, service } = openTestDatabase();
  const memory = service.remember({
    space,
    kind: "directive",
    statement: "Run integration tests against a real database"
  });
  const event = database.listPendingOutboxForSpace(space.spaceId)[0];
  const payload = event.payload as Record<string, unknown>;

  assert.equal(memory.origin, "user_explicit");
  assert.equal(memory.confidence, 1);
  assert.equal(payload.origin, "user_explicit");
  assert.equal(payload.confidence, 1);
});

test("rejects new secret material and excludes legacy secret records from projections", () => {
  const { database, service } = openTestDatabase();

  assert.throws(
    () => service.remember({
      space,
      kind: "context",
      statement: "password=local-test-credential-20260728"
    }),
    /Refusing to store likely secret material/
  );
  assert.throws(
    () => service.remember({
      space,
      kind: "context",
      statement: "测试设备密码 local-test-credential-20260728"
    }),
    /Refusing to store likely secret material/
  );

  const safeMemory = service.remember({
    space,
    kind: "context",
    statement: "The staging environment uses a managed secret reference."
  });
  assert.throws(
    () => service.update(space, {
      memoryId: safeMemory.memoryId,
      statement: "api_key: local-test-token-20260728"
    }),
    /Refusing to store likely secret material/
  );

  const legacyMemory = {
    ...safeMemory,
    memoryId: "mem_legacy_secret",
    title: "Legacy secret record",
    statement: "password=local-test-credential-20260728",
    createdFromEventId: "evt_legacy_secret",
    lastUpdatedFromEventId: "evt_legacy_secret",
    sourceEventIds: ["evt_legacy_secret"]
  };
  database.recordMemoryMutation({
    schemaVersion: 1,
    eventId: "evt_legacy_secret",
    eventType: "memory.created",
    eventVersion: 1,
    accountId: "local",
    personaId: "persona_default",
    spaceId: space.spaceId,
    actor: {
      deviceId: "device:test",
      agentInstallationId: "test",
      host: "test",
      sessionId: "test",
      adapterVersion: "test"
    },
    causality: { parentEventIds: [] },
    runtimeContext: {
      incarnationId: null,
      roleProfileId: null,
      missionId: null,
      branchId: null,
      taskCheckpointId: null
    },
    payload: {
      memoryId: legacyMemory.memoryId,
      kind: legacyMemory.kind,
      title: legacyMemory.title,
      statement: legacyMemory.statement,
      origin: legacyMemory.origin,
      confidence: legacyMemory.confidence,
      observedAt: legacyMemory.updatedAt
    },
    createdAt: legacyMemory.updatedAt,
    idempotencyKey: "evt_legacy_secret"
  }, legacyMemory);

  assert.equal(database.getMemory(legacyMemory.memoryId)?.memoryId, legacyMemory.memoryId);
  assert.equal(service.list(space).some(memory => memory.memoryId === legacyMemory.memoryId), false);
  assert.doesNotMatch(service.createBootProjection(space).content, /Legacy secret record/);
});

test("a remote memory event with an unsupported kind is refused", () => {
  // The protocol schema declares kind as an enum, but the apply path only
  // checked it for truthiness — and host projections interpolate it into their
  // own formats, so a free string reaches YAML on another device.
  const { database } = openTestDatabase();
  const event = {
    schemaVersion: 1,
    eventId: "evt_hostile_kind",
    eventType: "memory.created",
    eventVersion: 1,
    accountId: "local",
    personaId: "persona_default",
    spaceId: space.spaceId,
    actor: {
      deviceId: "device:other",
      agentInstallationId: "other",
      host: "spinal-plug",
      sessionId: "remote",
      adapterVersion: "0.1.0"
    },
    causality: { parentEventIds: [] },
    runtimeContext: {
      incarnationId: null,
      roleProfileId: null,
      missionId: null,
      branchId: null,
      taskCheckpointId: null
    },
    payload: {
      memoryId: "mem_remote_hostile",
      kind: "decision\ninjected: yes",
      title: "Hostile",
      statement: "Injected through the kind field"
    },
    createdAt: "2026-07-31T00:00:00.000Z",
    idempotencyKey: "evt_hostile_kind"
  } as unknown as EventEnvelope;

  assert.throws(() => database.applyRemoteMemoryEvents([event]), /Unsupported memory kind/);
  assert.equal(database.getMemory("mem_remote_hostile"), null, "the rejected event must not be stored");
});
