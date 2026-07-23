import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryRecord, ProjectSpace } from "@mind-palace/protocol";

export interface CodexNativeMemoryWriteResult {
  threadId: string;
  updatedDatabases: string[];
  memoryCount: number;
}

function codexMemoryDatabasePaths(): string[] {
  const base = homedir();
  return [
    join(base, ".codex", "memories_1.sqlite"),
    join(base, ".codex", "sqlite", "memories_1.sqlite")
  ].filter(existsSync);
}

function renderRawMemory(space: ProjectSpace, memories: ReadonlyArray<MemoryRecord>): string {
  const entries = memories.map(memory => {
    const why = memory.why ? `\nreason: ${memory.why}` : "";
    const how = memory.howToApply ? `\napplication: ${memory.howToApply}` : "";
    return `- [${memory.kind}] ${memory.title}\n  ${memory.statement}${why}${how}`;
  });
  return [
    `description: Mind Palace synchronized durable memory for ${space.displayName}.`,
    `task: mind-palace-sync-${space.spaceId}`,
    "outcome: Reuse the following project decisions, constraints, and references when relevant; verify current code before acting.",
    "key_facts:",
    ...entries
  ].join("\n");
}

function renderRolloutSummary(space: ProjectSpace, memories: ReadonlyArray<MemoryRecord>): string {
  return [
    `# Mind Palace: ${space.displayName}`,
    "",
    "Synchronized durable project memory. Treat as historical context and verify current repository state.",
    "",
    ...memories.map(memory => `- **${memory.title}** (${memory.kind}): ${memory.statement}`)
  ].join("\n");
}

/**
 * Projects canonical Mind Palace records into Codex's private stage-1 memory
 * store. The record has a reserved thread ID, so no user-owned Codex rollout
 * is overwritten. This is intentionally isolated behind the Codex adapter:
 * the database format is private and must be revalidated after Codex upgrades.
 */
export class CodexNativeMemoryStore {
  materialize(space: ProjectSpace, memories: ReadonlyArray<MemoryRecord>): CodexNativeMemoryWriteResult {
    const threadId = `mind-palace:${space.spaceId}`;
    const sourceUpdatedAt = Date.now();
    const rawMemory = renderRawMemory(space, memories);
    const rolloutSummary = renderRolloutSummary(space, memories);
    const rolloutSlug = `mind-palace-${space.spaceId}`.slice(0, 80);
    const updatedDatabases: string[] = [];

    for (const databasePath of codexMemoryDatabasePaths()) {
      const database = new DatabaseSync(databasePath);
      try {
        database.exec("PRAGMA journal_mode = WAL;");
        database.exec("PRAGMA busy_timeout = 1000;");
        database.prepare(`
          INSERT INTO stage1_outputs (
            thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug,
            generated_at, selected_for_phase2, selected_for_phase2_source_updated_at
          ) VALUES (
            @threadId, @sourceUpdatedAt, @rawMemory, @rolloutSummary, @rolloutSlug,
            @generatedAt, 1, @sourceUpdatedAt
          )
          ON CONFLICT(thread_id) DO UPDATE SET
            source_updated_at = excluded.source_updated_at,
            raw_memory = excluded.raw_memory,
            rollout_summary = excluded.rollout_summary,
            rollout_slug = excluded.rollout_slug,
            generated_at = excluded.generated_at,
            selected_for_phase2 = 1,
            selected_for_phase2_source_updated_at = excluded.source_updated_at
          WHERE excluded.source_updated_at >= stage1_outputs.source_updated_at
        `).run({
          threadId,
          sourceUpdatedAt,
          rawMemory,
          rolloutSummary,
          rolloutSlug,
          generatedAt: sourceUpdatedAt
        });
        updatedDatabases.push(databasePath);
      } finally {
        database.close();
      }
    }

    return { threadId, updatedDatabases, memoryCount: memories.length };
  }
}
