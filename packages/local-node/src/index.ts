import { DatabaseSync } from "node:sqlite";
import type {
  CanonicalMemoryUpdate,
  EventEnvelope,
  MemoryPayload,
  MemoryRecord,
  SyncApplyResult,
  SyncCursor,
  SyncPreview
} from "@mind-palace/protocol";
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
    semanticKey: row.semantic_key ? String(row.semantic_key) : undefined,
    origin: row.origin ? row.origin as MemoryRecord["origin"] : undefined,
    confidence: row.confidence === null || row.confidence === undefined
      ? undefined
      : Number(row.confidence),
    sourceEventIds: row.source_event_ids_json
      ? JSON.parse(String(row.source_event_ids_json)) as string[]
      : [],
    supersededByMemoryId: row.superseded_by_memory_id
      ? String(row.superseded_by_memory_id)
      : undefined,
    disputeId: row.dispute_id ? String(row.dispute_id) : undefined,
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
    this.ensureMemoryColumns();
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
        semantic_key, origin, confidence, source_event_ids_json,
        superseded_by_memory_id, dispute_id, created_at, updated_at
      ) VALUES (
        @memoryId, @spaceId, @kind, @title, @statement, @whyText, @howToApply,
        @referencesJson, @status, @createdFromEventId, @lastUpdatedFromEventId,
        @semanticKey, @origin, @confidence, @sourceEventIdsJson,
        @supersededByMemoryId, @disputeId, @createdAt, @updatedAt
      )
      ON CONFLICT(memory_id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        statement = excluded.statement,
        why_text = excluded.why_text,
        how_to_apply = excluded.how_to_apply,
        references_json = excluded.references_json,
        status = excluded.status,
        semantic_key = excluded.semantic_key,
        origin = excluded.origin,
        confidence = excluded.confidence,
        source_event_ids_json = excluded.source_event_ids_json,
        superseded_by_memory_id = excluded.superseded_by_memory_id,
        dispute_id = excluded.dispute_id,
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
      semanticKey: memory.semanticKey ?? null,
      origin: memory.origin ?? null,
      confidence: memory.confidence ?? null,
      sourceEventIdsJson: JSON.stringify(memory.sourceEventIds ?? []),
      supersededByMemoryId: memory.supersededByMemoryId ?? null,
      disputeId: memory.disputeId ?? null,
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

  storeCanonicalUpdates(updates: CanonicalMemoryUpdate[]): number {
    const statement = this.db.prepare(`
      INSERT INTO sync_inbox (
        update_id, space_id, memory_id, update_kind, required,
        status, payload_json, fetched_at
      ) VALUES (
        @updateId, @spaceId, @memoryId, @updateKind, @required,
        'pending', @payloadJson, @fetchedAt
      )
      ON CONFLICT(update_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        update_kind = excluded.update_kind,
        required = excluded.required
      WHERE sync_inbox.status = 'pending'
    `);
    let stored = 0;
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      for (const update of updates) {
        const result = statement.run({
          updateId: update.updateId,
          spaceId: update.spaceId,
          memoryId: update.memoryId,
          updateKind: update.kind,
          required: update.required ? 1 : 0,
          payloadJson: JSON.stringify(update),
          fetchedAt: update.generatedAt
        });
        stored += Number(result.changes);
      }
      this.db.exec("COMMIT;");
      return stored;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  previewCanonicalUpdates(spaceId: string): SyncPreview {
    const rows = this.db.prepare(`
      SELECT payload_json FROM sync_inbox
      WHERE space_id = ? AND status = 'pending'
      ORDER BY required DESC, fetched_at ASC, update_id ASC
    `).all(spaceId) as Record<string, unknown>[];
    const pending = rows.map(
      row => JSON.parse(String(row.payload_json)) as CanonicalMemoryUpdate
    );
    return {
      spaceId,
      pending,
      requiredUpdateIds: pending.filter(update => update.required).map(update => update.updateId)
    };
  }

  applyCanonicalUpdates(
    spaceId: string,
    selectedUpdateIds?: string[],
    requiredOnly = false
  ): SyncApplyResult {
    const preview = this.previewCanonicalUpdates(spaceId);
    const selected = selectedUpdateIds ? new Set(selectedUpdateIds) : null;
    const updates = preview.pending.filter(update => {
      if (requiredOnly) return update.required;
      return update.required || selected === null || selected.has(update.updateId);
    });
    const markApplied = this.db.prepare(`
      UPDATE sync_inbox SET status = 'applied', applied_at = ?
      WHERE update_id = ? AND status = 'pending'
    `);
    let applied = 0;
    let requiredApplied = 0;
    const appliedUpdateIds: string[] = [];
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      for (const update of updates) {
        this.upsertMemory(update.memory);
        const result = markApplied.run(new Date().toISOString(), update.updateId);
        if (Number(result.changes) === 0) continue;
        applied += 1;
        if (update.required) requiredApplied += 1;
        appliedUpdateIds.push(update.updateId);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
    const remaining = this.previewCanonicalUpdates(spaceId).pending.length;
    return { applied, requiredApplied, remaining, appliedUpdateIds };
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
          status: event.eventType === "memory.deleted"
            ? "deleted"
            : event.eventType === "memory.candidate.created"
              ? "candidate"
              : event.eventType === "memory.promoted"
                ? "active"
                : existing?.status ?? "active",
          semanticKey: payload.semanticKey ?? existing?.semanticKey,
          origin: payload.origin ?? existing?.origin ?? "sync_import",
          confidence: payload.confidence ?? existing?.confidence,
          sourceEventIds: [...new Set([...(existing?.sourceEventIds ?? []), event.eventId])],
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

  private ensureMemoryColumns(): void {
    const existing = new Set(
      (this.db.prepare("PRAGMA table_info(memories)").all() as Record<string, unknown>[])
        .map(row => String(row.name))
    );
    const additions = [
      ["semantic_key", "TEXT"],
      ["origin", "TEXT"],
      ["confidence", "REAL"],
      ["source_event_ids_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["superseded_by_memory_id", "TEXT"],
      ["dispute_id", "TEXT"]
    ] as const;
    for (const [name, definition] of additions) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${definition}`);
    }
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
export type {
  FetchResult,
  PublishResult,
  SynchronizeResult,
  SyncRunResult,
  SyncTransport
} from "./sync-client.js";
