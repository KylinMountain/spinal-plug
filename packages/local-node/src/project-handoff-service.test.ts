import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EventEnvelope, ProjectSpace } from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { ProjectHandoffService } from "./project-handoff-service.js";
import { ProjectMemoryService } from "./project-memory-service.js";

const space: ProjectSpace = {
  schema: "spinal-plug.project-space/v0.1",
  spaceId: "spc_handoff",
  type: "project",
  displayName: "payments"
};

function openTestDatabase(): SpinalPlugDatabase {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-handoff-"));
  const database = new SpinalPlugDatabase(join(directory, "local.db"));
  database.init();
  return database;
}

test("handoff is durable work state and appears in the next boot projection", () => {
  const database = openTestDatabase();
  const handoffs = new ProjectHandoffService(database);
  const handoff = handoffs.record({
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

  assert.equal(database.latestHandoff(space.spaceId)?.handoffId, handoff.handoffId);
  assert.equal(database.listPendingOutboxForSpace(space.spaceId)[0].eventType, "handoff.created");
  const boot = new ProjectMemoryService(database).createBootProjection(space);
  assert.match(boot.content, /spinal-plug_handoff/);
  assert.match(boot.content, /Update PaymentConsumer idempotency/);
});

test("remote handoff events are idempotently materialized without an outbox echo", () => {
  const source = openTestDatabase();
  const handoff = new ProjectHandoffService(source).record({
    space,
    title: "Remote handoff",
    openTasks: ["Continue on another agent."],
    nextAction: "Open the migration plan."
  });
  const event = source.listPendingOutboxForSpace(space.spaceId)[0] as EventEnvelope;
  const target = openTestDatabase();

  assert.equal(target.applyRemoteHandoffEvents([event]), 1);
  assert.equal(target.applyRemoteHandoffEvents([event]), 0);
  assert.equal(target.latestHandoff(space.spaceId)?.handoffId, handoff.handoffId);
  assert.equal(target.listPendingOutboxForSpace(space.spaceId).length, 0);
});

test("rejects likely secret material in handoffs", () => {
  const handoffs = new ProjectHandoffService(openTestDatabase());
  assert.throws(
    () => handoffs.record({
      space,
      title: "Unsafe handoff",
      summary: "password=local-test-credential-20260728"
    }),
    /Refusing to store likely secret material/
  );
});

test("init removes the orphaned pre-rename checkpoint table", () => {
  // The checkpoint→handoff rename created a new table beside the old one
  // instead of migrating it. Nothing has been released, so those rows are
  // development state — but an orphaned table reads like a live one.
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-legacy-"));
  const path = join(directory, "local.db");
  const legacy = new DatabaseSync(path);
  legacy.exec("CREATE TABLE project_checkpoints (checkpoint_id TEXT PRIMARY KEY)");
  legacy.exec("INSERT INTO project_checkpoints VALUES ('chk_old')");
  legacy.close();

  const database = new SpinalPlugDatabase(path);
  database.init();

  const inspector = new DatabaseSync(path, { readOnly: true });
  const tables = (inspector.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
    .map(row => row.name);
  inspector.close();
  assert.ok(!tables.includes("project_checkpoints"), "the legacy table must not survive init");
  assert.ok(tables.includes("project_handoffs"));
});
