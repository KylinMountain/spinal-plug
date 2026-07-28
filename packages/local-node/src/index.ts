import { DatabaseSync } from "node:sqlite";
import type {
  CanonicalMemoryUpdate,
  CheckpointPayload,
  EventEnvelope,
  MemoryPayload,
  MemoryRecord,
  ProjectCheckpoint,
  RuntimeEntity,
  RuntimePayload,
  RuntimeEntityType,
  SyncApplyResult,
  SyncCursor,
  SyncPreview
} from "@spinal-plug/protocol";
import { sqliteSchema } from "./schema.js";

export interface CandidateMemoryDraft {
  kind: MemoryRecord["kind"];
  title: string;
  statement: string;
  why?: string;
  howToApply?: string;
  references?: string[];
  semanticKey?: string;
  confidence: number;
}

export interface CandidateExtractionJob {
  jobId: string;
  host: string;
  spaceId: string;
  sessionId: string;
  sourceDigest: string;
  candidates: CandidateMemoryDraft[];
  status: "pending" | "processing" | "completed";
  attempts: number;
  leaseExpiresAt?: string;
  createdAt: string;
  completedAt?: string;
}

function parseCandidateExtractionJob(row: Record<string, unknown>): CandidateExtractionJob {
  return {
    jobId: String(row.job_id),
    host: String(row.host),
    spaceId: String(row.space_id),
    sessionId: String(row.session_id),
    sourceDigest: String(row.source_digest),
    candidates: JSON.parse(String(row.candidates_json)) as CandidateMemoryDraft[],
    status: row.status as CandidateExtractionJob["status"],
    attempts: Number(row.attempts),
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : undefined,
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined
  };
}

function isCheckpointPayload(payload: EventEnvelope["payload"]): payload is CheckpointPayload {
  const candidate = payload as Partial<CheckpointPayload>;
  return Boolean(candidate.checkpoint?.checkpointId && candidate.checkpoint?.spaceId);
}

function parseCheckpoint(row: Record<string, unknown>): ProjectCheckpoint {
  return JSON.parse(String(row.payload_json)) as ProjectCheckpoint;
}

function runtimeEntityId(entity: RuntimeEntity): string {
  switch (entity.schema) {
    case "spinal-plug.mind-core/v0.1": return entity.mindId;
    case "spinal-plug.role-profile/v0.1": return entity.roleProfileId;
    case "spinal-plug.mission/v0.1": return entity.missionId;
    case "spinal-plug.task-graph/v0.1": return entity.taskGraphId;
    case "spinal-plug.mind-capsule/v0.1": return entity.capsuleId;
    case "spinal-plug.incarnation/v0.1": return entity.incarnationId;
  }
}

function runtimeEntityType(entity: RuntimeEntity): RuntimeEntityType {
  switch (entity.schema) {
    case "spinal-plug.mind-core/v0.1": return "mind_core";
    case "spinal-plug.role-profile/v0.1": return "role_profile";
    case "spinal-plug.mission/v0.1": return "mission";
    case "spinal-plug.task-graph/v0.1": return "task_graph";
    case "spinal-plug.mind-capsule/v0.1": return "mind_capsule";
    case "spinal-plug.incarnation/v0.1": return "incarnation";
  }
}

function runtimeEntityStatus(entity: RuntimeEntity): string {
  return "status" in entity ? entity.status : "active";
}

function parseRuntimeEntity(row: Record<string, unknown>): RuntimeEntity {
  return JSON.parse(String(row.payload_json)) as RuntimeEntity;
}

function isRuntimePayload(payload: EventEnvelope["payload"]): payload is RuntimePayload {
  const candidate = payload as Partial<RuntimePayload>;
  return Boolean(candidate.entityType && candidate.entity && typeof candidate.entity === "object");
}

function parseMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    schema: "spinal-plug.memory-record/v0.1",
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

