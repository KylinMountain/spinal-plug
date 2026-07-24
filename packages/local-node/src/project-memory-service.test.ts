import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ProjectSpace } from "@mind-palace/protocol";
import { MindPalaceDatabase } from "./index.js";
import { ProjectMemoryService } from "./project-memory-service.js";

const space: ProjectSpace = {
  schema: "mind-palace.project-space/v0.1",
  spaceId: "spc_local_test",
  type: "project",
  displayName: "local-test"
};

function openTestDatabase(): { database: MindPalaceDatabase; service: ProjectMemoryService } {
  const directory = mkdtempSync(join(tmpdir(), "mind-palace-local-"));
  const database = new MindPalaceDatabase(join(directory, "local.db"));
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
