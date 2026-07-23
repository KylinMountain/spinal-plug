import { DatabaseSync } from "node:sqlite";
import type {
  EventEnvelope,
  MemoryCompilation,
  MemoryDispute,
  MemoryRecord,
  ProjectSnapshot,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@mind-palace/protocol";
import { MemoryCompiler } from "./memory-compiler.js";

interface StoredEvent {
  sequence: number;
  event: EventEnvelope;
}

const schema = `
CREATE TABLE IF NOT EXISTS remote_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  space_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remote_events_space_sequence
  ON remote_events(space_id, sequence);

CREATE TABLE IF NOT EXISTS canonical_memories (
  space_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  status TEXT NOT NULL,
  semantic_key TEXT,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (space_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_canonical_memories_space_status
  ON canonical_memories(space_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_disputes (
  space_id TEXT NOT NULL,
  dispute_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (space_id, dispute_id)
);
`;

function cursorFor(sequence: number): string {
  return `cur:${sequence}`;
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^cur:(\d+)$/.exec(cursor);
  if (!match) throw new Error(`Invalid sync cursor: ${cursor}`);
  return Number(match[1]);
}

function parseStoredEvent(row: Record<string, unknown>): StoredEvent {
  return {
    sequence: Number(row.sequence),
    event: JSON.parse(String(row.payload_json)) as EventEnvelope
  };
}

/** Durable server implementation for local development and single-node deployment. */
export class PersistentSyncServer {
  private readonly database: DatabaseSync;
  private readonly compiler = new MemoryCompiler();

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec(schema);
    this.rebuildAllSpaces();
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const acceptedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    const exists = this.database.prepare("SELECT 1 FROM remote_events WHERE event_id = ? LIMIT 1");
    const insert = this.database.prepare(`
      INSERT INTO remote_events (event_id, space_id, created_at, payload_json)
      VALUES (@eventId, @spaceId, @createdAt, @payloadJson)
    `);
    try {
      this.database.exec("BEGIN IMMEDIATE TRANSACTION;");
      for (const event of request.events) {
        if (event.spaceId !== request.spaceId) {
          throw new Error(`Event ${event.eventId} does not belong to requested Project Space.`);
        }
        if (exists.get(event.eventId) !== undefined) {
          duplicateEventIds.push(event.eventId);
          continue;
        }
        insert.run({
          eventId: event.eventId,
          spaceId: event.spaceId,
          createdAt: event.createdAt,
          payloadJson: JSON.stringify(event)
        });
        acceptedEventIds.push(event.eventId);
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
    this.compileSpace(request.spaceId);

    return {
      acceptedEventIds,
      duplicateEventIds,
      serverCursor: cursorFor(this.latestSequence(request.spaceId))
    };
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const after = parseCursor(request.cursor);
    const limit = Math.min(Math.max(request.limit ?? 50, 1), 200);
    const rows = this.database.prepare(`
      SELECT sequence, payload_json FROM remote_events
      WHERE space_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(request.spaceId, after, limit + 1) as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(parseStoredEvent);
    const lastSequence = page.at(-1)?.sequence ?? after;
    return {
      events: page.map(item => item.event),
      nextCursor: cursorFor(lastSequence),
      hasMore
    };
  }

  snapshot(spaceId: string): ProjectSnapshot {
    const compilation = this.compilation(spaceId);
    return {
      schema: "mind-palace.project-snapshot/v0.1",
      spaceId,
      cursor: cursorFor(this.latestSequence(spaceId)),
      generatedAt: new Date().toISOString(),
      memories: compilation.active,
      candidates: compilation.candidates,
      disputes: compilation.disputes,
      superseded: compilation.superseded
    };
  }

  compilation(spaceId: string): MemoryCompilation {
    const memoryRows = this.database.prepare(`
      SELECT payload_json FROM canonical_memories
      WHERE space_id = ? ORDER BY updated_at DESC, memory_id ASC
    `).all(spaceId) as Record<string, unknown>[];
    const memories = memoryRows.map(row => JSON.parse(String(row.payload_json)) as MemoryRecord);
    const disputeRows = this.database.prepare(`
      SELECT payload_json FROM memory_disputes
      WHERE space_id = ? ORDER BY created_at ASC, dispute_id ASC
    `).all(spaceId) as Record<string, unknown>[];
    const disputes = disputeRows.map(row => JSON.parse(String(row.payload_json)) as MemoryDispute);
    return {
      spaceId,
      generatedAt: new Date().toISOString(),
      active: memories.filter(memory => memory.status === "active"),
      candidates: memories.filter(memory => memory.status === "candidate"),
      disputed: memories.filter(memory => memory.status === "disputed"),
      superseded: memories.filter(memory => memory.status === "superseded"),
      deleted: memories.filter(memory => memory.status === "deleted"),
      disputes
    };
  }

  close(): void {
    this.database.close();
  }

  private latestSequence(spaceId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM remote_events WHERE space_id = ?
    `).get(spaceId) as Record<string, unknown>;
    return Number(row.sequence);
  }

  private compileSpace(spaceId: string): void {
    const rows = this.database.prepare(`
      SELECT sequence, payload_json FROM remote_events
      WHERE space_id = ? ORDER BY sequence ASC
    `).all(spaceId) as Record<string, unknown>[];
    const compilation = this.compiler.compile(spaceId, rows.map(parseStoredEvent));
    const memories = [
      ...compilation.active,
      ...compilation.candidates,
      ...compilation.disputed,
      ...compilation.superseded,
      ...compilation.deleted
    ];
    const deleteMemories = this.database.prepare("DELETE FROM canonical_memories WHERE space_id = ?");
    const deleteDisputes = this.database.prepare("DELETE FROM memory_disputes WHERE space_id = ?");
    const insertMemory = this.database.prepare(`
      INSERT INTO canonical_memories (
        space_id, memory_id, status, semantic_key, updated_at, payload_json
      ) VALUES (
        @spaceId, @memoryId, @status, @semanticKey, @updatedAt, @payloadJson
      )
    `);
    const insertDispute = this.database.prepare(`
      INSERT INTO memory_disputes (
        space_id, dispute_id, status, created_at, payload_json
      ) VALUES (
        @spaceId, @disputeId, @status, @createdAt, @payloadJson
      )
    `);
    try {
      this.database.exec("BEGIN IMMEDIATE TRANSACTION;");
      deleteMemories.run(spaceId);
      deleteDisputes.run(spaceId);
      for (const memory of memories) {
        insertMemory.run({
          spaceId,
          memoryId: memory.memoryId,
          status: memory.status,
          semanticKey: memory.semanticKey ?? null,
          updatedAt: memory.updatedAt,
          payloadJson: JSON.stringify(memory)
        });
      }
      for (const dispute of compilation.disputes) {
        insertDispute.run({
          spaceId,
          disputeId: dispute.disputeId,
          status: dispute.status,
          createdAt: dispute.createdAt,
          payloadJson: JSON.stringify(dispute)
        });
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private rebuildAllSpaces(): void {
    const rows = this.database.prepare(
      "SELECT DISTINCT space_id FROM remote_events ORDER BY space_id ASC"
    ).all() as Record<string, unknown>[];
    for (const row of rows) this.compileSpace(String(row.space_id));
  }
}
