import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type {
  EventActor,
  EventEnvelope,
  Incarnation,
  IncarnationStatus,
  MindCapsule,
  MindCore,
  Mission,
  ProjectSpace,
  RoleProfile,
  RuntimeEntity,
  RuntimeEntityType,
  SyncProfile,
  TaskGraph,
  TaskNode
} from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
import { ProjectMemoryService } from "./project-memory-service.js";
import { memoryContainsLikelySecret, valueContainsLikelySecret } from "./sensitive-data.js";

const defaultSyncProfile: SyncProfile = {
  pullMode: "notify",
  pushMode: "checkpoint",
  applyAt: "turn_boundary"
};

function now(): string {
  return new Date().toISOString();
}

function compact(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
}

function defaultActor(overrides: Partial<EventActor> = {}): EventActor {
  return {
    deviceId: `device:${hostname()}`,
    agentInstallationId: "spinal-plug-runtime",
    host: "spinal-plug",
    sessionId: "runtime",
    adapterVersion: "0.1.0",
    ...overrides
  };
}

function entityId(entity: RuntimeEntity): string {
  if (entity.schema === "spinal-plug.mind-core/v0.1") return entity.mindId;
  if (entity.schema === "spinal-plug.role-profile/v0.1") return entity.roleProfileId;
  if (entity.schema === "spinal-plug.mission/v0.1") return entity.missionId;
  if (entity.schema === "spinal-plug.task-graph/v0.1") return entity.taskGraphId;
  if (entity.schema === "spinal-plug.mind-capsule/v0.1") return entity.capsuleId;
  return entity.incarnationId;
}

function entityType(entity: RuntimeEntity): RuntimeEntityType {
  if (entity.schema === "spinal-plug.mind-core/v0.1") return "mind_core";
  if (entity.schema === "spinal-plug.role-profile/v0.1") return "role_profile";
  if (entity.schema === "spinal-plug.mission/v0.1") return "mission";
  if (entity.schema === "spinal-plug.task-graph/v0.1") return "task_graph";
  if (entity.schema === "spinal-plug.mind-capsule/v0.1") return "mind_capsule";
  return "incarnation";
}

function eventTypeFor(entity: RuntimeEntity, update = false): EventEnvelope["eventType"] {
  if (entity.schema === "spinal-plug.mind-core/v0.1") return "runtime.mind-core.created";
  if (entity.schema === "spinal-plug.role-profile/v0.1") return "runtime.role-profile.created";
  if (entity.schema === "spinal-plug.mission/v0.1") return "runtime.mission.created";
  if (entity.schema === "spinal-plug.task-graph/v0.1") return "runtime.task-graph.updated";
  if (entity.schema === "spinal-plug.mind-capsule/v0.1") return "runtime.capsule.created";
  return update ? "runtime.incarnation.updated" : "runtime.incarnation.spawned";
}

export interface CreateMindCoreInput {
  space: ProjectSpace;
  displayName: string;
  personaId?: string;
  syncProfile?: Partial<SyncProfile>;
  actor?: Partial<EventActor>;
}

export interface CreateRoleProfileInput {
  space: ProjectSpace;
  mindId: string;
  displayName: string;
  directives?: string[];
  requiredCapabilities?: string[];
  actor?: Partial<EventActor>;
}

export interface CreateMissionInput {
  space: ProjectSpace;
  mindId: string;
  title: string;
  objective: string;
  successCriteria?: string[];
  actor?: Partial<EventActor>;
}

export interface UpsertTaskGraphInput {
  space: ProjectSpace;
  mindId: string;
  missionId: string;
  taskGraphId?: string;
  tasks: TaskNode[];
  actor?: Partial<EventActor>;
}

export interface CompileCapsuleInput {
  space: ProjectSpace;
  mindId: string;
  roleProfileId: string;
  missionId: string;
  taskGraphId?: string;
  baseSnapshotId?: string;
  actor?: Partial<EventActor>;
}

export interface SpawnIncarnationInput {
  space: ProjectSpace;
  capsuleId: string;
  host: string;
  deviceId: string;
  sessionId: string;
  compatibilityWarnings?: string[];
  actor?: Partial<EventActor>;
}

/**
 * Minimal Incarnation Runtime. It deliberately stores identity, role, work
 * state and capsule data outside Canonical Memory, while using the same WAL
 * and event transport for durable synchronization.
 */
export class MindRuntimeService {
  constructor(
    private readonly database: SpinalPlugDatabase,
    private readonly identity = { accountId: "local", personaId: "persona_default" },
    private readonly actorDefaults: Partial<EventActor> = {}
  ) {}

