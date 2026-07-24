export type ProjectSpaceType = "project" | "archive" | "general";

export type SpaceRole = "owner" | "editor" | "viewer";

export type DeviceStatus = "active" | "revoked";

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
  | "checkpoint.created"
  | "checkpoint.superseded"
  | "runtime.mind-core.created"
  | "runtime.role-profile.created"
  | "runtime.mission.created"
  | "runtime.task-graph.updated"
  | "runtime.capsule.created"
  | "runtime.incarnation.spawned"
  | "runtime.incarnation.updated"
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

export interface Account {
  accountId: string;
  displayName: string;
  createdAt: string;
}

export interface MindPalaceUser {
  userId: string;
  accountId: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface RegisteredDevice {
  deviceId: string;
  accountId: string;
  userId: string;
  displayName: string;
  status: DeviceStatus;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface SpaceMembership {
  spaceId: string;
  userId: string;
  role: SpaceRole;
  createdAt: string;
}

export interface AuthenticatedPrincipal {
  accountId: string;
  userId: string;
  deviceId: string;
  deviceStatus: DeviceStatus;
}

export interface DeviceCredential {
  device: RegisteredDevice;
  token: string;
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

export type CheckpointStatus = "active" | "superseded" | "archived";

export interface ProjectCheckpoint {
  schema: "mind-palace.project-checkpoint/v0.1";
  checkpointId: string;
  spaceId: string;
  title: string;
  summary?: string;
  completed: string[];
  decisions: string[];
  openTasks: string[];
  blockers: string[];
  nextAction?: string;
  artifactRefs: string[];
  status: CheckpointStatus;
  parentCheckpointId?: string;
  missionId?: string | null;
  branchId?: string | null;
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CheckpointPayload {
  checkpoint: ProjectCheckpoint;
}

export type IncarnationStatus = "active" | "hibernated" | "retired";

export type MissionStatus = "active" | "paused" | "completed" | "cancelled";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

export type RuntimeEntityType =
  | "mind_core"
  | "role_profile"
  | "mission"
  | "task_graph"
  | "mind_capsule"
  | "incarnation";

export interface SyncProfile {
  pullMode: "manual" | "notify" | "follow_stable" | "frozen";
  pushMode: "local_only" | "explicit" | "checkpoint" | "candidate";
  applyAt: "manual" | "turn_boundary" | "session_start";
}

export interface MindCore {
  schema: "mind-palace.mind-core/v0.1";
  mindId: string;
  spaceId: string;
  personaId: string;
  displayName: string;
  syncProfile: SyncProfile;
  status: "active" | "archived";
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleProfile {
  schema: "mind-palace.role-profile/v0.1";
  roleProfileId: string;
  mindId: string;
  spaceId: string;
  displayName: string;
  directives: string[];
  requiredCapabilities: string[];
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Mission {
  schema: "mind-palace.mission/v0.1";
  missionId: string;
  mindId: string;
  spaceId: string;
  title: string;
  objective: string;
  successCriteria: string[];
  status: MissionStatus;
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskNode {
  taskId: string;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  assigneeIncarnationId?: string;
  nextAction?: string;
}

export interface TaskGraph {
  schema: "mind-palace.task-graph/v0.1";
  taskGraphId: string;
  missionId: string;
  mindId: string;
  spaceId: string;
  tasks: TaskNode[];
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MindCapsule {
  schema: "mind-palace.mind-capsule/v0.1";
  capsuleId: string;
  mindId: string;
  spaceId: string;
  roleProfileId: string;
  missionId: string;
  taskGraphId?: string;
  baseSnapshotId?: string;
  memoryIds: string[];
  checkpointId?: string;
  syncProfile: SyncProfile;
  bootContext: string;
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Incarnation {
  schema: "mind-palace.incarnation/v0.1";
  incarnationId: string;
  mindId: string;
  capsuleId: string;
  spaceId: string;
  host: string;
  deviceId: string;
  sessionId: string;
  status: IncarnationStatus;
  baseSnapshotId?: string;
  compatibilityWarnings: string[];
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type RuntimeEntity = MindCore | RoleProfile | Mission | TaskGraph | MindCapsule | Incarnation;

export interface RuntimePayload {
  entityType: RuntimeEntityType;
  entity: RuntimeEntity;
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
  payload: MemoryPayload | CheckpointPayload | RuntimePayload | Record<string, unknown>;
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

export type CanonicalUpdateKind =
  | "activate"
  | "candidate"
  | "dispute"
  | "supersede"
  | "delete";

export interface CanonicalMemoryUpdate {
  schema: "mind-palace.canonical-memory-update/v0.1";
  updateId: string;
  spaceId: string;
  memoryId: string;
  kind: CanonicalUpdateKind;
  required: boolean;
  sourceEventIds: string[];
  memory: MemoryRecord;
  generatedAt: string;
}

export interface SyncFetchRequest {
  spaceId: string;
  deviceId: string;
  cursor?: string;
  limit?: number;
}

export interface SyncFetchResponse {
  updates: CanonicalMemoryUpdate[];
  nextCursor: string;
  hasMore: boolean;
}

export interface SyncPreview {
  spaceId: string;
  pending: CanonicalMemoryUpdate[];
  requiredUpdateIds: string[];
}

export interface SyncApplyResult {
  applied: number;
  requiredApplied: number;
  remaining: number;
  appliedUpdateIds: string[];
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
  deleted?: MemoryRecord[];
  checkpoints?: ProjectCheckpoint[];
  runtimeEntities?: RuntimeEntity[];
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
