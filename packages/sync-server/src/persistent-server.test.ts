import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EventEnvelope, EventType, MemoryOrigin, MemoryPayload } from "@spinal-plug/protocol";
import { PersistentSyncServer } from "./persistent-server.js";

const spaceId = "spc_compiler_test";

function memoryEvent(input: {
  id: string;
  memoryId: string;
  statement: string;
  semanticKey?: string;
  eventType?: EventType;
  origin?: MemoryOrigin;
  confidence?: number;
  parents?: string[];
  resolvesMemoryIds?: string[];
  createdAt?: string;
}): EventEnvelope {
  const payload: MemoryPayload = {
    memoryId: input.memoryId,
    kind: "decision",
    title: "Queue technology",
    statement: input.statement,
    semanticKey: input.semanticKey ?? "decision:queue-technology",
    origin: input.origin ?? "user_explicit",
    confidence: input.confidence ?? 1,
    resolvesMemoryIds: input.resolvesMemoryIds
  };
  return {
    schemaVersion: 1,
    eventId: input.id,
    eventType: input.eventType ?? "memory.created",
    eventVersion: 1,
    accountId: "acc_test",
    personaId: "persona_default",
    spaceId,
    actor: {
      deviceId: `device_${input.id}`,
      agentInstallationId: "test",
      host: "test",
      sessionId: `session_${input.id}`,
      adapterVersion: "0.1.0"
    },
    causality: {
      parentEventIds: input.parents ?? []
    },
    runtimeContext: {},
    payload,
    createdAt: input.createdAt ?? `2026-07-23T10:00:${input.id.slice(-2).padStart(2, "0")}Z`,
    idempotencyKey: input.id
  };
}

test("persistent server rebuilds compiled state after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-compiler-"));
  const databasePath = join(directory, "central.db");
  const events = [
    memoryEvent({ id: "evt_01", memoryId: "mem_kafka", statement: "Use Kafka" }),
    memoryEvent({ id: "evt_02", memoryId: "mem_nats", statement: "Use NATS" })
  ];
  const first = new PersistentSyncServer(databasePath);
  await first.push({ spaceId, deviceId: "device_a", events });
  assert.equal(first.snapshot(spaceId).disputes?.length, 1);
  first.close();

  const second = new PersistentSyncServer(databasePath);
  assert.equal(second.compilation(spaceId).disputed.length, 2);
  assert.equal(second.snapshot(spaceId).memories.length, 0);
  second.close();
});

test("fetch exposes compiled disputes instead of raw active variants", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-fetch-"));
  const server = new PersistentSyncServer(join(directory, "central.db"));
  await server.push({
    spaceId,
    deviceId: "device_a",
    events: [
      memoryEvent({ id: "evt_01", memoryId: "mem_kafka", statement: "Use Kafka" }),
      memoryEvent({ id: "evt_02", memoryId: "mem_nats", statement: "Use NATS" })
    ]
  });

  const fetched = await server.fetchUpdates({ spaceId, deviceId: "device_b" });
  assert.equal(fetched.updates.length, 2);
  assert.deepEqual(fetched.updates.map(update => update.kind).sort(), ["dispute", "dispute"]);
  assert.ok(fetched.updates.every(update => update.memory.status === "disputed"));
  server.close();
});

test("fetch marks tombstones as required updates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-delete-"));
  const server = new PersistentSyncServer(join(directory, "central.db"));
  const created = memoryEvent({
    id: "evt_01",
    memoryId: "mem_delete",
    statement: "Old decision",
    semanticKey: "decision:delete"
  });
  const deleted = memoryEvent({
    id: "evt_02",
    memoryId: "mem_delete",
    statement: "Old decision",
    semanticKey: "decision:delete",
    eventType: "memory.deleted",
    parents: ["evt_01"]
  });
  await server.push({ spaceId, deviceId: "device_a", events: [created, deleted] });

  const fetched = await server.fetchUpdates({ spaceId, deviceId: "device_b" });
  assert.equal(fetched.updates.length, 1);
  assert.equal(fetched.updates[0].kind, "delete");
  assert.equal(fetched.updates[0].required, true);
  server.close();
});

test("snapshot exposes work-state checkpoints without mixing them into memory compilation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-checkpoint-snapshot-"));
  const server = new PersistentSyncServer(join(directory, "central.db"));
  const checkpoint: EventEnvelope = {
    schemaVersion: 1,
    eventId: "evt_checkpoint",
    eventType: "checkpoint.created",
    eventVersion: 1,
    accountId: "acc_test",
    personaId: "persona_default",
    spaceId,
    actor: {
      deviceId: "device_a",
      agentInstallationId: "codex",
      host: "codex",
      sessionId: "session_a",
      adapterVersion: "0.1.0"
    },
    causality: { parentEventIds: [] },
    runtimeContext: { missionId: "payments-migration", branchId: "codex-mac" },
    payload: {
      checkpoint: {
        schema: "spinal-plug.project-checkpoint/v0.1",
        checkpointId: "chk_payments",
        spaceId,
        title: "Payment migration handoff",
        completed: ["Schema migration"],
        decisions: ["Use dual writes"],
        openTasks: ["Update consumer"],
        blockers: [],
        nextAction: "Open PaymentConsumer",
        artifactRefs: ["migrations/payment.sql"],
        status: "active",
        sourceEventIds: ["evt_checkpoint"],
        createdAt: "2026-07-24T12:00:00Z",
        updatedAt: "2026-07-24T12:00:00Z"
      }
    },
    createdAt: "2026-07-24T12:00:00Z",
    idempotencyKey: "evt_checkpoint"
  };
  await server.push({ spaceId, deviceId: "device_a", events: [checkpoint] });
  const snapshot = server.snapshot(spaceId);
  assert.equal(snapshot.memories.length, 0);
  assert.equal(snapshot.checkpoints?.[0]?.checkpointId, "chk_payments");
  server.close();
});
