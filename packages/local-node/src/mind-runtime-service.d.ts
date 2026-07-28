import type { EventActor, Incarnation, IncarnationStatus, MindCapsule, MindCore, Mission, ProjectSpace, RoleProfile, SyncProfile, TaskGraph, TaskNode } from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
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
export declare class MindRuntimeService {
    private readonly database;
    private readonly identity;
    private readonly actorDefaults;
    constructor(database: SpinalPlugDatabase, identity?: {
        accountId: string;
        personaId: string;
    }, actorDefaults?: Partial<EventActor>);
    createMindCore(input: CreateMindCoreInput): MindCore;
    createRoleProfile(input: CreateRoleProfileInput): RoleProfile;
    createMission(input: CreateMissionInput): Mission;
    upsertTaskGraph(input: UpsertTaskGraphInput): TaskGraph;
    compileCapsule(input: CompileCapsuleInput): MindCapsule;
    spawn(input: SpawnIncarnationInput): Incarnation;
    setIncarnationStatus(incarnationId: string, status: IncarnationStatus, actor?: Partial<EventActor>): Incarnation;
    private renderCapsule;
    private requireCore;
    private requireEntity;
    private persist;
}
//# sourceMappingURL=mind-runtime-service.d.ts.map