import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { containsLikelySecret } from "@spinal-plug/local-node";
import type { ProjectSpace } from "@spinal-plug/protocol";

export interface ClaudeAutoMemoryCandidate {
  memoryId: string;
  title: string;
  statement: string;
  sourceUri: string;
  semanticKey: string;
}

export interface ClaudeAutoMemoryOptions {
  /** Test-only override; production defaults to the current user's Claude home. */
  homeDirectory?: string;
}

function sanitizePath(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "-");
}

function topicTitle(relativePath: string, content: string): string {
  const frontmatterName = /^---\s*\n[\s\S]*?^name:\s*(.+)$/m.exec(content)?.[1]?.trim();
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  return frontmatterName || heading || basename(relativePath, ".md").replace(/[-_]+/g, " ");
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

function scanMarkdown(directory: string, root = directory): string[] {
    const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "logs" || entry.name === "team") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...scanMarkdown(path, root));
    if (
      entry.isFile()
      && entry.name.endsWith(".md")
      && entry.name !== "MEMORY.md"
      && !entry.name.startsWith("spinal-plug-")
      // Legacy underscore naming from an early managed-projection scheme;
      // never re-import our own projection as a native topic file.
      && !entry.name.startsWith("spinal_plug_managed_")
    ) {
      files.push(relative(root, path));
    }
  }
  return files;
}

/** Read-only importer for Claude Code's per-project Auto Memory topic files. */
export class ClaudeAutoMemoryImporter {
  constructor(private readonly options: ClaudeAutoMemoryOptions = {}) {}

  memoryDirectory(cwd: string): string {
    // CLAUDE_CONFIG_DIR names the .claude directory itself, so honour it
    // verbatim rather than appending ".claude" to it. An explicit
    // homeDirectory still wins over ambient environment.
    const configDir = this.options.homeDirectory
      ? join(this.options.homeDirectory, ".claude")
      : process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
    return join(configDir, "projects", sanitizePath(resolve(cwd)), "memory");
  }

  sourceUriPrefix(spaceId: string): string {
    return `claude-auto-memory://${spaceId}/`;
  }

  import(space: ProjectSpace, cwd: string): { candidates: ClaudeAutoMemoryCandidate[]; skippedSecretFiles: number } {
    const directory = this.memoryDirectory(cwd);
    if (!existsSync(directory)) return { candidates: [], skippedSecretFiles: 0 };

    let skippedSecretFiles = 0;
    const candidates = scanMarkdown(directory).flatMap(relativePath => {
      const sourcePath = join(directory, relativePath);
      const raw = readFileSync(sourcePath, "utf8");
      const statement = stripFrontmatter(raw);
      if (!statement) return [];
      // The detector has to see every field that becomes durable memory, not
      // just the body. The title comes from frontmatter `name`, a heading, or
      // the filename, and a secret there passed this filter only to be refused
      // at the write — which aborted the whole import over one file instead of
      // skipping it.
      const title = topicTitle(relativePath, raw);
      if (containsLikelySecret(statement) || containsLikelySecret(title)) {
        skippedSecretFiles += 1;
        return [];
      }
      const sourceUri = `${this.sourceUriPrefix(space.spaceId)}${relativePath}`;
      const memoryId = `mem_cc_${createHash("sha256")
        .update(`${space.spaceId}:${relativePath}`)
        .digest("hex")
        .slice(0, 32)}`;
      return [{
        memoryId,
        title,
        statement,
        sourceUri,
        semanticKey: `claude-topic:${relativePath.toLowerCase()}`
      }];
    });

    return { candidates, skippedSecretFiles };
  }
}

const MANAGED_START = "<!-- spinal-plug:managed:start -->";
const MANAGED_END = "<!-- spinal-plug:managed:end -->";
// Hyphen prefix keeps every managed file inside the importer's
// "spinal-plug-" exclusion, so a projection can never be re-imported.
const MANAGED_PREFIX = "spinal-plug-managed-";
const LEGACY_MANAGED_PREFIX = "spinal_plug_managed_";
const LEGACY_MANAGED_FILE = "spinal-plug-synced.md";

/**
 * Restricts a memory id to filename-safe characters before it touches a path.
 * An id that needed sanitizing gets a short digest of the original, so two
 * distinct ids can never fold into the same managed file.
 */
