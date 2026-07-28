import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EventEnvelope, SyncFetchRequest, SyncFetchResponse, SyncPullRequest, SyncPullResponse, SyncPushRequest, SyncPushResponse } from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { SpinalPlugSyncClient, type SyncTransport } from "./sync-client.js";

const spaceId = "spc_publish_secrets";

function testDatabase(): SpinalPlugDatabase {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-publish-"));
  const database = new SpinalPlugDatabase(join(directory, "local.db"));
  database.init();
  return database;
}

function memoryEvent(id: string, statement: string): EventEnvelope {
  return {
    schemaVersion: 1,
    eventId: id,
    eventType: "memory.created",
    eventVersion: 1,
    accountId: "acc_test",
    personaId: "persona_default",
    spaceId,
    actor: {
      deviceId: "device_test",
      agentInstallationId: "test",
      host: "test",
      sessionId: "test",
      adapterVersion: "0.1.0"
    },
    causality: { parentEventIds: [] },
    runtimeContext: {},
    payload: {
      memoryId: `mem_${id}`,
      kind: "decision",
      title: id,
      statement,
      origin: "user_explicit",
      confidence: 1
    },
    createdAt: "2026-07-28T12:00:00Z",
    idempotencyKey: id
  };
}

class RecordingTransport implements SyncTransport {
  pushed: SyncPushRequest["events"] = [];
  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    this.pushed.push(...request.events);
    return {
      acceptedEventIds: request.events.map(event => event.eventId),
      duplicateEventIds: [],
      serverCursor: "cur_test"
    };
  }
  async pull(_request: SyncPullRequest): Promise<SyncPullResponse> {
    throw new Error("not used");
  }
  async fetchUpdates(_request: SyncFetchRequest): Promise<SyncFetchResponse> {
    throw new Error("not used");
  }
}

test("publish never sends secret-shaped legacy events off the device", async () => {
  const database = testDatabase();
  database.appendEvent(memoryEvent("evt_secret", "The credential is password hunter2hunter2, rotate later."));
  database.appendEvent(memoryEvent("evt_clean", "Use pnpm as the only package manager."));

  const transport = new RecordingTransport();
  const result = await new SpinalPlugSyncClient(database, transport).publish(spaceId, "device_test");

  assert.equal(result.pushed, 1);
  assert.equal(result.skippedSecrets, 1);
  assert.deepEqual(
    transport.pushed.map(event => event.eventId),
    ["evt_clean"],
    "the secret event must not reach the transport"
  );
  // Both events leave the pending outbox: the secret one is marked delivered
  // so it cannot wedge later publishes, and stays in the local event log for
  // a future controlled cleanup.
  assert.equal(database.listPendingOutboxForSpace(spaceId).length, 0);
});
