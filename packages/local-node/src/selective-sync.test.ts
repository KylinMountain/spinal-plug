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
} from "@mind-palace/protocol";
import { MindPalaceDatabase } from "./index.js";
import { ProjectMemoryService } from "./project-memory-service.js";
import { MindPalaceSyncClient, type SyncTransport } from "./sync-client.js";

const space: ProjectSpace = {
  schema: "mind-palace.project-space/v0.1",
  spaceId: "spc_selective",
  type: "project",
  displayName: "selective"
};

function testDatabase(): MindPalaceDatabase {
  const directory = mkdtempSync(join(tmpdir(), "mind-palace-selective-"));
  const database = new MindPalaceDatabase(join(directory, "local.db"));
  database.init();
  return database;
}

function memory(memoryId: string, status: MemoryRecord["status"] = "active"): MemoryRecord {
  return {
    schema: "mind-palace.memory-record/v0.1",
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
    schema: "mind-palace.canonical-memory-update/v0.1",
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
  const client = new MindPalaceSyncClient(
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
  const client = new MindPalaceSyncClient(
    database,
    new UpdateTransport([update(deletion, true)])
  );

  const fetched = await client.fetch(space.spaceId, "device_a");
  assert.equal(fetched.requiredApplied, 1);
  assert.equal(fetched.pending, 0);
  assert.equal(database.getMemory("mem_delete")?.status, "deleted");
  assert.equal(client.preview(space.spaceId).requiredUpdateIds.length, 0);
});
