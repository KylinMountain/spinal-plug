import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EventEnvelope, ProjectSpace } from "@mind-palace/protocol";
import { MindPalaceDatabase } from "./index.js";
import { ProjectHandoffService } from "./project-handoff-service.js";
import { ProjectMemoryService } from "./project-memory-service.js";

const space: ProjectSpace = {
  schema: "mind-palace.project-space/v0.1",
  spaceId: "spc_handoff",
  type: "project",
  displayName: "payments"
};

function openTestDatabase(): MindPalaceDatabase {
  const directory = mkdtempSync(join(tmpdir(), "mind-palace-handoff-"));
  const database = new MindPalaceDatabase(join(directory, "local.db"));
  database.init();
  return database;
}

test("checkpoint is durable work state and appears in the next boot projection", () => {
  const database = openTestDatabase();
  const handoffs = new ProjectHandoffService(database);
  const checkpoint = handoffs.checkpoint({
    space,
    title: "Payment migration handoff",
    completed: ["Created the dual-write schema migration."],
    decisions: ["Keep old consumers compatible for seven days."],
    openTasks: ["Update PaymentConsumer idempotency."],
    blockers: ["Staging database permission is missing."],
    nextAction: "Inspect PaymentConsumer retry handling.",
    artifactRefs: ["migrations/20260724_payment.sql"],
    runtimeContext: { missionId: "payments-migration", branchId: "codex-mac" }
  });

  assert.equal(database.latestCheckpoint(space.spaceId)?.checkpointId, checkpoint.checkpointId);
  assert.equal(database.listPendingOutboxForSpace(space.spaceId)[0].eventType, "checkpoint.created");
  const boot = new ProjectMemoryService(database).createBootProjection(space);
  assert.match(boot.content, /mind-palace_handoff/);
  assert.match(boot.content, /Update PaymentConsumer idempotency/);
});

test("remote checkpoint events are idempotently materialized without an outbox echo", () => {
  const source = openTestDatabase();
  const checkpoint = new ProjectHandoffService(source).checkpoint({
    space,
    title: "Remote handoff",
    openTasks: ["Continue on another agent."],
    nextAction: "Open the migration plan."
  });
  const event = source.listPendingOutboxForSpace(space.spaceId)[0] as EventEnvelope;
  const target = openTestDatabase();

  assert.equal(target.applyRemoteCheckpointEvents([event]), 1);
  assert.equal(target.applyRemoteCheckpointEvents([event]), 0);
  assert.equal(target.latestCheckpoint(space.spaceId)?.checkpointId, checkpoint.checkpointId);
  assert.equal(target.listPendingOutboxForSpace(space.spaceId).length, 0);
});
