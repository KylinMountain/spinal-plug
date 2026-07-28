import type { CanonicalMemoryUpdate, EventEnvelope, MemoryRecord, ProjectCheckpoint, RuntimeEntity, RuntimeEntityType, SyncApplyResult, SyncCursor, SyncPreview } from "@spinal-plug/protocol";
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
export declare class SpinalPlugDatabase {
    private readonly db;
    constructor(databasePath: string);
    init(): void;
    appendEvent(event: EventEnvelope): void;
    upsertMemory(memory: MemoryRecord): void;
    upsertCheckpoint(checkpoint: ProjectCheckpoint): void;
    upsertRuntimeEntity(entity: RuntimeEntity): void;
    getRuntimeEntity<T extends RuntimeEntity = RuntimeEntity>(entityId: string): T | null;
    listRuntimeEntities(spaceId: string, entityType?: RuntimeEntityType): RuntimeEntity[];
    listCheckpoints(spaceId: string, includeInactive?: boolean): ProjectCheckpoint[];
    latestCheckpoint(spaceId: string): ProjectCheckpoint | null;
    recordMemoryMutation(event: EventEnvelope, memory: MemoryRecord): void;
    recordMemoryPromotion(event: EventEnvelope, memory: MemoryRecord): void;
    recordCheckpointMutation(event: EventEnvelope, checkpoint: ProjectCheckpoint): void;
    recordRuntimeMutation(event: EventEnvelope, entity: RuntimeEntity): void;
    getMemory(memoryId: string): MemoryRecord | null;
    listMemories(spaceId: string, includeInactive?: boolean): MemoryRecord[];
    listActiveMemories(spaceId: string): MemoryRecord[];
    /**
     * The Space's semantic-key registry: one row per key with a representative
     * statement, so a host can classify a new fact against existing keys
     * instead of freely inventing a divergent one.
     */
    listSemanticKeys(spaceId: string): Array<{
        semanticKey: string;
        memoryCount: number;
        sample: string;
    }>;
    /**
     * A Space "has memory" once anything reviewable exists — active memories or
     * pending candidates — so empty-chamber nudges stop as soon as generation
     * produces its first draft.
     */
    hasDurableMemory(spaceId: string): boolean;
    hasMemoryNudge(spaceId: string, sessionId: string, host: string): boolean;
    recordMemoryNudge(spaceId: string, sessionId: string, host: string, createdAt: string): void;
    getCursor(scope: SyncCursor["scope"], ownerId: string, spaceId: string): SyncCursor | null;
    upsertCursor(cursor: SyncCursor): void;
    storeCanonicalUpdates(updates: CanonicalMemoryUpdate[]): number;
    previewCanonicalUpdates(spaceId: string): SyncPreview;
    applyCanonicalUpdates(spaceId: string, selectedUpdateIds?: string[], requiredOnly?: boolean): SyncApplyResult;
    listPendingOutbox(limit?: number): EventEnvelope[];
    listPendingOutboxForSpace(spaceId: string, limit?: number): EventEnvelope[];
    listHeldOutboxForSpace(spaceId: string, limit?: number): EventEnvelope[];
    markOutboxDelivered(eventId: string): void;
    /**
     * Re-queues events already delivered to a previous server. Delivery is not
     * tracked per-server, so pointing this device at a new Control Plane (or a
     * server that lost its database) requires this explicit re-bootstrap. The
     * receiving server deduplicates by event_id, so re-publishing is safe.
     */
    requeueDeliveredOutboxForSpace(spaceId: string): number;
    /**
     * Rewrites the account/device identity on this Space's local event history.
     * Events minted by the unauthenticated local runtime carry accountId "local"
     * and an arbitrary device id; an authenticated Control Plane rejects those.
     * Adopting the credential's identity is the migration path onto such a
     * server. Returns the number of rewritten events.
     */
    adoptIdentityForSpace(spaceId: string, identity: {
        accountId: string;
        deviceId: string;
    }): number;
    applyRemoteMemoryEvents(events: EventEnvelope[]): number;
    applyRemoteCheckpointEvents(events: EventEnvelope[]): number;
    applyRemoteRuntimeEvents(events: EventEnvelope[]): number;
    enqueueCandidateExtraction(job: Omit<CandidateExtractionJob, "status" | "attempts" | "leaseExpiresAt" | "completedAt">): boolean;
    claimCandidateExtraction(spaceId?: string, now?: Date, leaseMs?: number): CandidateExtractionJob | null;
    completeCandidateExtraction(jobId: string, completedAt?: string): boolean;
    requeueCandidateExtraction(jobId: string): boolean;
    listCandidateExtractionJobs(spaceId: string): CandidateExtractionJob[];
    private appendEventWithoutTransaction;
    private hasEvent;
    private releaseHeldCandidateEventsWithoutTransaction;
    private insertRemoteEventWithoutOutbox;
    private ensureMemoryColumns;
}
export { ProjectSpaceResolver } from "./project-space.js";
export { ProjectMemoryService } from "./project-memory-service.js";
export { ProjectHandoffService } from "./project-handoff-service.js";
export { MindRuntimeService } from "./mind-runtime-service.js";
export { containsLikelySecret, memoryContainsLikelySecret, SecretMaterialError, valueContainsLikelySecret } from "./sensitive-data.js";
export { SpinalPlugSyncClient } from "./sync-client.js";
export { HttpSyncTransport } from "./http-sync-transport.js";
export { InMemorySyncServer } from "./in-memory-sync-server.js";
export { MemoryCompiler } from "./memory-compiler.js";
export { createCanonicalUpdates } from "./canonical-updates.js";
export type { MemoryCompilerOptions, SequencedMemoryEvent } from "./memory-compiler.js";
export type { ResolvedProjectSpace } from "./project-space.js";
export type { ProjectMemoryProjection, RememberMemoryInput, UpdateMemoryInput } from "./project-memory-service.js";
export type { CreateCheckpointInput } from "./project-handoff-service.js";
export type { CompileCapsuleInput, CreateMindCoreInput, CreateMissionInput, CreateRoleProfileInput, SpawnIncarnationInput, UpsertTaskGraphInput } from "./mind-runtime-service.js";
export type { FetchResult, PublishResult, SynchronizeResult, SyncRunResult, SyncTransport } from "./sync-client.js";
//# sourceMappingURL=index.d.ts.map