import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const LEGACY_SPACE_FILE = join(".spinal-plug", "space.json");
function findProjectRoot(cwd) {
    let current = resolve(cwd);
    while (dirname(current) !== current) {
        if (existsSync(join(current, ".git"))) {
            return current;
        }
        current = dirname(current);
    }
    return resolve(cwd);
}
function parseSpace(path) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.schema !== "spinal-plug.project-space/v0.1"
        || !["project", "archive", "general"].includes(parsed.type)) {
        throw new Error(`Unsupported Spinal Plug Project Space file: ${path}`);
    }
    return parsed;
}
function repositoryFromGit(rootPath) {
    try {
        const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
            cwd: rootPath,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
        if (!remote)
            return undefined;
        const normalized = remote.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");
        const hostname = new URL(normalized).hostname.toLowerCase();
        const provider = hostname === "github.com"
            ? "github"
            : hostname === "gitlab.com"
                ? "gitlab"
                : "generic-git";
        return { provider, canonicalRemote: normalized };
    }
    catch {
        return undefined;
    }
}
function displayNameFromRepository(repository, rootPath) {
    if (!repository)
        return basename(rootPath);
    try {
        const pathname = new URL(repository.canonicalRemote).pathname;
        const repositoryName = pathname.split("/").filter(Boolean).at(-1);
        return repositoryName || basename(rootPath);
    }
    catch {
        return basename(rootPath);
    }
}
/**
 * A Git remote provides the only stable M1 cross-device project identity.
 * Account namespacing belongs to the authenticated Control Plane in M2+.
 */
function spaceIdFromRepository(repository) {
    if (!repository)
        return `spc_${randomUUID()}`;
    const fingerprint = createHash("sha256")
        .update(repository.canonicalRemote)
        .digest("hex")
        .slice(0, 32);
    return `spc_git_${fingerprint}`;
}
function bindingKey(boundPath) {
    return createHash("sha256").update(boundPath).digest("hex").slice(0, 16);
}
/**
 * Space bindings are device-local state, so they live with the rest of the
 * device state under ~/.spinal-plug/projects/ — never inside the bound
 * project. Worktrees stay pristine (no untracked noise, no accidental
 * commits, read-only directories can bind), matching how Claude Code and
 * Codex keep their per-project state under ~/.claude and ~/.codex.
 */
export class ProjectSpaceResolver {
    bindingsDir;
    constructor(options = {}) {
        this.bindingsDir = join(options.homeDirectory ?? homedir(), ".spinal-plug", "projects");
    }
    resolve(cwd) {
        const resolved = resolve(cwd);
        // The longest registered ancestor wins: Git repositories resolve at
        // their root, and non-Git archives stay discoverable from any
        // subdirectory of the bound path.
        let best = null;
        for (const binding of this.loadBindings()) {
            if (binding.boundPath === resolved || resolved.startsWith(binding.boundPath + sep)) {
                if (!best || binding.boundPath.length > best.boundPath.length) {
                    best = binding;
                }
            }
        }
        if (best) {
            return { rootPath: best.boundPath, filePath: best.filePath, space: best.space };
        }
        // A legacy worktree binding migrates to the home registry on first
        // contact; memory is keyed by spaceId, so nothing else has to move.
        const rootPath = findProjectRoot(cwd);
        const legacyPath = join(rootPath, LEGACY_SPACE_FILE);
        if (!existsSync(legacyPath)) {
            return null;
        }
        const space = parseSpace(legacyPath);
        const migrated = this.writeBinding(rootPath, space);
        try {
            unlinkSync(legacyPath);
            rmSync(join(rootPath, ".spinal-plug"), { recursive: false });
        }
        catch {
            // A non-empty or read-only directory is harmless to leave behind.
        }
        return migrated;
    }
    /** Returns true only for a Git-backed workspace, including worktrees with a .git file. */
    isGitWorkspace(cwd) {
        return existsSync(join(findProjectRoot(cwd), ".git"));
    }
    /**
     * M1 convenience path: Git projects receive a local Project Space on first
     * host session. Non-project conversations remain unlinked until General Space
     * exists as a separate persona-level capability.
     */
    initializeGitWorkspace(cwd) {
        if (!this.isGitWorkspace(cwd))
            return null;
        return this.initialize(cwd);
    }
    initialize(cwd, displayName) {
        const rootPath = findProjectRoot(cwd);
        const existing = this.resolve(rootPath);
        if (existing)
            return existing;
        const repository = repositoryFromGit(rootPath);
        return this.writeBinding(rootPath, {
            schema: "spinal-plug.project-space/v0.1",
            spaceId: spaceIdFromRepository(repository),
            type: "project",
            displayName: displayName ?? displayNameFromRepository(repository, rootPath),
            repository
        });
    }
    /** Creates a durable non-Git workspace archive and binds it to this directory. */
    initializeArchive(cwd, displayName) {
        return this.initializeLocalSpace(cwd, "archive", displayName ?? basename(findProjectRoot(cwd)));
    }
    /** Binds this directory to the user's local General Space in the unauthenticated M1 runtime. */
    initializeGeneral(cwd) {
        return this.initializeLocalSpace(cwd, "general", "General", "spc_general_local");
    }
    /** Links this directory to an existing control-plane Space selected by the user. */
    linkExisting(cwd, spaceId, displayName, type = "archive") {
        if (!spaceId.trim())
            throw new Error("Space ID is required.");
        return this.initializeLocalSpace(cwd, type, displayName, spaceId.trim());
    }
    initializeLocalSpace(cwd, type, displayName, spaceId = `spc_${randomUUID()}`) {
        const rootPath = findProjectRoot(cwd);
        const existing = this.resolve(rootPath);
        if (existing)
            return existing;
        return this.writeBinding(rootPath, {
            schema: "spinal-plug.project-space/v0.1",
            spaceId,
            type,
            displayName
        });
    }
    bindingPath(boundPath) {
        return join(this.bindingsDir, `${bindingKey(boundPath)}.json`);
    }
    loadBindings() {
        if (!existsSync(this.bindingsDir))
            return [];
        const bindings = [];
        for (const entry of readdirSync(this.bindingsDir)) {
            if (!entry.endsWith(".json"))
                continue;
            const filePath = join(this.bindingsDir, entry);
            try {
                const parsed = JSON.parse(readFileSync(filePath, "utf8"));
                if (typeof parsed.boundPath !== "string")
                    continue;
                bindings.push({ boundPath: parsed.boundPath, filePath, space: parseSpace(filePath) });
            }
            catch {
                // An unreadable or malformed binding is skipped, never fatal.
            }
        }
        return bindings;
    }
    writeBinding(rootPath, space) {
        const filePath = this.bindingPath(rootPath);
        mkdirSync(this.bindingsDir, { recursive: true });
        writeFileSync(filePath, `${JSON.stringify({ ...space, boundPath: rootPath }, null, 2)}\n`, "utf8");
        return { rootPath, filePath, space };
    }
    static repository(provider, canonicalRemote) {
        return { provider, canonicalRemote };
    }
}
//# sourceMappingURL=project-space.js.map