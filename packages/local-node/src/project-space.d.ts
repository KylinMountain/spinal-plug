import type { ProjectSpace, ProjectSpaceType, RepositoryProvider } from "@spinal-plug/protocol";
export interface ResolvedProjectSpace {
    rootPath: string;
    filePath: string;
    space: ProjectSpace;
}
export interface ProjectSpaceResolverOptions {
    /** Test seam; production uses the real home directory. */
    homeDirectory?: string;
}
/**
 * Space bindings are device-local state, so they live with the rest of the
 * device state under ~/.spinal-plug/projects/ — never inside the bound
 * project. Worktrees stay pristine (no untracked noise, no accidental
 * commits, read-only directories can bind), matching how Claude Code and
 * Codex keep their per-project state under ~/.claude and ~/.codex.
 */
export declare class ProjectSpaceResolver {
    private readonly bindingsDir;
    constructor(options?: ProjectSpaceResolverOptions);
    resolve(cwd: string): ResolvedProjectSpace | null;
    /** Returns true only for a Git-backed workspace, including worktrees with a .git file. */
    isGitWorkspace(cwd: string): boolean;
    /**
     * M1 convenience path: Git projects receive a local Project Space on first
     * host session. Non-project conversations remain unlinked until General Space
     * exists as a separate persona-level capability.
     */
    initializeGitWorkspace(cwd: string): ResolvedProjectSpace | null;
    initialize(cwd: string, displayName?: string): ResolvedProjectSpace;
    /** Creates a durable non-Git workspace archive and binds it to this directory. */
    initializeArchive(cwd: string, displayName?: string): ResolvedProjectSpace;
    /** Binds this directory to the user's local General Space in the unauthenticated M1 runtime. */
    initializeGeneral(cwd: string): ResolvedProjectSpace;
    /** Links this directory to an existing control-plane Space selected by the user. */
    linkExisting(cwd: string, spaceId: string, displayName: string, type?: ProjectSpaceType): ResolvedProjectSpace;
    private initializeLocalSpace;
    private bindingPath;
    private loadBindings;
    private writeBinding;
    static repository(provider: RepositoryProvider, canonicalRemote: string): ProjectSpace["repository"];
}
//# sourceMappingURL=project-space.d.ts.map