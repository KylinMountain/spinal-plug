import { DatabaseSync } from "node:sqlite";
import type { EventEnvelope, MemoryPayload, MemoryRecord, SyncCursor } from "@mind-palace/protocol";
import { sqliteSchema } from "./schema.js";

function parseMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    schema: "mind-palace.memory-record/v0.1",
    memoryId: String(row.memory_id),
    spaceId: String(row.space_id),
    kind: row.kind as MemoryRecord["kind"],
    title: String(row.title),
    statement: String(row.statement),
    why: row.why_text ? String(row.why_text) : undefined,
    howToApply: row.how_to_apply ? String(row.how_to_apply) : undefined,
    references: JSON.parse(String(row.references_json)) as string[],
    status: row.status as MemoryRecord["status"],
    createdFromEventId: String(row.created_from_event_id),
    lastUpdatedFromEventId: String(row.last_updated_from_event_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class MindPalaceDatabase {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
  }

  init(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(sqliteSchema);
  }

  appendEvent(event: EventEnvelope): void {
    const insertEvent = this.db.prepare(`
      INSERT INTO events (event_id, space_id, event_type, created_at, idempotency_key, payload_json)
      VALUES (@eventId, @spaceId, @eventType, @createdAt, @idempotencyKey, @payloadJson)
      ON CONFLICT(event_id) DO NOTHING
    `);

    const enqueueOutbox = this.db.prepare(`
      INSERT INTO outbox (event_id, space_id, status, attempts, available_at, created_at)
      VALUES (@eventId, @spaceId, 'pending', 0, @availableAt, @createdAt)
      ON CONFLICT(event_id) DO NOTHING
    `);

    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      insertEvent.run({
        eventId: event.eventId,
        spaceId: event.spaceId,
        eventType: event.eventType,
        createdAt: event.createdAt,
        idempotencyKey: event.idempotencyKey,
        payloadJson: JSON.stringify(event)
      });

      enqueueOutbox.run({
        eventId: event.eventId,
        spaceId: event.spaceId,
        availableAt: event.createdAt,
        createdAt: event.createdAt
      });
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  upsertMemory(memory: MemoryRecord): void {
    const statement = this.db.prepare(`
      INSERT INTO memories (
        memory_id, space_id, kind, title, statement, why_text, how_to_apply,
        references_json, status, created_from_event_id, last_updated_from_event_id,
        created_at, updated_at
      ) VALUES (
        @memoryId, @spaceId, @kind, @title, @statement, @whyText, @howToApply,
        @referencesJson, @status, @createdFromEventId, @lastUpdatedFromEventId,
        @createdAt, @updatedAt
      )
      ON CONFLICT(memory_id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        statement = excluded.statement,
        why_text = excluded.why_text,
        how_to_apply = excluded.how_to_apply,
        references_json = excluded.references_json,
        status = excluded.status,
        last_updated_from_event_id = excluded.last_updated_from_event_id,
        updated_at = excluded.updated_at
    `);

    statement.run({
      memoryId: memory.memoryId,
      spaceId: memory.spaceId,
      kind: memory.kind,
      title: memory.title,
      statement: memory.statement,
      whyText: memory.why ?? null,
      howToApply: memory.howToApply ?? null,
      referencesJson: JSON.stringify(memory.references),
      status: memory.status,
      createdFromEventId: memory.createdFromEventId,
      lastUpdatedFromEventId: memory.lastUpdatedFromEventId,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt
    });
  }

  recordMemoryMutation(event: EventEnvelope, memory: MemoryRecord): void {
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      this.appendEventWithoutTransaction(event);
      this.upsertMemory(memory);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  getMemory(memoryId: string): MemoryRecord | null {
    const statement = this.db.prepare("SELECT * FROM memories WHERE memory_id = ? LIMIT 1");
    const row = statement.get(memoryId) as Record<string, unknown> | undefined;
    return row ? parseMemory(row) : null;
  }

  listMemories(spaceId: string, includeInactive = false): MemoryRecord[] {
    const statement = this.db.prepare(`
      SELECT * FROM memories
      WHERE space_id = ? ${includeInactive ? "" : "AND status = 'active'"}
      ORDER BY updated_at DESC
    `);
    return statement.all(spaceId).map((row: unknown) => parseMemory(row as Record<string, unknown>));
  }

  listActiveMemories(spaceId: string): MemoryRecord[] {
    return this.listMemories(spaceId);
  }

  getCursor(scope: SyncCursor["scope"], ownerId: string, spaceId: string): SyncCursor | null {
    const statement = this.db.prepare(`
      SELECT * FROM sync_cursors
      WHERE scope = ? AND owner_id = ? AND space_id = ?
      LIMIT 1
    `);
    const row = statement.get(scope, ownerId, spaceId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return {
      schema: "mind-palace.sync-cursor/v0.1",
      cursorId: String(row.cursor_id),
      scope: row.scope as SyncCursor["scope"],
      ownerId: String(row.owner_id),
      spaceId: String(row.space_id),
      lastEventId: row.last_event_id ? String(row.last_event_id) : undefined,
      updatedAt: String(row.updated_at)
    };
  }

  upsertCursor(cursor: SyncCursor): void {
    const statement = this.db.prepare(`
      INSERT INTO sync_cursors (cursor_id, scope, owner_id, space_id, last_event_id, updated_at)
      VALUES (@cursorId, @scope, @ownerId, @spaceId, @lastEventId, @updatedAt)
      ON CONFLICT(scope, owner_id, space_id) DO UPDATE SET
        last_event_id = excluded.last_event_id,
        updated_at = excluded.updated_at
    `);

    statement.run({
      cursorId: cursor.cursorId,
      scope: cursor.scope,
      ownerId: cursor.ownerId,
      spaceId: cursor.spaceId,
      lastEventId: cursor.lastEventId ?? null,
      updatedAt: cursor.updatedAt
    });
  }

  listPendingOutbox(limit = 50): EventEnvelope[] {
    const statement = this.db.prepare(`
      SELECT e.payload_json
      FROM outbox o
      JOIN events e ON e.event_id = o.event_id
      WHERE o.status = 'pending'
      ORDER BY o.available_at ASC
      LIMIT ?
    `);

    return statement
      .all(limit)
      .map(
        (row: unknown) =>
          JSON.parse(String((row as Record<string, unknown>).payload_json)) as EventEnvelope
      );
  }

  listPendingOutboxForSpace(spaceId: string, limit = 50): EventEnvelope[] {
    const statement = this.db.prepare(`
      SELECT e.payload_json
      FROM outbox o
      JOIN events e ON e.event_id = o.event_id
      WHERE o.status = 'pending' AND o.space_id = ?
      ORDER BY o.available_at ASC
      LIMIT ?
    `);
    return statement
      .all(spaceId, limit)
      .map((row: unknown) => JSON.parse(String((row as Record<string, unknown>).payload_json)) as EventEnvelope);
  }

  markOutboxDelivered(eventId: string): void {
    const statement = this.db.prepare(`
      UPDATE outbox
      SET status = 'delivered'
      WHERE event_id = ?
    `);
    statement.run(eventId);
  }

  applyRemoteMemoryEvents(events: EventEnvelope[]): number {
    let applied = 0;
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      for (const event of events) {
        if (!event.eventType.startsWith("memory.")) continue;
        if (this.hasEvent(event.eventId)) continue;
        const payload = event.payload as Partial<MemoryPayload>;
        if (!payload.memoryId || !payload.kind || !payload.title || !payload.statement) {
          throw new Error(`Invalid remote memory event payload: ${event.eventId}`);
        }
        const existing = this.getMemory(payload.memoryId);
        const memory: MemoryRecord = {
          schema: "mind-palace.memory-record/v0.1",
          memoryId: payload.memoryId,
          spaceId: event.spaceId,
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
        };
        this.insertRemoteEventWithoutOutbox(event);
        this.upsertMemory(memory);
        applied++;
      }
      this.db.exec("COMMIT;");
      return applied;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  private appendEventWithoutTransaction(event: EventEnvelope): void {
    const insertEvent = this.db.prepare(`
      INSERT INTO events (event_id, space_id, event_type, created_at, idempotency_key, payload_json)
      VALUES (@eventId, @spaceId, @eventType, @createdAt, @idempotencyKey, @payloadJson)
      ON CONFLICT(event_id) DO NOTHING
    `);
    const enqueueOutbox = this.db.prepare(`
      INSERT INTO outbox (event_id, space_id, status, attempts, available_at, created_at)
      VALUES (@eventId, @spaceId, 'pending', 0, @availableAt, @createdAt)
      ON CONFLICT(event_id) DO NOTHING
    `);
    insertEvent.run({
      eventId: event.eventId,
      spaceId: event.spaceId,
      eventType: event.eventType,
      createdAt: event.createdAt,
      idempotencyKey: event.idempotencyKey,
      payloadJson: JSON.stringify(event)
    });
    enqueueOutbox.run({
      eventId: event.eventId,
      spaceId: event.spaceId,
      availableAt: event.createdAt,
      createdAt: event.createdAt
    });
  }

  private hasEvent(eventId: string): boolean {
    const statement = this.db.prepare("SELECT 1 FROM events WHERE event_id = ? LIMIT 1");
    return statement.get(eventId) !== undefined;
  }

  private insertRemoteEventWithoutOutbox(event: EventEnvelope): void {
    const statement = this.db.prepare(`
      INSERT INTO events (event_id, space_id, event_type, created_at, idempotency_key, payload_json)
      VALUES (@eventId, @spaceId, @eventType, @createdAt, @idempotencyKey, @payloadJson)
    `);
    statement.run({
      eventId: event.eventId,
      spaceId: event.spaceId,
      eventType: event.eventType,
      createdAt: event.createdAt,
      idempotencyKey: event.idempotencyKey,
      payloadJson: JSON.stringify(event)
    });
  }
}

export { ProjectSpaceResolver } from "./project-space.js";
export { ProjectMemoryService } from "./project-memory-service.js";
export { MindPalaceSyncClient } from "./sync-client.js";
export { HttpSyncTransport } from "./http-sync-transport.js";
export type { ResolvedProjectSpace } from "./project-space.js";
export type {
  ProjectMemoryProjection,
  RememberMemoryInput,
  UpdateMemoryInput
} from "./project-memory-service.js";
export type { SyncRunResult, SyncTransport } from "./sync-client.js";