export class SpinalPlugDatabase {
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
      VALUES (@eventId, @spaceId, @status, 0, @availableAt, @createdAt)
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
        status: event.eventType === "memory.candidate.created" ? "held" : "pending",
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

  upsertCheckpoint(checkpoint: ProjectCheckpoint): void {
    this.db.prepare(`
      INSERT INTO project_checkpoints (
        checkpoint_id, space_id, status, branch_id, updated_at, payload_json
      ) VALUES (
        @checkpointId, @spaceId, @status, @branchId, @updatedAt, @payloadJson
      ) ON CONFLICT(checkpoint_id) DO UPDATE SET
        status = excluded.status,
        branch_id = excluded.branch_id,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run({
      checkpointId: checkpoint.checkpointId,
      spaceId: checkpoint.spaceId,
      status: checkpoint.status,
      branchId: checkpoint.branchId ?? null,
      updatedAt: checkpoint.updatedAt,
      payloadJson: JSON.stringify(checkpoint)
    });
  }

  upsertRuntimeEntity(entity: RuntimeEntity): void {
    this.db.prepare(`
      INSERT INTO runtime_entities (entity_id, space_id, entity_type, status, updated_at, payload_json)
      VALUES (@entityId, @spaceId, @entityType, @status, @updatedAt, @payloadJson)
      ON CONFLICT(entity_id) DO UPDATE SET
        space_id = excluded.space_id,
        entity_type = excluded.entity_type,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run({
      entityId: runtimeEntityId(entity),
      spaceId: entity.spaceId,
      entityType: runtimeEntityType(entity),
      status: runtimeEntityStatus(entity),
      updatedAt: entity.updatedAt,
      payloadJson: JSON.stringify(entity)
    });
  }

  getRuntimeEntity<T extends RuntimeEntity = RuntimeEntity>(entityId: string): T | null {
    const row = this.db.prepare("SELECT payload_json FROM runtime_entities WHERE entity_id = ? LIMIT 1")
      .get(entityId) as Record<string, unknown> | undefined;
    return row ? parseRuntimeEntity(row) as T : null;
  }

  listRuntimeEntities(spaceId: string, entityType?: RuntimeEntityType): RuntimeEntity[] {
    const rows = this.db.prepare(`
      SELECT payload_json FROM runtime_entities
      WHERE space_id = ? ${entityType ? "AND entity_type = ?" : ""}
      ORDER BY updated_at DESC, entity_id ASC
    `).all(...(entityType ? [spaceId, entityType] : [spaceId])) as Record<string, unknown>[];
    return rows.map(parseRuntimeEntity);
  }

  listCheckpoints(spaceId: string, includeInactive = false): ProjectCheckpoint[] {
    return (this.db.prepare(`
      SELECT payload_json FROM project_checkpoints
      WHERE space_id = ? ${includeInactive ? "" : "AND status = 'active'"}
      ORDER BY updated_at DESC, checkpoint_id ASC
    `).all(spaceId) as Record<string, unknown>[]).map(parseCheckpoint);
  }

  latestCheckpoint(spaceId: string): ProjectCheckpoint | null {
    return this.listCheckpoints(spaceId)[0] ?? null;
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

  recordMemoryPromotion(event: EventEnvelope, memory: MemoryRecord): void {
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      this.releaseHeldCandidateEventsWithoutTransaction(memory.memoryId);
      this.appendEventWithoutTransaction(event);
      this.upsertMemory(memory);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  recordCheckpointMutation(event: EventEnvelope, checkpoint: ProjectCheckpoint): void {
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      this.appendEventWithoutTransaction(event);
      this.upsertCheckpoint(checkpoint);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  recordRuntimeMutation(event: EventEnvelope, entity: RuntimeEntity): void {
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      this.appendEventWithoutTransaction(event);
      this.upsertRuntimeEntity(entity);
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

  /**
   * The Space's semantic-key registry: one row per key with a representative
   * statement, so a host can classify a new fact against existing keys
   * instead of freely inventing a divergent one.
   */
  listSemanticKeys(spaceId: string): Array<{ semanticKey: string; memoryCount: number; sample: string }> {
    const statement = this.db.prepare(`
      SELECT semantic_key AS semanticKey, COUNT(*) AS memoryCount,
             MAX(statement) AS sample
      FROM memories
      WHERE space_id = ? AND status = 'active' AND semantic_key IS NOT NULL
      GROUP BY semantic_key
      ORDER BY memoryCount DESC, semanticKey ASC
    `);
    return (statement.all(spaceId) as Array<Record<string, unknown>>).map(row => ({
      semanticKey: String(row.semanticKey),
      memoryCount: Number(row.memoryCount),
      sample: String(row.sample)
    }));
  }

  /**
   * A Space "has memory" once anything reviewable exists — active memories or
   * pending candidates — so empty-chamber nudges stop as soon as generation
   * produces its first draft.
   */
  hasDurableMemory(spaceId: string): boolean {
    const statement = this.db.prepare(`
      SELECT 1 FROM memories
      WHERE space_id = ? AND status IN ('active', 'candidate')
      LIMIT 1
    `);
    return statement.get(spaceId) !== undefined;
  }

  hasMemoryNudge(spaceId: string, sessionId: string, host: string): boolean {
    const statement = this.db.prepare(`
      SELECT 1 FROM memory_nudges
      WHERE space_id = ? AND session_id = ? AND host = ?
      LIMIT 1
    `);
    return statement.get(spaceId, sessionId, host) !== undefined;
  }

  recordMemoryNudge(spaceId: string, sessionId: string, host: string, createdAt: string): void {
    const statement = this.db.prepare(`
      INSERT OR IGNORE INTO memory_nudges (space_id, session_id, host, created_at)
      VALUES (?, ?, ?, ?)
    `);
    statement.run(spaceId, sessionId, host, createdAt);
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
      schema: "spinal-plug.sync-cursor/v0.1",
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

  listHeldOutboxForSpace(spaceId: string, limit = 50): EventEnvelope[] {
    const statement = this.db.prepare(`
      SELECT e.payload_json
      FROM outbox o
      JOIN events e ON e.event_id = o.event_id
      WHERE o.status = 'held' AND o.space_id = ?
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

  /**
   * Re-queues events already delivered to a previous server. Delivery is not
   * tracked per-server, so pointing this device at a new Control Plane (or a
   * server that lost its database) requires this explicit re-bootstrap. The
   * receiving server deduplicates by event_id, so re-publishing is safe.
   */
  requeueDeliveredOutboxForSpace(spaceId: string): number {
    const result = this.db.prepare(`
      UPDATE outbox
      SET status = 'pending'
      WHERE space_id = ? AND status = 'delivered'
    `).run(spaceId);
    return Number(result.changes);
  }

  /**
   * Rewrites the account/device identity on this Space's local event history.
   * Events minted by the unauthenticated local runtime carry accountId "local"
   * and an arbitrary device id; an authenticated Control Plane rejects those.
   * Adopting the credential's identity is the migration path onto such a
   * server. Returns the number of rewritten events.
   */
  adoptIdentityForSpace(spaceId: string, identity: { accountId: string; deviceId: string }): number {
    const rows = this.db.prepare(`
      SELECT event_id, payload_json FROM events WHERE space_id = ?
    `).all(spaceId) as Record<string, unknown>[];
    const update = this.db.prepare("UPDATE events SET payload_json = ? WHERE event_id = ?");
    let rewritten = 0;
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      for (const row of rows) {
        const event = JSON.parse(String(row.payload_json)) as EventEnvelope;
        if (event.accountId === identity.accountId && event.actor.deviceId === identity.deviceId) continue;
        event.accountId = identity.accountId;
        event.actor = { ...event.actor, deviceId: identity.deviceId };
        update.run(JSON.stringify(event), String(row.event_id));
        rewritten += 1;
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
    return rewritten;
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
          schema: "spinal-plug.memory-record/v0.1",
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

  applyRemoteCheckpointEvents(events: EventEnvelope[]): number {
    let applied = 0;
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      for (const event of events) {
        if (!event.eventType.startsWith("checkpoint.") || this.hasEvent(event.eventId)) continue;
        if (!isCheckpointPayload(event.payload)) continue;
        const checkpoint = event.payload.checkpoint;
        if (checkpoint.spaceId !== event.spaceId) {
          throw new Error(`Checkpoint ${checkpoint.checkpointId} does not belong to event Space.`);
        }
        this.insertRemoteEventWithoutOutbox(event);
        this.upsertCheckpoint(checkpoint);
        applied += 1;
      }
      this.db.exec("COMMIT;");
      return applied;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  applyRemoteRuntimeEvents(events: EventEnvelope[]): number {
    let applied = 0;
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      for (const event of events) {
        if (!event.eventType.startsWith("runtime.") || this.hasEvent(event.eventId)) continue;
        if (!isRuntimePayload(event.payload)) continue;
        const entity = event.payload.entity;
        if (entity.spaceId !== event.spaceId) {
          throw new Error(`Runtime entity ${runtimeEntityId(entity)} does not belong to event Space.`);
        }
        this.insertRemoteEventWithoutOutbox(event);
        this.upsertRuntimeEntity(entity);
        applied += 1;
      }
      this.db.exec("COMMIT;");
      return applied;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  enqueueCandidateExtraction(job: Omit<CandidateExtractionJob, "status" | "attempts" | "leaseExpiresAt" | "completedAt">): boolean {
    const result = this.db.prepare(`
      INSERT INTO candidate_extraction_jobs (
        job_id, host, space_id, session_id, source_digest, candidates_json,
        status, attempts, created_at
      ) VALUES (
        @jobId, @host, @spaceId, @sessionId, @sourceDigest, @candidatesJson,
        'pending', 0, @createdAt
      ) ON CONFLICT(job_id) DO NOTHING
    `).run({
      jobId: job.jobId,
      host: job.host,
      spaceId: job.spaceId,
      sessionId: job.sessionId,
      sourceDigest: job.sourceDigest,
      candidatesJson: JSON.stringify(job.candidates),
      createdAt: job.createdAt
    });
    return Number(result.changes) === 1;
  }

  claimCandidateExtraction(
    spaceId?: string,
    now: Date = new Date(),
    leaseMs = 120_000
  ): CandidateExtractionJob | null {
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    try {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      this.db.prepare(`
        UPDATE candidate_extraction_jobs
        SET status = 'pending', lease_expires_at = NULL
        WHERE status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      `).run(nowIso);
      const row = this.db.prepare(`
        SELECT * FROM candidate_extraction_jobs
        WHERE status = 'pending' ${spaceId ? "AND space_id = ?" : ""}
        ORDER BY created_at ASC, job_id ASC
        LIMIT 1
      `).get(...(spaceId ? [spaceId] : [])) as Record<string, unknown> | undefined;
      if (!row) {
        this.db.exec("COMMIT;");
        return null;
      }
      const claimed = this.db.prepare(`
        UPDATE candidate_extraction_jobs
        SET status = 'processing', attempts = attempts + 1, lease_expires_at = ?
        WHERE job_id = ? AND status = 'pending'
      `).run(leaseExpiresAt, String(row.job_id));
      if (Number(claimed.changes) !== 1) {
        this.db.exec("COMMIT;");
        return null;
      }
      const claimedRow = this.db.prepare("SELECT * FROM candidate_extraction_jobs WHERE job_id = ?")
        .get(String(row.job_id)) as Record<string, unknown>;
      this.db.exec("COMMIT;");
      return parseCandidateExtractionJob(claimedRow);
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  completeCandidateExtraction(jobId: string, completedAt = new Date().toISOString()): boolean {
    const result = this.db.prepare(`
      UPDATE candidate_extraction_jobs
      SET status = 'completed', completed_at = ?, lease_expires_at = NULL
      WHERE job_id = ? AND status = 'processing'
    `).run(completedAt, jobId);
    return Number(result.changes) === 1;
  }

  requeueCandidateExtraction(jobId: string): boolean {
    const result = this.db.prepare(`
      UPDATE candidate_extraction_jobs
      SET status = 'pending', lease_expires_at = NULL
      WHERE job_id = ? AND status = 'processing'
    `).run(jobId);
    return Number(result.changes) === 1;
  }

  listCandidateExtractionJobs(spaceId: string): CandidateExtractionJob[] {
    return (this.db.prepare(`
      SELECT * FROM candidate_extraction_jobs WHERE space_id = ? ORDER BY created_at ASC
    `).all(spaceId) as Record<string, unknown>[]).map(parseCandidateExtractionJob);
  }

  private appendEventWithoutTransaction(event: EventEnvelope): void {
    const insertEvent = this.db.prepare(`
      INSERT INTO events (event_id, space_id, event_type, created_at, idempotency_key, payload_json)
      VALUES (@eventId, @spaceId, @eventType, @createdAt, @idempotencyKey, @payloadJson)
      ON CONFLICT(event_id) DO NOTHING
    `);
    const enqueueOutbox = this.db.prepare(`
      INSERT INTO outbox (event_id, space_id, status, attempts, available_at, created_at)
      VALUES (@eventId, @spaceId, @status, 0, @availableAt, @createdAt)
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
      status: event.eventType === "memory.candidate.created" ? "held" : "pending",
      availableAt: event.createdAt,
      createdAt: event.createdAt
    });
  }

  private hasEvent(eventId: string): boolean {
    const statement = this.db.prepare("SELECT 1 FROM events WHERE event_id = ? LIMIT 1");
    return statement.get(eventId) !== undefined;
  }

  private releaseHeldCandidateEventsWithoutTransaction(memoryId: string): void {
    const candidates = this.db.prepare(`
      SELECT o.event_id, e.payload_json
      FROM outbox o
      JOIN events e ON e.event_id = o.event_id
      WHERE o.status = 'held' AND e.event_type = 'memory.candidate.created'
    `).all() as Record<string, unknown>[];
    const release = this.db.prepare("UPDATE outbox SET status = 'pending' WHERE event_id = ? AND status = 'held'");
    for (const row of candidates) {
      const event = JSON.parse(String(row.payload_json)) as EventEnvelope;
      const payload = event.payload as Partial<MemoryPayload>;
      if (payload.memoryId === memoryId) release.run(String(row.event_id));
    }
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
export { ProjectHandoffService } from "./project-handoff-service.js";
export { MindRuntimeService } from "./mind-runtime-service.js";
export { containsLikelySecret, memoryContainsLikelySecret, SecretMaterialError, valueContainsLikelySecret } from "./sensitive-data.js";
export { SpinalPlugSyncClient } from "./sync-client.js";
export { HttpSyncTransport } from "./http-sync-transport.js";
export type { ResolvedProjectSpace } from "./project-space.js";
export type {
  ProjectMemoryProjection,
  RememberMemoryInput,
  UpdateMemoryInput
} from "./project-memory-service.js";
export type { CreateCheckpointInput } from "./project-handoff-service.js";
export type {
  CompileCapsuleInput,
  CreateMindCoreInput,
  CreateMissionInput,
  CreateRoleProfileInput,
  SpawnIncarnationInput,
  UpsertTaskGraphInput
} from "./mind-runtime-service.js";
export type {
  FetchResult,
  PublishResult,
  SynchronizeResult,
  SyncRunResult,
  SyncTransport
} from "./sync-client.js";
