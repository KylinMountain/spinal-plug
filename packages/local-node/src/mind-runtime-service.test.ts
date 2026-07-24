import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Incarnation, MindCapsule, ProjectSpace } from "@mind-palace/protocol";
import { InMemorySyncServer } from "@mind-palace/sync-server";
import { MindPalaceDatabase } from "./index.js";
import { MindRuntimeService } from "./mind-runtime-service.js";
import { MindPalaceSyncClient } from "./sync-client.js";

const space: ProjectSpace = {
  schema: "mind-palace.project-space/v0.1",
  spaceId: "spc_runtime",
  type: "project",
  displayName: "payments"
};

function openDatabase(): MindPalaceDatabase {
  const database = new MindPalaceDatabase(join(mkdtempSync(join(tmpdir(), "mind-palace-runtime-")), "local.db"));
  database.init();
  return database;
}

test("Mind Core compiles a capsule and incarnates it without polluting Canonical Memory", async () => {
  const source = openDatabase();
  const runtime = new MindRuntimeService(source, { accountId: "local", personaId: "persona_work" });
  const core = runtime.createMindCore({ space, displayName: "Kylin Work", syncProfile: { pullMode: "follow_stable" } });
  const role = runtime.createRoleProfile({
    space,
    mindId: core.mindId,
    displayName: "Senior Coding Agent",
    directives: ["Verify current repository state before acting."],
    requiredCapabilities: ["filesystem", "git"]
  });
  const mission = runtime.createMission({
    space,
    mindId: core.mindId,
    title: "Payment migration",
    objective: "Move payment storage without downtime.",
    successCriteria: ["Legacy consumers remain compatible for seven days."]
  });
  const graph = runtime.upsertTaskGraph({
    space,
    mindId: core.mindId,
    missionId: mission.missionId,
    tasks: [{
      taskId: "task_consumer",
      title: "Update PaymentConsumer",
      status: "in_progress",
      dependsOn: [],
      nextAction: "Inspect idempotency handling."
    }]
  });
  const capsule = runtime.compileCapsule({
    space,
    mindId: core.mindId,
    roleProfileId: role.roleProfileId,
    missionId: mission.missionId,
    taskGraphId: graph.taskGraphId,
    baseSnapshotId: "snap_42"
  });
  const incarnation = runtime.spawn({
    space,
    capsuleId: capsule.capsuleId,
    host: "codex",
    deviceId: "device_mac",
    sessionId: "session_01"
  });

  assert.match(capsule.bootContext, /Senior Coding Agent/);
  assert.match(capsule.bootContext, /Update PaymentConsumer/);
  assert.equal(source.listMemories(space.spaceId).length, 0);
  assert.equal(source.listRuntimeEntities(space.spaceId).length, 6);
  assert.equal(source.listPendingOutboxForSpace(space.spaceId).length, 6);

  const controlPlane = new InMemorySyncServer();
  const sourceClient = new MindPalaceSyncClient(source, controlPlane);
  assert.equal((await sourceClient.publish(space.spaceId, "device_mac")).pushed, 6);

  const target = openDatabase();
  const result = await new MindPalaceSyncClient(target, controlPlane).fetch(space.spaceId, "device_linux");
  assert.equal(result.runtimeEntitiesStored, 6);
  assert.equal(target.getRuntimeEntity<MindCapsule>(capsule.capsuleId)?.missionId, mission.missionId);
  assert.equal(target.getRuntimeEntity<Incarnation>(incarnation.incarnationId)?.host, "codex");

  const resumed = new MindRuntimeService(target).setIncarnationStatus(incarnation.incarnationId, "hibernated");
  assert.equal(resumed.status, "hibernated");
  assert.equal(target.listPendingOutboxForSpace(space.spaceId)[0].eventType, "runtime.incarnation.updated");
});
