import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ClaudeAutoMemoryImporter, ClaudeAutoMemoryMaterializer } from "@mind-palace/adapter-claude-code";
import { CodexNativeMemoryStore } from "@mind-palace/adapter-codex";
import { MindPalaceDatabase, MindPalaceSyncClient, ProjectMemoryService, type SyncTransport } from "@mind-palace/local-node";
import type {
  ProjectSpace,
  SyncFetchRequest,
  SyncFetchResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@mind-palace/protocol";
import { InMemorySyncServer } from "@mind-palace/sync-server";

const space: ProjectSpace = {
  schema: "mind-palace.project-space/v0.1",
  spaceId: "spc_cross_host",
  type: "project",
  displayName: "payments-service"
};

function localDatabase(name: string): MindPalaceDatabase {
  const directory = mkdtempSync(join(tmpdir(), `mind-palace-${name}-`));
  const database = new MindPalaceDatabase(join(directory, "mind-palace.db"));
  database.init();
  return database;
}

function createCodexMemoryDatabase(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE stage1_outputs (
        thread_id TEXT PRIMARY KEY,
        source_updated_at INTEGER NOT NULL,
        raw_memory TEXT NOT NULL,
        rollout_summary TEXT NOT NULL,
        rollout_slug TEXT,
        generated_at INTEGER NOT NULL,
        usage_count INTEGER,
        last_usage INTEGER,
        selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
        selected_for_phase2_source_updated_at INTEGER
      );
    `);
    database.prepare(`
      INSERT INTO stage1_outputs (
        thread_id, source_updated_at, raw_memory, rollout_summary, generated_at, selected_for_phase2
      ) VALUES ('user-thread', 1, 'user-owned memory', 'user-owned summary', 1, 0)
    `).run();
  } finally {
    database.close();
  }
}

test("Claude memory reaches Codex native storage and tombstones cannot revive it", async () => {
  const claudeDatabase = localDatabase("claude");
  const claudeService = new ProjectMemoryService(claudeDatabase, { accountId: "local", personaId: "persona_default" }, {
    deviceId: "device_claude",
    agentInstallationId: "claude-code",
    host: "claude-code",
    sessionId: "claude-session"
  });
  const claudeHome = mkdtempSync(join(tmpdir(), "mind-palace-claude-native-"));
  const claudeImporter = new ClaudeAutoMemoryImporter({ homeDirectory: claudeHome });
  const nativeDirectory = claudeImporter.memoryDirectory("/projects/payments-service");
  mkdirSync(nativeDirectory, { recursive: true });
  writeFileSync(
    join(nativeDirectory, "migration.md"),
    "# Seven day compatibility\n\nNew and legacy consumers must remain compatible for seven days.\n",
    "utf8"
  );
  const imported = claudeImporter.import(space, "/projects/payments-service");
  assert.equal(imported.candidates.length, 1);
  const importedMemory = imported.candidates[0];
  const created = claudeService.remember({
    space,
    memoryId: importedMemory.memoryId,
    kind: "decision",
    title: importedMemory.title,
    statement: importedMemory.statement,
    references: [importedMemory.sourceUri],
    semanticKey: importedMemory.semanticKey,
    origin: "host_native",
    confidence: 0.95
  });
  const event = claudeDatabase.listPendingOutboxForSpace(space.spaceId)[0];
  const controlPlane = new InMemorySyncServer();
  const claudeClient = new MindPalaceSyncClient(claudeDatabase, controlPlane);
  assert.equal((await claudeClient.publish(space.spaceId, "device_claude")).pushed, 1);
  assert.deepEqual(
    (await controlPlane.push({ spaceId: space.spaceId, deviceId: "device_claude", events: [event] })).duplicateEventIds,
    [event.eventId]
  );

  const codexDatabase = localDatabase("codex");
  const codexClient = new MindPalaceSyncClient(codexDatabase, controlPlane);
  const fetched = await codexClient.fetch(space.spaceId, "device_codex");
  assert.equal(fetched.pending, 1);
  assert.equal(codexClient.apply(space.spaceId).applied, 1);
  assert.equal(codexDatabase.getMemory(created.memoryId)?.statement, created.statement);

  const codexDirectory = mkdtempSync(join(tmpdir(), "mind-palace-codex-native-"));
  const codexNativeDatabase = join(codexDirectory, "memories_1.sqlite");
  createCodexMemoryDatabase(codexNativeDatabase);
  const nativeStore = new CodexNativeMemoryStore({
    databasePaths: () => [codexNativeDatabase],
    now: () => 123456789
  });
  nativeStore.materialize(space, codexDatabase.listActiveMemories(space.spaceId));
  const native = new DatabaseSync(codexNativeDatabase);
  try {
    const managed = native.prepare("SELECT raw_memory FROM stage1_outputs WHERE thread_id = ?").get(`mind-palace:${space.spaceId}`) as { raw_memory: string };
    const userOwned = native.prepare("SELECT raw_memory FROM stage1_outputs WHERE thread_id = 'user-thread'").get() as { raw_memory: string };
    assert.match(managed.raw_memory, /seven days/);
    assert.equal(userOwned.raw_memory, "user-owned memory");
  } finally {
    native.close();
  }

  const projection = new ClaudeAutoMemoryMaterializer({ homeDirectory: claudeHome });
  const claudeProjection = projection.materialize("/projects/payments-service", codexDatabase.listActiveMemories(space.spaceId));
  assert.match(readFileSync(claudeProjection.filePath, "utf8"), /Seven day compatibility/);
  assert.match(
    readFileSync(join(claudeHome, ".claude", "projects", "-projects-payments-service", "memory", "MEMORY.md"), "utf8"),
    /mind-palace:managed:start/
  );

  claudeService.forget(space, created.memoryId);
  assert.equal((await claudeClient.publish(space.spaceId, "device_claude")).pushed, 1);
  const deleted = await codexClient.fetch(space.spaceId, "device_codex");
  assert.equal(deleted.requiredApplied, 1);
  assert.equal(codexDatabase.getMemory(created.memoryId)?.status, "deleted");

  nativeStore.materialize(space, codexDatabase.listActiveMemories(space.spaceId));
  const afterDelete = new DatabaseSync(codexNativeDatabase);
  try {
    const managed = afterDelete.prepare("SELECT raw_memory FROM stage1_outputs WHERE thread_id = ?").get(`mind-palace:${space.spaceId}`) as { raw_memory: string };
    assert.doesNotMatch(managed.raw_memory, /seven days/);
  } finally {
    afterDelete.close();
  }
});

class FlakyTransport implements SyncTransport {
  private failuresRemaining = 1;

  constructor(private readonly delegate: InMemorySyncServer) {}

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("offline");
    }
    return this.delegate.push(request);
  }

  pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    return this.delegate.pull(request);
  }

  fetchUpdates(request: SyncFetchRequest): Promise<SyncFetchResponse> {
    return this.delegate.fetchUpdates(request);
  }
}

test("offline publication remains in the WAL outbox until a retry succeeds", async () => {
  const database = localDatabase("offline");
  const service = new ProjectMemoryService(database);
  service.remember({
    space,
    kind: "directive",
    statement: "Use a real database for integration tests."
  });
  const client = new MindPalaceSyncClient(database, new FlakyTransport(new InMemorySyncServer()));

  await assert.rejects(client.publish(space.spaceId, "device_offline"), /offline/);
  assert.equal(database.listPendingOutboxForSpace(space.spaceId).length, 1);
  assert.equal((await client.publish(space.spaceId, "device_offline")).pushed, 1);
  assert.equal(database.listPendingOutboxForSpace(space.spaceId).length, 0);
});
