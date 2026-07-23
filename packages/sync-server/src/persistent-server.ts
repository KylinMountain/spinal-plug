import { DatabaseSync } from "node:sqlite";
import type {
  EventEnvelope,
  MemoryPayload,
  MemoryRecord,
  ProjectSnapshot,
  SyncPullRequest,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse
} from "@mind-palace/protocol";

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

function materialize(events: StoredEvent[], spaceId: string): MemoryRecord[] {
  const records = new Map<string, MemoryRecord>();
  for (const { event } of events) {
    if (!event.eventType.startsWith("memory.")) continue;
    const payload = event.payload as Partial<MemoryPayload>;
    if (!payload.memoryId || !payload.kind || !payload.title || !payload.statement) continue;
    const existing = records.get(payload.memoryId);
    records.set(payload.memoryId, {
      schema: "mind-palace.memory-record/v0.1",
      memoryId: payload.memoryId,
      spaceId,
      kind: payload.kind,
      title: payload.title,
      statement: payload.statement,
      why: payload.why,
      howToApply: payload.howToApply,
      references: payload.references ?? [],
      status: event.eventType === "memory.deleted" ? "deleted" : "active",
      createdFromEventId: existing?.createdFromEventId ?? event.eventId,
      lastUpdatedFromEventId: event.eventId,
      createdAt: existing?.createdAt ?? event.createdAt,
      updatedAt: event.createdAt
    });
  }
  return [...records.values()].filter(memory => memory.status === "active");
}

/** Durable server implementation for local development and single-node deployment. */
export class PersistentSyncServer {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec(schema);
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
    const rows = this.database.prepare(`
      SELECT sequence, payload_json FROM remote_events
      WHERE space_id = ? ORDER BY sequence ASC
    `).all(spaceId) as Record<string, unknown>[];
    const events = rows.map(parseStoredEvent);
    return {
      schema: "mind-palace.project-snapshot/v0.1",
      spaceId,
      cursor: cursorFor(events.at(-1)?.sequence ?? 0),
      generatedAt: new Date().toISOString(),
      memories: materialize(events, spaceId)
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
}
