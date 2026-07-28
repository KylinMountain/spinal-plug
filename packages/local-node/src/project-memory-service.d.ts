import type { EventActor, EventRuntimeContext, MemoryKind, MemoryOrigin, MemoryRecord, ProjectionKind, ProjectSpace } from "@spinal-plug/protocol";
import { SpinalPlugDatabase } from "./index.js";
export interface ProjectMemoryProjection {
    kind: ProjectionKind;
    space: ProjectSpace;
    content: string;
    generatedAt: string;
    relatedMemoryIds: string[];
}
export interface RememberMemoryInput {
    space: ProjectSpace;
    memoryId?: string;
    kind: MemoryKind;
    statement: string;
    title?: string;
    why?: string;
    howToApply?: string;
    references?: string[];
    semanticKey?: string;
    origin?: MemoryOrigin;
    confidence?: number;
    asCandidate?: boolean;
    actor?: Partial<EventActor>;
    runtimeContext?: Partial<EventRuntimeContext>;
}
export interface UpdateMemoryInput {
    memoryId: string;
    title?: string;
    statement?: string;
    why?: string;
    howToApply?: string;
    references?: string[];
    semanticKey?: string;
    origin?: MemoryOrigin;
    confidence?: number;
    actor?: Partial<EventActor>;
}
export declare class ProjectMemoryService {
    private readonly database;
    private readonly identity;
    private readonly actorDefaults;
    constructor(database: SpinalPlugDatabase, identity?: {
        accountId: string;
        personaId: string;
    }, actorDefaults?: Partial<EventActor>);
    remember(input: RememberMemoryInput): MemoryRecord;
    update(space: ProjectSpace, input: UpdateMemoryInput): MemoryRecord;
    forget(space: ProjectSpace, memoryId: string, actor?: Partial<EventActor>): MemoryRecord;
    promote(space: ProjectSpace, memoryId: string, actor?: Partial<EventActor>): MemoryRecord;
    list(space: ProjectSpace, includeInactive?: boolean): MemoryRecord[];
    recall(space: ProjectSpace, prompt: string, limit?: number): MemoryRecord[];
    createBootProjection(space: ProjectSpace, limit?: number): ProjectMemoryProjection;
    createRecallProjection(space: ProjectSpace, prompt: string, limit?: number): ProjectMemoryProjection;
    private createProjection;
}
//# sourceMappingURL=project-memory-service.d.ts.map