  createMindCore(input: CreateMindCoreInput): MindCore {
    const timestamp = now();
    const core: MindCore = {
      schema: "spinal-plug.mind-core/v0.1",
      mindId: `mind_${randomUUID()}`,
      spaceId: input.space.spaceId,
      personaId: input.personaId ?? this.identity.personaId,
      displayName: input.displayName.trim(),
      syncProfile: { ...defaultSyncProfile, ...input.syncProfile },
      status: "active",
      sourceEventIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.persist(core, false, input.actor);
  }

  createRoleProfile(input: CreateRoleProfileInput): RoleProfile {
    this.requireCore(input.mindId, input.space);
    const timestamp = now();
    const role: RoleProfile = {
      schema: "spinal-plug.role-profile/v0.1",
      roleProfileId: `role_${randomUUID()}`,
      mindId: input.mindId,
      spaceId: input.space.spaceId,
      displayName: input.displayName.trim(),
      directives: compact(input.directives),
      requiredCapabilities: compact(input.requiredCapabilities),
      sourceEventIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.persist(role, false, input.actor);
  }

  createMission(input: CreateMissionInput): Mission {
    this.requireCore(input.mindId, input.space);
    const timestamp = now();
    const mission: Mission = {
      schema: "spinal-plug.mission/v0.1",
      missionId: `mission_${randomUUID()}`,
      mindId: input.mindId,
      spaceId: input.space.spaceId,
      title: input.title.trim(),
      objective: input.objective.trim(),
      successCriteria: compact(input.successCriteria),
      status: "active",
      sourceEventIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.persist(mission, false, input.actor);
  }

  upsertTaskGraph(input: UpsertTaskGraphInput): TaskGraph {
    const mission = this.requireEntity<Mission>(input.missionId, "spinal-plug.mission/v0.1", input.space);
    if (mission.mindId !== input.mindId) throw new Error("Task Graph Mind Core does not match Mission.");
    const previous = input.taskGraphId ? this.database.getRuntimeEntity<TaskGraph>(input.taskGraphId) : null;
    const timestamp = now();
    const graph: TaskGraph = {
      schema: "spinal-plug.task-graph/v0.1",
      taskGraphId: input.taskGraphId ?? `tasks_${randomUUID()}`,
      missionId: input.missionId,
      mindId: input.mindId,
      spaceId: input.space.spaceId,
      tasks: input.tasks.map(task => ({
        ...task,
        title: task.title.trim(),
        dependsOn: compact(task.dependsOn),
        nextAction: task.nextAction?.trim() || undefined
      })),
      sourceEventIds: previous?.sourceEventIds ?? [],
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    return this.persist(graph, Boolean(previous), input.actor);
  }

  compileCapsule(input: CompileCapsuleInput): MindCapsule {
    const core = this.requireCore(input.mindId, input.space);
    const role = this.requireEntity<RoleProfile>(input.roleProfileId, "spinal-plug.role-profile/v0.1", input.space);
    const mission = this.requireEntity<Mission>(input.missionId, "spinal-plug.mission/v0.1", input.space);
    if (role.mindId !== core.mindId || mission.mindId !== core.mindId) {
      throw new Error("Role Profile and Mission must belong to the same Mind Core.");
    }
    const graph = input.taskGraphId
      ? this.requireEntity<TaskGraph>(input.taskGraphId, "spinal-plug.task-graph/v0.1", input.space)
      : null;
    if (graph && graph.missionId !== mission.missionId) throw new Error("Task Graph does not belong to Mission.");
    if (valueContainsLikelySecret([core, role, mission, graph])) {
      throw new Error("Refusing to compile a Mind Capsule with likely secret material. Store a secret reference, not the secret value.");
    }
    const memories = this.database.listActiveMemories(input.space.spaceId)
      .filter(memory => !memoryContainsLikelySecret(memory));
    const checkpoint = this.database.latestCheckpoint(input.space.spaceId);
    const timestamp = now();
    const capsule: MindCapsule = {
      schema: "spinal-plug.mind-capsule/v0.1",
      capsuleId: `capsule_${randomUUID()}`,
      mindId: core.mindId,
      spaceId: input.space.spaceId,
      roleProfileId: role.roleProfileId,
      missionId: mission.missionId,
      taskGraphId: graph?.taskGraphId,
      baseSnapshotId: input.baseSnapshotId,
      memoryIds: memories.map(memory => memory.memoryId),
      checkpointId: checkpoint?.checkpointId,
      syncProfile: core.syncProfile,
      bootContext: this.renderCapsule(core, role, mission, graph, input.space),
      sourceEventIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.persist(capsule, false, input.actor);
  }

  spawn(input: SpawnIncarnationInput): Incarnation {
    const capsule = this.requireEntity<MindCapsule>(input.capsuleId, "spinal-plug.mind-capsule/v0.1", input.space);
    const timestamp = now();
    const incarnation: Incarnation = {
      schema: "spinal-plug.incarnation/v0.1",
      incarnationId: `inc_${randomUUID()}`,
      mindId: capsule.mindId,
      capsuleId: capsule.capsuleId,
      spaceId: input.space.spaceId,
      host: input.host,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      status: "active",
      baseSnapshotId: capsule.baseSnapshotId,
      compatibilityWarnings: compact(input.compatibilityWarnings),
      sourceEventIds: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return this.persist(incarnation, false, input.actor);
  }

  setIncarnationStatus(incarnationId: string, status: IncarnationStatus, actor?: Partial<EventActor>): Incarnation {
    const existing = this.requireEntity<Incarnation>(incarnationId, "spinal-plug.incarnation/v0.1");
    return this.persist({ ...existing, status, updatedAt: now() }, true, actor) as Incarnation;
  }

  private renderCapsule(
    core: MindCore,
    role: RoleProfile,
    mission: Mission,
    graph: TaskGraph | null,
    space: ProjectSpace
  ): string {
    const tasks = graph?.tasks.length
      ? graph.tasks.map(task => `- [${task.status}] ${task.title}${task.nextAction ? `; next: ${task.nextAction}` : ""}`).join("\n")
      : "- No task graph loaded.";
    const projectBoot = new ProjectMemoryService(this.database).createBootProjection(space).content;
    return [
      `<spinal-plug_capsule schema="v0.1" mind="${core.displayName}" role="${role.displayName}">`,
      `Persona: ${core.personaId}`,
      `Mission: ${mission.title}`,
      `Objective: ${mission.objective}`,
      role.directives.length ? `Critical directives:\n${role.directives.map(value => `- ${value}`).join("\n")}` : "",
      mission.successCriteria.length ? `Success criteria:\n${mission.successCriteria.map(value => `- ${value}`).join("\n")}` : "",
      `Task graph:\n${tasks}`,
      `Sync: pull=${core.syncProfile.pullMode}; push=${core.syncProfile.pushMode}; apply=${core.syncProfile.applyAt}`,
      projectBoot,
      "</spinal-plug_capsule>"
    ].filter(Boolean).join("\n\n");
  }

  private requireCore(mindId: string, space: ProjectSpace): MindCore {
    return this.requireEntity<MindCore>(mindId, "spinal-plug.mind-core/v0.1", space);
  }

  private requireEntity<T extends RuntimeEntity>(entityId: string, schema: T["schema"], space?: ProjectSpace): T {
    const entity = this.database.getRuntimeEntity<T>(entityId);
    if (!entity || entity.schema !== schema || (space && entity.spaceId !== space.spaceId)) {
      throw new Error(`Runtime entity not found in Project Space: ${entityId}`);
    }
    return entity;
  }

  private persist<T extends RuntimeEntity>(entity: T, update: boolean, actor?: Partial<EventActor>): T {
    if (valueContainsLikelySecret(entity)) {
      throw new Error("Refusing to store likely secret material in runtime context. Store a secret reference, not the secret value.");
    }
    const eventId = `evt_${randomUUID()}`;
    entity.sourceEventIds = [...new Set([...entity.sourceEventIds, eventId])];
    const event: EventEnvelope = {
      schemaVersion: 1,
      eventId,
      eventType: eventTypeFor(entity, update),
      eventVersion: 1,
      accountId: this.identity.accountId,
      personaId: this.identity.personaId,
      spaceId: entity.spaceId,
      actor: defaultActor({ ...this.actorDefaults, ...actor }),
      causality: { parentEventIds: entity.sourceEventIds.slice(0, -1) },
      runtimeContext: {
        incarnationId: entity.schema === "spinal-plug.incarnation/v0.1" ? entity.incarnationId : null,
        roleProfileId: entity.schema === "spinal-plug.role-profile/v0.1" ? entity.roleProfileId : null,
        missionId: entity.schema === "spinal-plug.mission/v0.1" ? entity.missionId : null,
        branchId: null,
        taskCheckpointId: null
      },
      payload: { entityType: entityType(entity), entity },
      createdAt: entity.updatedAt,
      idempotencyKey: eventId
    };
    this.database.recordRuntimeMutation(event, entity);
    return entity;
  }
}
