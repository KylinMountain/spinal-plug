export type ProjectSpaceType = "project" | "archive" | "general";

export type RepositoryProvider = "github" | "gitlab" | "generic-git";

export type MemoryKind = "directive" | "decision" | "context" | "reference";

export type MemoryStatus = "candidate" | "active" | "superseded" | "deleted" | "disputed";

export type MemoryOrigin =
  | "user_explicit"
  | "host_native"
  | "agent_inferred"
  | "sync_import";

export type EventType =
  | "memory.created"
  | "memory.candidate.created"
  | "memory.updated"
  | "memory.promoted"
  | "memory.dispute.resolved"
  | "memory.deleted"
  | "sync.cursor.advanced";

export type ProjectionKind =
  | "project_boot"
  | "turn_recall"
  | "mcp_resource"
  | "managed_markdown"
  | "mind_capsule"
  | "work_state";

export interface RepositoryRef {
  provider: RepositoryProvider;
  canonicalRemote: string;
  defaultBranch?: string;
}

export interface ProjectSpace {
  schema: "mind-palace.project-space/v0.1";
  spaceId: string;
  type: ProjectSpaceType;
  displayName: string;
  repository?: RepositoryRef;
  metadata?: Record<string, string>;
}

export interface EventActor {
  deviceId: string;
  agentInstallationId: string;
  host: string;
  sessionId: string;
  adapterVersion: string;
}

export interface EventCausality {
  baseSnapshotId?: string | null;
  parentEventIds: string[];
}

export interface EventRuntimeContext {
  incarnationId?: string | null;
  roleProfileId?: string | null;
  missionId?: string | null;
  branchId?: string | null;
  taskCheckpointId?: string | null;
}

export interface MemoryPayload {
  memoryId: string;
  kind: MemoryKind;
  title: string;
  statement: string;
  why?: string;
  howToApply?: string;
  references?: string[];
  semanticKey?: string;
  origin?: MemoryOrigin;
  confidence?: number;
  observedAt?: string;
  resolvesMemoryIds?: string[];
}

export interface EventEnvelope {
  schemaVersion: 1;
  eventId: string;
  eventType: EventType;
  eventVersion: 1;
  accountId: string;
  personaId: string;
  spaceId: string;
  actor: EventActor;
  causality: EventCausality;
  runtimeContext: EventRuntimeContext;
  payload: MemoryPayload | Record<string, unknown>;
  createdAt: string;
  idempotencyKey: string;
}

export interface MemoryRecord {
  schema: "mind-palace.memory-record/v0.1";
  memoryId: string;
  spaceId: string;
  kind: MemoryKind;
  title: string;
  statement: string;
  why?: string;
  howToApply?: string;
  references: string[];
  status: MemoryStatus;
  semanticKey?: string;
  origin?: MemoryOrigin;
  confidence?: number;
  sourceEventIds?: string[];
  supersededByMemoryId?: string;
  disputeId?: string;
  createdFromEventId: string;
  lastUpdatedFromEventId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryDispute {
  schema: "mind-palace.memory-dispute/v0.1";
  disputeId: string;
  spaceId: string;
  semanticKey: string;
  memoryIds: string[];
  sourceEventIds: string[];
  reason: "concurrent_variants";
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt?: string;
  resolvedByMemoryId?: string;
}

export interface SyncCursor {
  schema: "mind-palace.sync-cursor/v0.1";
  cursorId: string;
  scope: "device" | "adapter";
  ownerId: string;
  spaceId: string;
  lastEventId?: string;
  updatedAt: string;
}

export interface SyncPushRequest {
  spaceId: string;
  deviceId: string;
  events: EventEnvelope[];
}

export interface SyncPushResponse {
  acceptedEventIds: string[];
  duplicateEventIds: string[];
  serverCursor: string;
}

export interface SyncPullRequest {
  spaceId: string;
  deviceId: string;
  cursor?: string;
  limit?: number;
}

export interface SyncPullResponse {
  events: EventEnvelope[];
  nextCursor: string;
  hasMore: boolean;
}

export interface ProjectSnapshot {
  schema: "mind-palace.project-snapshot/v0.1";
  spaceId: string;
  cursor: string;
  generatedAt: string;
  memories: MemoryRecord[];
  candidates?: MemoryRecord[];
  disputes?: MemoryDispute[];
  superseded?: MemoryRecord[];
}

export interface MemoryCompilation {
  spaceId: string;
  generatedAt: string;
  active: MemoryRecord[];
  candidates: MemoryRecord[];
  disputed: MemoryRecord[];
  superseded: MemoryRecord[];
  deleted: MemoryRecord[];
  disputes: MemoryDispute[];
}