function managedStem(memoryId: string): string {
  const safe = memoryId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const suffix = safe === memoryId ? "" : `-${createHash("sha256").update(memoryId).digest("hex").slice(0, 8)}`;
  return `${safe}${suffix}`;
}

function managedFilename(memoryId: string): string {
  return `${MANAGED_PREFIX}${managedStem(memoryId)}.md`;
}

/**
 * The frontmatter name identifies the file to the host, so it needs the same
 * injectivity as the filename. A truncated id gave neither: `mem_<uuid>` keeps
 * only four hex characters, and every candidate id collapses to `mem_cand`.
 * Sanitizing also keeps a remote-minted id from breaking the YAML block.
 */
function managedName(kind: string, memoryId: string): string {
  return `spinal-plug-${kind.replace(/[^a-zA-Z0-9_-]/g, "-")}-${managedStem(memoryId)}`;
}

/**
 * Every frontmatter value here comes from a record that may have been minted
 * elsewhere. A double-quoted YAML scalar is JSON-compatible, so quoting keeps a
 * newline in any of them from opening a key of the attacker's choosing.
 */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

export interface ClaudeMemoryMaterializationResult {
  filePath: string; // The entrypoint (MEMORY.md)
  memoryCount: number;
}

/** One-way local projection of Spinal Plug memory into Claude Code's native memory directory. */
export class ClaudeAutoMemoryMaterializer {
  private readonly importer: ClaudeAutoMemoryImporter;

  constructor(options: ClaudeAutoMemoryOptions = {}) {
    this.importer = new ClaudeAutoMemoryImporter(options);
  }

  materialize(cwd: string, memories: ReadonlyArray<{ memoryId: string; kind: string; title: string; statement: string; updatedAt?: string }>): ClaudeMemoryMaterializationResult {
    const directory = this.importer.memoryDirectory(cwd);
    const entrypointPath = join(directory, "MEMORY.md");

    mkdirSync(directory, { recursive: true });

    // Clean up managed files from previous projections, including both
    // legacy naming schemes that predate the current hyphen prefix.
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && (
        ((entry.name.startsWith(MANAGED_PREFIX) || entry.name.startsWith(LEGACY_MANAGED_PREFIX)) && entry.name.endsWith(".md")) ||
        entry.name === LEGACY_MANAGED_FILE
      )) {
        const filePath = join(directory, entry.name);
        try {
          rmSync(filePath, { force: true });
        } catch {
          // Ignore removal errors for individual files
        }
      }
    }

    const indexEntries: string[] = [];

    // Write individual fine-grained memory files
    for (const memory of memories) {
      const filename = managedFilename(memory.memoryId);
      const filePath = join(directory, filename);
      const frontmatter = [
        "---",
        `name: ${managedName(memory.kind, memory.memoryId)}`,
        `description: "Managed by Spinal Plug; do not edit."`,
        "metadata:",
        "  node_type: memory",
        `  type: ${yamlScalar(memory.kind)}`,
        memory.updatedAt ? `  modified: ${yamlScalar(memory.updatedAt)}` : null,
        "---",
        ""
      ].filter(Boolean).join("\n");
      const content = `${frontmatter}\n# ${memory.title}\n\n${memory.statement.trim()}\n`;
      writeFileSync(filePath, content, "utf8");
      
      indexEntries.push(`- [${memory.title}](${filename}) — Generated from Spinal Plug Control Plane`);
    }

    // Claude Code's index is the native discovery point. Preserve all user-owned content.
    const existingIndex = existsSync(entrypointPath) ? readFileSync(entrypointPath, "utf8") : "";
    const managedIndex = [
      MANAGED_START,
      ...(indexEntries.length > 0 ? indexEntries : ["- No synced memory references active."]),
      MANAGED_END
    ].join("\n");
    const markerPattern = new RegExp(`${MANAGED_START}[\\s\\S]*?${MANAGED_END}\\n?`, "g");
    const index = `${existingIndex.replace(markerPattern, "").trimEnd()}${existingIndex.trim() ? "\n\n" : ""}${managedIndex}\n`;

    writeFileSync(entrypointPath, index, "utf8");
    return { filePath: entrypointPath, memoryCount: memories.length };
  }
}
