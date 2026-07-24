import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ProjectSpace, ProjectSpaceType, RepositoryProvider } from "@spinal-plug/protocol";

const SPACE_FILE = join(".spinal-plug", "space.json");

function findProjectRoot(cwd: string): string {
  let current = resolve(cwd);

  while (dirname(current) !== current) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }

  return resolve(cwd);
}

function parseSpace(path: string): ProjectSpace {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectSpace;
  if (
    parsed.schema !== "spinal-plug.project-space/v0.1"
    || !["project", "archive", "general"].includes(parsed.type)
  ) {
    throw new Error(`Unsupported Spinal Plug Project Space file: ${path}`);
  }
  return parsed;
}

function repositoryFromGit(rootPath: string): ProjectSpace["repository"] | undefined {
  try {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: rootPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!remote) return undefined;

    const normalized = remote.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");
    const hostname = new URL(normalized).hostname.toLowerCase();
    const provider: RepositoryProvider = hostname === "github.com"
      ? "github"
      : hostname === "gitlab.com"
        ? "gitlab"
        : "generic-git";
    return { provider, canonicalRemote: normalized };
  } catch {
    return undefined;
  }
}

function displayNameFromRepository(repository: ProjectSpace["repository"] | undefined, rootPath: string): string {
  if (!repository) return basename(rootPath);
  try {
    const pathname = new URL(repository.canonicalRemote).pathname;
    const repositoryName = pathname.split("/").filter(Boolean).at(-1);
    return repositoryName || basename(rootPath);
  } catch {
    return basename(rootPath);
  }
}

/**
 * A Git remote provides the only stable M1 cross-device project identity.
 * Account namespacing belongs to the authenticated Control Plane in M2+.
 */
function spaceIdFromRepository(repository: ProjectSpace["repository"] | undefined): string {
  if (!repository) return `spc_${randomUUID()}`;
  const fingerprint = createHash("sha256")
    .update(repository.canonicalRemote)
    .digest("hex")
    .slice(0, 32);
  return `spc_git_${fingerprint}`;
}

export interface ResolvedProjectSpace {
  rootPath: string;
  filePath: string;
  space: ProjectSpace;
}

export class ProjectSpaceResolver {
  resolve(cwd: string): ResolvedProjectSpace | null {
    const rootPath = findProjectRoot(cwd);
    const filePath = join(rootPath, SPACE_FILE);
    if (!existsSync(filePath)) {
      return null;
    }

    return { rootPath, filePath, space: parseSpace(filePath) };
  }

  /** Returns true only for a Git-backed workspace, including worktrees with a .git file. */
  isGitWorkspace(cwd: string): boolean {
    return existsSync(join(findProjectRoot(cwd), ".git"));
  }

  /**
   * M1 convenience path: Git projects receive a local Project Space on first
   * host session. Non-project conversations remain unlinked until General Space
   * exists as a separate persona-level capability.
   */
  initializeGitWorkspace(cwd: string): ResolvedProjectSpace | null {
    if (!this.isGitWorkspace(cwd)) return null;
    return this.initialize(cwd);
  }

  initialize(cwd: string, displayName?: string): ResolvedProjectSpace {
    const rootPath = findProjectRoot(cwd);
    const filePath = join(rootPath, SPACE_FILE);
    if (existsSync(filePath)) {
      return { rootPath, filePath, space: parseSpace(filePath) };
    }

    const repository = repositoryFromGit(rootPath);
    const space: ProjectSpace = {
      schema: "spinal-plug.project-space/v0.1",
      spaceId: spaceIdFromRepository(repository),
      type: "project",
      displayName: displayName ?? displayNameFromRepository(repository, rootPath),
      repository
    };

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(space, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { rootPath, filePath, space };
  }

  /** Creates a durable non-Git workspace archive and binds it to this directory. */
  initializeArchive(cwd: string, displayName?: string): ResolvedProjectSpace {
    return this.initializeLocalSpace(cwd, "archive", displayName ?? basename(findProjectRoot(cwd)));
  }

  /** Binds this directory to the user's local General Space in the unauthenticated M1 runtime. */
  initializeGeneral(cwd: string): ResolvedProjectSpace {
    return this.initializeLocalSpace(cwd, "general", "General", "spc_general_local");
  }

  /** Links this directory to an existing control-plane Space selected by the user. */
  linkExisting(cwd: string, spaceId: string, displayName: string, type: ProjectSpaceType = "archive"): ResolvedProjectSpace {
    if (!spaceId.trim()) throw new Error("Space ID is required.");
    return this.initializeLocalSpace(cwd, type, displayName, spaceId.trim());
  }

  private initializeLocalSpace(
    cwd: string,
    type: ProjectSpaceType,
    displayName: string,
    spaceId = `spc_${randomUUID()}`
  ): ResolvedProjectSpace {
    const rootPath = findProjectRoot(cwd);
    const filePath = join(rootPath, SPACE_FILE);
    if (existsSync(filePath)) {
      return { rootPath, filePath, space: parseSpace(filePath) };
    }

    const space: ProjectSpace = {
      schema: "spinal-plug.project-space/v0.1",
      spaceId,
      type,
      displayName
    };
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(space, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return { rootPath, filePath, space };
  }

  static repository(provider: RepositoryProvider, canonicalRemote: string): ProjectSpace["repository"] {
    return { provider, canonicalRemote };
  }
}
