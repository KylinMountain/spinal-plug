import type { EventActor, EventRuntimeContext, ProjectCheckpoint, ProjectSpace } from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
export interface CreateCheckpointInput {
    space: ProjectSpace;
    title: string;
    summary?: string;
    completed?: string[];
    decisions?: string[];
    openTasks?: string[];
    blockers?: string[];
    nextAction?: string;
    artifactRefs?: string[];
    parentCheckpointId?: string;
    actor?: Partial<EventActor>;
    runtimeContext?: Partial<EventRuntimeContext>;
}
/** Work-state service. Checkpoints are handoff artifacts, never canonical memory. */
export declare class ProjectHandoffService {
    private readonly database;
    private readonly identity;
    private readonly actorDefaults;
    constructor(database: SpinalPlugDatabase, identity?: {
        accountId: string;
        personaId: string;
    }, actorDefaults?: Partial<EventActor>);
    checkpoint(input: CreateCheckpointInput): ProjectCheckpoint;
    latest(space: ProjectSpace): ProjectCheckpoint | null;
    list(space: ProjectSpace, includeInactive?: boolean): ProjectCheckpoint[];
    formatForBoot(space: ProjectSpace): string | null;
}
//# sourceMappingURL=project-handoff-service.d.ts.map