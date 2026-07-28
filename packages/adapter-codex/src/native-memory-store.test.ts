import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { MemoryRecord, ProjectSpace } from "@spinal-plug/protocol";
import { CodexNativeMemoryStore } from "./native-memory-store.js";

const space: ProjectSpace = {
  schema: "spinal-plug.project-space/v0.1",
  spaceId: "spc_native_store_test",
  type: "project",
  displayName: "native-store-test"
};

const memory: MemoryRecord = {
  schema: "spinal-plug.memory-record/v0.1",
  memoryId: "mem_native_store_test",
  spaceId: space.spaceId,
  kind: "decision",
  title: "Native store isolation",
  statement: "Use an explicit database override for isolated Codex integration tests.",
  references: [],
  status: "active",
  origin: "user_explicit",
  confidence: 1,
  sourceEventIds: [],
  createdFromEventId: "evt_native_store_test",
  lastUpdatedFromEventId: "evt_native_store_test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

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
        selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
        selected_for_phase2_source_updated_at INTEGER
      );
    `);
  } finally {
    database.close();
  }
}

test("uses the explicit native-memory database override", () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "spinal-plug-codex-home-")), "memories_1.sqlite");
  createCodexMemoryDatabase(databasePath);
  const previous = process.env.SPINAL_PLUG_CODEX_MEMORY_DB;
  process.env.SPINAL_PLUG_CODEX_MEMORY_DB = databasePath;

  try {
    const result = new CodexNativeMemoryStore({ now: () => 123 }).materialize(space, [memory]);
    assert.deepEqual(result.updatedDatabases, [databasePath]);
    const database = new DatabaseSync(databasePath);
    try {
      const stored = database.prepare("SELECT raw_memory FROM stage1_outputs WHERE thread_id = ?")
        .get(`spinal-plug:${space.spaceId}`) as { raw_memory: string };
      assert.match(stored.raw_memory, /Native store isolation/);
    } finally {
      database.close();
    }
  } finally {
    if (previous === undefined) delete process.env.SPINAL_PLUG_CODEX_MEMORY_DB;
    else process.env.SPINAL_PLUG_CODEX_MEMORY_DB = previous;
  }
});

test("an explicit override path that does not exist is a configuration error", () => {
  const previous = process.env.SPINAL_PLUG_CODEX_MEMORY_DB;
  process.env.SPINAL_PLUG_CODEX_MEMORY_DB = join(tmpdir(), "spinal-plug-definitely-missing", "memories_1.sqlite");

  try {
    // Strict-explicit: a user-chosen path that is wrong must surface, not
    // silently disable the projection.
    assert.throws(
      () => new CodexNativeMemoryStore().materialize(space, [memory]),
      /SPINAL_PLUG_CODEX_MEMORY_DB does not exist/
    );
  } finally {
    if (previous === undefined) delete process.env.SPINAL_PLUG_CODEX_MEMORY_DB;
    else process.env.SPINAL_PLUG_CODEX_MEMORY_DB = previous;
  }
});
