import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  CanonicalMemoryUpdate,
  MemoryRecord,
  ProjectSpace,
  SyncFetchRequest,
  SyncFetchResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { ProjectMemoryService } from "./project-memory-service.js";
import { SpinalPlugSyncClient, type SyncTransport } from "./sync-client.js";

const space: ProjectSpace = {
  schema: "spinal-plug.project-space/v0.1",
  spaceId: "spc_selective",
  type: "project",
  displayName: "selective"
};

function testDatabase(): SpinalPlugDatabase {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-selective-"));
  const database = new SpinalPlugDatabase(join(directory, "local.db"));
  database.init();
  return database;
}

function memory(memoryId: string, status: MemoryRecord["status"] = "active"): MemoryRecord {
  return {
    schema: "spinal-plug.memory-record/v0.1",
    memoryId,
    spaceId: space.spaceId,
    kind: "decision",
    title: memoryId,
    statement: `Statement for ${memoryId}`,
    references: [],
    status,
    semanticKey: `decision:${memoryId}`,
    origin: "user_explicit",
    confidence: 1,
    sourceEventIds: [`evt_${memoryId}`],
    createdFromEventId: `evt_${memoryId}`,
    lastUpdatedFromEventId: `evt_${memoryId}`,
    createdAt: "2026-07-23T12:00:00Z",
    updatedAt: "2026-07-23T12:00:00Z"
  };
}

function update(record: MemoryRecord, required = false): CanonicalMemoryUpdate {
  const kind = record.status === "deleted"
    ? "delete"
    : record.status === "candidate"
      ? "candidate"
      : record.status === "disputed"
        ? "dispute"
        : record.status === "superseded"
          ? "supersede"
          : "activate";
  return {
    schema: "spinal-plug.canonical-memory-update/v0.1",
    updateId: `upd_${record.memoryId}`,
    spaceId: space.spaceId,
    memoryId: record.memoryId,
    kind,
    required,
    sourceEventIds: record.sourceEventIds ?? [],
    memory: record,
    generatedAt: "2026-07-23T12:00:00Z"
  };
}

class UpdateTransport implements SyncTransport {
  private delivered = false;

  constructor(private readonly updates: CanonicalMemoryUpdate[]) {}

  async push(_request: SyncPushRequest): Promise<SyncPushResponse> {
    return { acceptedEventIds: [], duplicateEventIds: [], serverCursor: "cur:0" };
  }

  async pull(_request: SyncPullRequest): Promise<SyncPullResponse> {
    return { events: [], nextCursor: "cur:0", hasMore: false };
  }

  async fetchUpdates(_request: SyncFetchRequest): Promise<SyncFetchResponse> {
    if (this.delivered) return { updates: [], nextCursor: "cur:2", hasMore: false };
    this.delivered = true;
    return { updates: this.updates, nextCursor: "cur:2", hasMore: false };
  }
}

test("fetch and preview do not apply optional canonical updates", async () => {
  const database = testDatabase();
  const client = new SpinalPlugSyncClient(
    database,
    new UpdateTransport([update(memory("mem_a")), update(memory("mem_b"))])
  );

  const fetched = await client.fetch(space.spaceId, "device_a");
  assert.equal(fetched.pending, 2);
  assert.equal(database.getMemory("mem_a"), null);
  assert.deepEqual(
    client.preview(space.spaceId).pending.map(item => item.updateId),
    ["upd_mem_a", "upd_mem_b"]
  );

  const applied = client.apply(space.spaceId, ["upd_mem_b"]);
  assert.equal(applied.applied, 1);
  assert.equal(applied.remaining, 1);
  assert.equal(database.getMemory("mem_a"), null);
  assert.equal(database.getMemory("mem_b")?.status, "active");
});

test("required tombstones apply during fetch and cannot remain pending", async () => {
  const database = testDatabase();
  const service = new ProjectMemoryService(database);
  service.remember({
    space,
    memoryId: "mem_delete",
    kind: "decision",
    statement: "Old decision"
  });
  const deletion = memory("mem_delete", "deleted");
  const client = new SpinalPlugSyncClient(
    database,
    new UpdateTransport([update(deletion, true)])
  );

  const fetched = await client.fetch(space.spaceId, "device_a");
  assert.equal(fetched.requiredApplied, 1);
  assert.equal(fetched.pending, 0);
  assert.equal(database.getMemory("mem_delete")?.status, "deleted");
  assert.equal(client.preview(space.spaceId).requiredUpdateIds.length, 0);
});

class HandoffTransport implements SyncTransport {
  private delivered = false;

  async push(_request: SyncPushRequest): Promise<SyncPushResponse> {
    return { acceptedEventIds: [], duplicateEventIds: [], serverCursor: "cur:0" };
  }

  async pull(_request: SyncPullRequest): Promise<SyncPullResponse> {
    if (this.delivered) return { events: [], nextCursor: "cur:1", hasMore: false };
    this.delivered = true;
    return {
      events: [{
        schemaVersion: 1,
        eventId: "evt_handoff_remote",
        eventType: "handoff.created",
        eventVersion: 1,
        accountId: "local",
        personaId: "persona_default",
        spaceId: space.spaceId,
        actor: {
          deviceId: "device_remote",
          agentInstallationId: "claude-code",
          host: "claude-code",
          sessionId: "remote_session",
          adapterVersion: "0.1.0"
        },
        causality: { parentEventIds: [] },
        runtimeContext: { branchId: "claude-linux" },
        payload: {
          handoff: {
            schema: "spinal-plug.project-handoff/v0.1",
            handoffId: "hnd_remote",
            spaceId: space.spaceId,
            title: "Remote handoff",
            completed: ["Created schema"],
            decisions: [],
            openTasks: ["Update consumer"],
            blockers: [],
            nextAction: "Open PaymentConsumer",
            artifactRefs: [],
            status: "active",
            sourceEventIds: ["evt_handoff_remote"],
            createdAt: "2026-07-24T12:00:00Z",
            updatedAt: "2026-07-24T12:00:00Z"
          }
        },
        createdAt: "2026-07-24T12:00:00Z",
        idempotencyKey: "evt_handoff_remote"
      }],
      nextCursor: "cur:1",
      hasMore: false
    };
  }

  async fetchUpdates(_request: SyncFetchRequest): Promise<SyncFetchResponse> {
    return { updates: [], nextCursor: "cur:0", hasMore: false };
  }
}

test("fetch materializes remote work-state handoffs for the next Agent boot", async () => {
  const database = testDatabase();
  const client = new SpinalPlugSyncClient(database, new HandoffTransport());
  const fetched = await client.fetch(space.spaceId, "device_local");

  assert.equal(fetched.handoffsStored, 1);
  assert.equal(database.latestHandoff(space.spaceId)?.nextAction, "Open PaymentConsumer");
  assert.equal(database.listPendingOutboxForSpace(space.spaceId).length, 0);
});
