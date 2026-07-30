#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { ClaudeAutoMemoryImporter, ClaudeAutoMemoryMaterializer, ClaudeCodeAdapter } from "@spinal-plug/adapter-claude-code";
import { CodexAdapter, CodexNativeMemoryStore } from "@spinal-plug/adapter-codex";
import type { HookEventName, SpinalPlugAdapter } from "@spinal-plug/adapter-sdk";
import {
  HttpSyncTransport,
  SpinalPlugDatabase,
  SpinalPlugSyncClient,
  MindRuntimeService,
  ProjectHandoffService,
  ProjectMemoryService,
  ProjectSpaceResolver,
  SecretMaterialError
} from "@spinal-plug/local-node";
import type { MindCapsule, MemoryKind, ProjectSpace } from "@spinal-plug/protocol";

const MEMORY_KINDS: ReadonlySet<string> = new Set(["directive", "decision", "context", "reference"]);
const RUNTIME_ENTITIES: ReadonlySet<string> = new Set([
  "mind-core",
  "role",
  "mission",
  "task-graph",
  "capsule",
  "incarnate"
]);
const HOOK_EVENTS: ReadonlySet<string> = new Set([
  "session.start",
  "prompt.submit",
  "post.tool.use",
  "pre.compact",
  "stop",
  "session.end"
]);

/**
 * Host hooks spawn this CLI without the user's shell profile, so credentials
 * exported there never reach the sync path. Loading the device's env file as
 * a fallback lets hooks publish to an authenticated Control Plane. Explicit
 * environment variables always win.
 */
function loadDeviceEnvFile(): void {
  const home = process.env.SPINAL_PLUG_HOME?.trim() || homedir();
  const path = process.env.SPINAL_PLUG_ENV_FILE
    ?? resolve(home, ".spinal-plug", "device.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?(SPINAL_PLUG_[A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    // A blank variable is an unset one that passed through a shell expansion,
    // not a deliberate value. Treating it as set would let an empty
    // `SPINAL_PLUG_DEVICE_ID=` shadow the real credential in this file.
    if (process.env[key]?.trim()) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDeviceEnvFile();

function printHelp(): void {
  console.log(`spinal-plug

Spinal Plug is the project command and lifecycle runtime.
Endpoint resolution is three-tier: SPINAL_PLUG_SYNC_URL if set, otherwise
the local sync server (127.0.0.1:8787), otherwise silent local mode —
the outbox retains everything for a later retry, no authentication needed.

Commands are grouped by who runs them. If you are a person at a terminal,
the first group is the whole tool, and a host plugin usually runs it for you.

For you:
  connect <db-path> <project-dir> [mode]           Bind this directory; without a mode a Git repository
                                                     becomes a project and anything else an archive.
                                                     Modes: general | archive [name] | link <space-id> [name]
  status <db-path> [project-dir]                   Show user-facing status for the current Space
  boot <db-path> <project-dir>                     Show the Spinal Plug neural-link loading sequence
  share <db-path> <project-dir> <kind> [--url <url>] [--device-id <id>] [--key <semantic-key>] <text>
                                                     Write one durable memory and publish it; publishes when
                                                     --url or SPINAL_PLUG_SYNC_URL is set, local-only otherwise
  handoff <db-path> <project-dir> <json>           Save work state for another Agent to pick up
  handoff <db-path> <project-dir> --latest|--list  Show the newest handoff, or list them

For your Agent (driven by the plugin skill and lifecycle hooks):
  remember <db-path> <project-dir> <kind> [--candidate] [--key <semantic-key>] <text>
                                                     Local staging; --candidate stages for review
  list <db-path> <project-dir> [--all | --candidates | --match <prompt>]
                                                     List active memories; --candidates shows the review
                                                     queue, --match ranks by relevance to a prompt
  keys <db-path> <project-dir>                     List this Space's semantic-key registry
  promote <db-path> <project-dir> <memory-id>      Accept a candidate as active project memory
  update <db-path> <project-dir> <memory-id> <text> Update active memory
  forget <db-path> <project-dir> <memory-id>       Tombstone active memory
  import <db-path> <project-dir> <host> [url] [device-id]
                                                     Import what the host already recorded natively, then
                                                     publish (claude-code only; local mode if unreachable)
  project <db-path> <project-dir> <host>           Refresh a host's native memory from local state (no network)
  hook-stdin <host> <db-path>                      Read a host Hook payload from stdin

Only with a configured sync endpoint:
  fetch <db-path> <project-dir> <url> [device-id]  Fetch updates without applying optional changes.
                                                     Without an id, the credential from
                                                     ~/.spinal-plug/device.env identifies this device
  preview <db-path> <project-dir>                  Preview fetched canonical updates
  apply <db-path> <project-dir> [--host <host>] [--all | update-id...]
                                                     Apply selected updates; no IDs applies all.
                                                     --host also refreshes that host's native memory
  republish <db-path> <project-dir> <url> [device-id]
                                                     Re-send delivered events after switching servers
  space-register <db-path> <project-dir> <url>     Register this Space on an authenticated Control Plane

Reserved extension surface (nothing drives it yet):
  runtime <db-path> <project-dir> [list]           List runtime entities in this Space
  runtime <db-path> <project-dir> <entity> <json>  Create or compile a runtime entity.
                                                     Entities: mind-core | role | mission | task-graph |
                                                     capsule | incarnate

Hosts: claude-code, codex
Kinds: directive, decision, context, reference
`);
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function openDatabase(rawPath: string): { dbPath: string; database: SpinalPlugDatabase } {
  const dbPath = resolve(process.cwd(), rawPath);
  ensureParentDir(dbPath);
  const database = new SpinalPlugDatabase(dbPath);
  database.init();
  return { dbPath, database };
}

function createMemoryService(database: SpinalPlugDatabase): ProjectMemoryService {
  const deviceId = process.env.SPINAL_PLUG_DEVICE_ID;
  return new ProjectMemoryService(database, {
    accountId: process.env.SPINAL_PLUG_ACCOUNT_ID ?? "local",
    personaId: process.env.SPINAL_PLUG_PERSONA_ID ?? "persona_default"
  }, deviceId ? { deviceId } : {});
}

function createSyncTransport(url: string): HttpSyncTransport {
  return new HttpSyncTransport(url, process.env.SPINAL_PLUG_DEVICE_TOKEN);
}

/**
 * The device id stays addressable so a caller can target one device on
 * purpose, but hook and skill call sites run without the user's shell profile
 * and would otherwise have to invent a placeholder to fill the slot. That
 * placeholder overrides the credential device.env just supplied, and an
 * authenticated Control Plane rejects the request for a device that does not
 * match the token. An absent or blank id therefore defers to the environment.
 */
function resolveDeviceId(argument?: string, fallback = "device-local"): string {
  return argument?.trim() || process.env.SPINAL_PLUG_DEVICE_ID?.trim() || fallback;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireMemoryKind(value: string): MemoryKind {
  if (!MEMORY_KINDS.has(value)) {
    throw new Error(`Unsupported memory kind: ${value}`);
  }
  return value as MemoryKind;
}

/**
 * Normalize an LLM-chosen semantic key: kebab-case segments with an optional
 * `namespace:` prefix. Imported Claude topic paths use this same conversion,
 * so every value returned by the registry can be copied into --key unchanged.
 * Normalization is mechanical — classification (which key a fact belongs to)
 * is the host model's job.
 */
function normalizeSemanticKey(raw: string): string {
  const key = raw.trim().toLowerCase()
    .replace(/[\s_./\\]+/g, "-")
    .replace(/[^a-z0-9:-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-:]+|[-:]+$/g, "");
  if (!/^[a-z0-9][a-z0-9-]*(:[a-z0-9][a-z0-9-]*)*$/.test(key)) {
    throw new Error(`Invalid semantic key "${raw}": use kebab-case, optionally with a namespace: prefix.`);
  }
  return key;
}

/**
 * Leading-flag parser: consumes known flags that appear before the free-text
 * argument, so the text itself is kept verbatim — a statement ending in a URL
 * or containing a literal flag token can never be misparsed as options.
 */
function takeLeadingFlags(
  args: string[],
  spec: Record<string, "value" | "boolean">
): { flags: Record<string, string | boolean>; rest: string[] } {
  const flags: Record<string, string | boolean> = {};
  let index = 0;
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so a statement or
  // recall prompt beginning with "constructor", "toString", "valueOf" and the
  // like would be swallowed as a flag and its next word eaten as the value.
  while (index < args.length && Object.hasOwn(spec, args[index])) {
    const flag = args[index];
    if (spec[flag] === "boolean") {
      flags[flag] = true;
      index += 1;
    } else {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error(`Flag ${flag} requires a value.`);
      }
      flags[flag] = value;
      index += 2;
    }
  }
  return { flags, rest: args.slice(index) };
}

function resolveAdapter(host: string): SpinalPlugAdapter {
  if (host === "claude-code") return new ClaudeCodeAdapter();
  if (host === "codex") return new CodexAdapter();
  throw new Error(`Unsupported host: ${host}`);
}

function toHostHookOutput(host: string, event: HookEventName, output: { additionalContext?: string; systemMessage?: string; notices?: string[] }) {
  if (host === "claude-code" && output.additionalContext) {
    const claudeEvent = event === "session.start" ? "SessionStart" : "UserPromptSubmit";
    return {
      hookSpecificOutput: {
        hookEventName: claudeEvent,
        additionalContext: output.additionalContext
      }
    };
  }
  if (host === "codex" && output.additionalContext) {
    const codexEvent: Record<HookEventName, string> = {
      "session.start": "SessionStart",
      "prompt.submit": "UserPromptSubmit",
      "post.tool.use": "PostToolUse",
      "pre.compact": "PreCompact",
      "stop": "Stop",
      "session.end": "SessionEnd"
    };
    return {
      hookSpecificOutput: {
        hookEventName: codexEvent[event],
        additionalContext: output.additionalContext
      }
    };
  }
  if (host === "codex" && output.systemMessage) {
    return { systemMessage: output.systemMessage };
  }
  return output;
}

function createWorkspaceDiscoveryContext(projectDir: string): string {
  const suggestedName = basename(resolve(projectDir));
  return [
    '<spinal-plug_workspace_discovery schema="v0.1">',
    `This non-Git workspace has no Spinal Plug binding. Suggested archive name: ${suggestedName}.`,
    "Ask one concise question before using Spinal Plug memory: create this archive, use General, link an existing archive, or keep Spinal Plug disabled for this directory.",
    "Do not create a binding, write memory, or share anything until the user selects an option.",
    "</spinal-plug_workspace_discovery>"
  ].join("\n");
}

const DEFAULT_LOCAL_SYNC_URL = "http://127.0.0.1:8787";

/**
 * Three-tier endpoint resolution: an explicit SPINAL_PLUG_SYNC_URL wins;
 * otherwise the local development server is tried; if nothing answers there
 * either, publication degrades silently to local mode — the WAL/outbox
 * retains every event for a later retry, and no authentication is ever
 * required for purely local use. `explicit` marks user-chosen endpoints,
 * whose failures are surfaced instead of silently degraded.
 */
function resolveSyncEndpoint(): { url: string; explicit: boolean } {
  const env = process.env.SPINAL_PLUG_SYNC_URL?.trim();
  return env
    ? { url: env, explicit: true }
    : { url: DEFAULT_LOCAL_SYNC_URL, explicit: false };
}

type PublishResult = Awaited<ReturnType<SpinalPlugSyncClient["publish"]>>;

/**
 * Placeholder reported when publication falls back to local mode. Typed
 * against publish()'s real return so a future field addition fails to
 * compile here instead of drifting at each call site.
 */
const LOCAL_ONLY_PUBLISH_RESULT: PublishResult = { pushed: 0, duplicates: 0 };

/**
 * Publish if the endpoint answers. Failures degrade to local mode — unless
 * `strict` (an endpoint the user explicitly chose), where they surface.
 */
async function tryPublish(
  database: SpinalPlugDatabase,
  spaceId: string,
  deviceId: string,
  url: string,
  strict = false
): Promise<{ result: PublishResult; mode: "endpoint" | "local-fallback" }> {
  try {
    const result = await new SpinalPlugSyncClient(database, createSyncTransport(url)).publish(spaceId, deviceId);
    return { result, mode: "endpoint" };
  } catch (error) {
    if (strict) throw error;
    return { result: LOCAL_ONLY_PUBLISH_RESULT, mode: "local-fallback" };
  }
}

interface ClaudeAutoMemoryShareResult {
  source: "claude-code-auto-memory";
  discovered: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedSecretFiles: number;
  shared: { pushed: number; duplicates: number };
  sync: "endpoint" | "local-fallback";
}

/** Import native Claude topic files before publishing; the SQLite cache itself never leaves the device. */
async function shareClaudeAutoMemory(
  database: SpinalPlugDatabase,
  service: ProjectMemoryService,
  space: import("@spinal-plug/protocol").ProjectSpace,
  projectPath: string,
  url: string,
  deviceId: string,
  strict = false
): Promise<ClaudeAutoMemoryShareResult> {
  const imported = new ClaudeAutoMemoryImporter().import(space, projectPath);
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const candidate of imported.candidates) {
    const semanticKey = normalizeSemanticKey(candidate.semanticKey);
    const existing = database.getMemory(candidate.memoryId);
    if (!existing) {
      service.remember({
        space,
        memoryId: candidate.memoryId,
        kind: "context",
        title: candidate.title,
        statement: candidate.statement,
        references: [candidate.sourceUri],
        semanticKey,
        origin: "host_native",
        confidence: 0.95,
        actor: { agentInstallationId: "claude-code-auto-memory", host: "claude-code" }
      });
      created += 1;
    } else if (
      existing.title !== candidate.title
      || existing.statement !== candidate.statement
      || existing.references.length !== 1
      || existing.references[0] !== candidate.sourceUri
      || existing.semanticKey !== semanticKey
    ) {
      service.update(space, {
        memoryId: candidate.memoryId,
        title: candidate.title,
        statement: candidate.statement,
        references: [candidate.sourceUri],
        semanticKey,
        origin: "host_native",
        confidence: 0.95,
        actor: { agentInstallationId: "claude-code-auto-memory", host: "claude-code" }
      });
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  // Publication rides the three-tier endpoint resolution: an unreachable or
  // refusing endpoint degrades to local mode, never an error.
  const { result: shared, mode } = await tryPublish(database, space.spaceId, deviceId, url, strict);
  return {
    source: "claude-code-auto-memory",
    discovered: imported.candidates.length,
    created,
    updated,
    unchanged,
    skippedSecretFiles: imported.skippedSecretFiles,
    shared,
    sync: mode
  };
}

/** Persist a bounded, reviewable candidate queue; no source transcript is retained. */
function drainCodexCandidateJobs(
  database: SpinalPlugDatabase,
  service: ProjectMemoryService,
  space: ProjectSpace
): number {
  let created = 0;
  for (let job = database.claimCandidateExtraction(space.spaceId); job; job = database.claimCandidateExtraction(space.spaceId)) {
    try {
      for (const [index, candidate] of job.candidates.entries()) {
        const memoryId = `mem_candidate_${digest(`${job.jobId}:${index}`).slice(0, 24)}`;
        if (database.getMemory(memoryId)) continue;
        try {
          service.remember({
            space,
            memoryId,
            kind: candidate.kind,
            title: candidate.title,
            statement: candidate.statement,
            why: candidate.why,
            howToApply: candidate.howToApply,
            references: candidate.references,
            semanticKey: candidate.semanticKey,
            origin: "agent_inferred",
            confidence: candidate.confidence,
            asCandidate: true,
            actor: {
              agentInstallationId: "spinal-plug-codex-hook",
              host: "codex",
              sessionId: job.sessionId
            }
          });
          created += 1;
        } catch (error) {
          // A permanent validation failure (secret-shaped content) must not
          // wedge the queue: skip just this candidate and let the job and its
          // siblings complete. Transient errors still requeue below.
          if (error instanceof SecretMaterialError) {
            console.error(`Spinal Plug skipped a secret-shaped candidate from job ${job.jobId}.`);
            continue;
          }
          throw error;
        }
      }
      database.completeCandidateExtraction(job.jobId);
    } catch (error) {
      database.requeueCandidateExtraction(job.jobId);
      throw error;
    }
  }
  return created;
}

/**
 * Refresh a host's native memory from local state. Claude's projection skips
 * memories that were imported from its own topic files, so a fact the host
 * already owns is never written back to it as a managed block.
 */
/** Rejects an unknown host before any caller commits state on its behalf. */
function requireHost(host: string): string {
  if (host !== "claude-code" && host !== "codex") {
    throw new Error(`Unsupported host: ${host}. Use claude-code or codex.`);
  }
  return host;
}

function materializeHostProjection(
  host: string,
  space: ProjectSpace,
  service: ProjectMemoryService,
  projectPath: string
): unknown {
  requireHost(host);
  if (host === "claude-code") {
    const nativeMemoryIds = new Set(
      new ClaudeAutoMemoryImporter().import(space, projectPath).candidates.map(candidate => candidate.memoryId)
    );
    return new ClaudeAutoMemoryMaterializer().materialize(
      projectPath,
      service.list(space).filter(memory => !nativeMemoryIds.has(memory.memoryId))
    );
  }
  if (host === "codex") {
    return new CodexNativeMemoryStore().materialize(space, service.list(space));
  }
  throw new Error(`Unsupported host: ${host}. Use claude-code or codex.`);
}

async function executeHook(
  host: string,
  rawEvent: string,
  rawDbPath: string,
  projectDir: string,
  prompt?: string,
  sessionId?: string,
  output?: string,
  toolFilePath?: string
): Promise<void> {
  if (!HOOK_EVENTS.has(rawEvent)) {
    throw new Error(`Unsupported hook event: ${rawEvent}`);
  }

  // Without a real session id the nudge key would collapse every session into
  // one ("hook-session"), permanently suppressing nudges after the first —
  // so nudging requires an identified session.
  const identifiedSessionId = sessionId ?? process.env.SPINAL_PLUG_SESSION_ID;
  const adapter = resolveAdapter(host);
  const payload = {
    event: rawEvent as HookEventName,
    cwd: resolve(process.cwd(), projectDir),
    sessionId: identifiedSessionId ?? "hook-session",
    prompt,
    output
  };
  const space = await adapter.resolveProjectSpace(payload);
  if (!space) {
    if (payload.event === "session.start") {
      // Discovery must reach the model, so both hosts get additionalContext —
      // a codex systemMessage is only a user-visible warning.
      const output = { additionalContext: createWorkspaceDiscoveryContext(payload.cwd) };
      console.log(JSON.stringify(toHostHookOutput(host, payload.event, output)));
      return;
    }
    // An unlinked workspace remains quiet after its initial selection prompt.
    console.log("{}");
    return;
  }

  const { database } = openDatabase(rawDbPath);
  const service = createMemoryService(database);
  if (payload.event === "session.start") {
    // Claude's own extractor is asynchronous. Import at session boundaries so
    // completed native writes are eventually published without user commands.
    if (host === "claude-code") {
      try {
        await shareClaudeAutoMemory(
          database,
          service,
          space,
          payload.cwd,
          resolveSyncEndpoint().url,
          resolveDeviceId()
        );
      } catch {
        // An unavailable development Control Plane must not delay host startup.
      }
    }
    if (host === "codex") {
      // Keep Codex's reserved native-memory projection current without
      // overwriting any non-Spinal-Plug rows in its private database.
      new CodexNativeMemoryStore().materialize(space, service.list(space));
    }
    const baseProjection = service.createBootProjection(space);
    const requestedCapsuleId = process.env.SPINAL_PLUG_CAPSULE_ID;
    const capsule = requestedCapsuleId
      ? database.getRuntimeEntity<MindCapsule>(requestedCapsuleId)
      : null;
    if (capsule && (capsule.schema !== "spinal-plug.mind-capsule/v0.1" || capsule.spaceId !== space.spaceId)) {
      throw new Error(`Mind Capsule is unavailable for this Project Space: ${requestedCapsuleId}`);
    }
    const projection = capsule
      ? {
        ...baseProjection,
        kind: "mind_capsule" as const,
        content: `${capsule.bootContext}\n\n${baseProjection.content}`,
        relatedMemoryIds: [...new Set([...capsule.memoryIds, ...baseProjection.relatedMemoryIds])]
      }
      : baseProjection;
    if (capsule) {
      new MindRuntimeService(database, {
        accountId: process.env.SPINAL_PLUG_ACCOUNT_ID ?? "local",
        personaId: process.env.SPINAL_PLUG_PERSONA_ID ?? "persona_default"
      }).spawn({
        space,
        capsuleId: capsule.capsuleId,
        host,
        deviceId: resolveDeviceId(undefined, `device-${host}`),
        sessionId: payload.sessionId,
        compatibilityWarnings: []
      });
    }
    const output = await adapter.injectContext(projection, payload);
    console.log(JSON.stringify(toHostHookOutput(host, payload.event, output)));
    return;
  }
  if (payload.event === "prompt.submit" && payload.prompt) {
    if (host === "claude-code") {
      try {
        await shareClaudeAutoMemory(
          database,
          service,
          space,
          payload.cwd,
          resolveSyncEndpoint().url,
          resolveDeviceId()
        );
      } catch {
        // Keep the host prompt path available while the local development server is down.
      }
    }
    const output = await adapter.injectContext(service.createRecallProjection(space, payload.prompt), payload);
    console.log(JSON.stringify(toHostHookOutput(host, payload.event, output)));
    return;
  }

  if (payload.event === "post.tool.use") {
    // A write inside the project's native memory directory means Claude's own
    // extractor (or the main agent) just persisted a topic file: import and
    // publish while it is hot instead of waiting for a session boundary. The
    // importer is idempotent and skips the managed projection file, so this
    // cannot re-trigger itself.
    if (host === "claude-code" && toolFilePath) {
      const memoryDir = new ClaudeAutoMemoryImporter().memoryDirectory(payload.cwd);
      const resolvedFile = resolve(toolFilePath);
      if (resolvedFile.startsWith(memoryDir + sep)) {
        try {
          await shareClaudeAutoMemory(
            database,
            service,
            space,
            payload.cwd,
            resolveSyncEndpoint().url,
            resolveDeviceId()
          );
        } catch {
          // A failed hot-sync is retried at the next session boundary.
        }
      }
    }
    console.log("{}");
    return;
  }

  if (host === "claude-code" && (payload.event === "stop" || payload.event === "session.end")) {
    try {
      await shareClaudeAutoMemory(
        database,
        service,
        space,
        payload.cwd,
        resolveSyncEndpoint().url,
        resolveDeviceId()
      );
    } catch {
      // The next session boundary retries idempotently from the local cache.
    }
  }
  const observations = await adapter.captureObservations(payload);
  let candidatesCreated = 0;
  if (host === "codex" && payload.event === "stop" && observations.length > 0) {
    const sourceDigest = digest(JSON.stringify({
      prompt: payload.prompt ?? "",
      output: payload.output ?? ""
    }));
    database.enqueueCandidateExtraction({
      jobId: `extract_${digest(`${host}:${space.spaceId}:${payload.sessionId}:${sourceDigest}`).slice(0, 32)}`,
      host,
      spaceId: space.spaceId,
      sessionId: payload.sessionId,
      sourceDigest,
      candidates: observations.map(observation => ({
        kind: observation.kind,
        title: observation.title,
        statement: observation.statement,
        why: observation.why,
        howToApply: observation.howToApply,
        references: observation.references,
        semanticKey: observation.semanticKey,
        confidence: observation.confidence
      })),
      createdAt: new Date().toISOString()
    });
    candidatesCreated = drainCodexCandidateJobs(database, service, space);
  }
  if (host === "codex" && payload.event === "stop") {
    try {
      // Held candidate events are intentionally excluded; only confirmed
      // memory and work-state events are eligible for automatic publication.
      await new SpinalPlugSyncClient(
        database,
        createSyncTransport(resolveSyncEndpoint().url)
      ).publish(space.spaceId, resolveDeviceId());
    } catch {
      // The local WAL/outbox retries on a later lifecycle boundary.
    }
  }
  // Empty-chamber nudge: a project with neither active memories nor pending
  // candidates asks the host to generate its first durable memories from the
  // current session. Stop is the only actionable boundary — session.end
  // output can no longer be acted on — and each session is nudged at most
  // once, recorded before printing so a crash cannot re-nudge.
  if (
    payload.event === "stop"
    && identifiedSessionId !== undefined
    && !database.hasDurableMemory(space.spaceId)
    && !database.hasMemoryNudge(space.spaceId, payload.sessionId, host)
  ) {
    database.recordMemoryNudge(space.spaceId, payload.sessionId, host, new Date().toISOString());
    const nudge = buildMemoryNudge(rawDbPath, payload.cwd);
    // Both hosts support blocking a Stop: the reason is handed back to the
    // agent as its next instruction, so generation actually happens instead
    // of passing by as a notice (a codex systemMessage is only a
    // user-visible warning and would never reach the model).
    console.log(JSON.stringify({ decision: "block", reason: nudge }));
    return;
  }
  if (host === "codex") {
    // Codex Stop only accepts its documented common hook fields. Candidate
    // state is durable and discoverable through the plugin commands, so keep
    // the successful lifecycle response intentionally empty.
    console.log("{}");
    return;
  }
  console.log(JSON.stringify({
    notices: [
      candidatesCreated > 0
        ? `Spinal Plug stored ${candidatesCreated} reviewable candidate memor${candidatesCreated === 1 ? "y" : "ies"}.`
        : "Spinal Plug hook completed."
    ]
  }));
}

/** Instruction handed to the host agent when its project memory chamber is empty. */
function buildMemoryNudge(dbPath: string, projectDir: string): string {
  return [
    '<spinal-plug_memory_nudge schema="v0.1">',
    "This project has no durable Spinal Plug memory yet. Review this session and extract up to 3 facts that will still matter after it ends:",
    "- directive: a persistent instruction about how work should be done",
    "- decision: a technical or product choice and its reason",
    "- context: background that cannot be cheaply re-read from the repository",
    "- reference: a pointer to an authoritative external source",
    "Never retain secrets, raw transcripts, or temporary task state. Before staging, classify each fact against the existing semantic keys:",
    `  spinal-plug keys "${dbPath}" "${projectDir}"`,
    "Reuse a listed key when one fits (pass --key <semantic-key>); only mint a new kebab-case key when none does. Then stage each fact as a reviewable candidate:",
    `  spinal-plug remember "${dbPath}" "${projectDir}" <kind> --candidate [--key <semantic-key>] "<concise statement>"`,
    "Then tell the user the candidates are ready for review (spinal-plug list --candidates / promote).",
    "</spinal-plug_memory_nudge>"
  ].join("\n");
}

function mapHostEvent(host: string, hookEventName: unknown): HookEventName | null {
  const event = String(hookEventName);
  const mappings: Record<string, HookEventName> = {
    SessionStart: "session.start",
    UserPromptSubmit: "prompt.submit",
    PostToolUse: "post.tool.use",
    PreCompact: "pre.compact",
    Stop: "stop",
    SessionEnd: "session.end"
  };
  if (host === "claude-code" || host === "codex") return mappings[event] ?? null;
  return null;
}

async function runStdinHook(args: string[]): Promise<void> {
  const [host, rawDbPath] = args;
  if (!host || !rawDbPath) {
    throw new Error("Usage: spinal-plug hook-stdin <host> <db-path>");
  }
  const rawInput = await new Promise<string>((resolveInput, reject) => {
    let content = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { content += chunk; });
    process.stdin.on("end", () => resolveInput(content));
    process.stdin.on("error", reject);
  });
  const input = JSON.parse(rawInput) as Record<string, unknown>;
  const event = mapHostEvent(host, input.hook_event_name);
  if (!event) {
    throw new Error(`Unsupported ${host} hook event: ${String(input.hook_event_name)}`);
  }
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const sessionId = typeof input.session_id === "string" ? input.session_id : undefined;
  const prompt = typeof input.prompt === "string"
    ? input.prompt
    : typeof input.user_prompt === "string"
      ? input.user_prompt
      : undefined;
  const output = typeof input.last_assistant_message === "string"
    ? input.last_assistant_message
    : typeof input.assistant_response === "string"
      ? input.assistant_response
      : typeof input.assistant_message === "string"
        ? input.assistant_message
        : typeof input.output === "string"
          ? input.output
          : undefined;
  const toolInput = input.tool_input as Record<string, unknown> | undefined;
  const toolFilePath = typeof toolInput?.file_path === "string" ? toolInput.file_path : undefined;
  await executeHook(host, event, rawDbPath, cwd, prompt, sessionId, output, toolFilePath);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "hook-stdin") {
    await runStdinHook(args);
    return;
  }
  const [rawDbPath, projectDir, ...rest] = args;
  if (!rawDbPath) {
    throw new Error("Missing <db-path> argument.");
  }
  if (command === "status") {
    if (!projectDir) {
      const { database } = openDatabase(rawDbPath);
      console.log(JSON.stringify({ pendingOutboxEvents: database.listPendingOutbox().length }, null, 2));
      return;
    }
    const resolver = new ProjectSpaceResolver();
    const resolvedSpace = resolver.resolve(resolve(process.cwd(), projectDir));
    if (!resolvedSpace) {
      console.log(JSON.stringify({
        state: "unlinked",
        actions: ["archive", "general", "link", "disabled"]
      }, null, 2));
      return;
    }
    const { database } = openDatabase(rawDbPath);
    const activeMemories = database.listActiveMemories(resolvedSpace.space.spaceId).length;
    const candidateMemories = database.listMemories(resolvedSpace.space.spaceId, true)
      .filter(memory => memory.status === "candidate").length;
    const pendingOutboxEvents = database.listPendingOutboxForSpace(resolvedSpace.space.spaceId).length;
    const pendingRemoteUpdates = database.previewCanonicalUpdates(
      resolvedSpace.space.spaceId
    ).pending.length;
    console.log(JSON.stringify({
      state: "linked",
      space: {
        id: resolvedSpace.space.spaceId,
        type: resolvedSpace.space.type,
        name: resolvedSpace.space.displayName
      },
      activeMemories,
      candidateMemories,
      pendingOutboxEvents,
      pendingRemoteUpdates
    }, null, 2));
    return;
  }
  if (!projectDir) {
    throw new Error("Missing <project-dir> argument.");
  }

  const resolver = new ProjectSpaceResolver();
  const projectPath = resolve(process.cwd(), projectDir);
  if (command === "connect") {
    // Binding a directory is one decision with four answers, so it is one
    // command with an optional mode rather than four near-identical verbs.
    // The database is a private device cache and outbox, not a synced project artifact.
    openDatabase(rawDbPath);
    const [mode, ...modeArgs] = rest;
    let result;
    if (!mode) {
      result = resolver.isGitWorkspace(projectPath)
        ? resolver.initialize(projectPath)
        : resolver.initializeArchive(projectPath);
    } else if (mode === "general") {
      result = resolver.initializeGeneral(projectPath);
    } else if (mode === "archive") {
      result = resolver.initializeArchive(projectPath, modeArgs.join(" ") || undefined);
    } else if (mode === "link") {
      const [spaceId, ...nameParts] = modeArgs;
      if (!spaceId) {
        throw new Error("Usage: spinal-plug connect <db-path> <project-dir> link <space-id> [name]");
      }
      result = resolver.linkExisting(projectPath, spaceId, nameParts.join(" ") || spaceId);
    } else {
      throw new Error(`Unsupported connect mode: ${mode}. Use general, archive, or link.`);
    }
    console.log(`Linked ${result.space.type} Space: ${result.space.displayName}`);
    console.log(`Space ID: ${result.space.spaceId}`);
    console.log(`Manifest: ${result.filePath}`);
    return;
  }

  const resolvedSpace = resolver.resolve(projectPath);
  if (!resolvedSpace) {
    if (command === "boot") {
      console.log([
        "SPINAL-PLUG // NEURAL MEMORY INITIALIZATION v0.2",
        "[01/05] Memory Spinal Plug ....... UNLOCKED",
        "[02/05] Incarnation Link ......... STANDBY",
        "[03/05] Mind Capsule ............. NOT ENGAGED",
        "[04/05] Memory Fidelity .......... NO VERIFIED REFERENCES",
        "[05/05] Neural Uplink ............ IDLE",
        "CAUTION: PROJECT MEMORY CHAMBER IS UNLINKED.",
        "ACTION: Create an archive, use General, link an existing Space, or keep this directory unlinked."
      ].join("\n"));
      return;
    }
    throw new Error("Project Space is not connected. Use spinal-plug connect <db-path> <project-dir> after user confirmation.");
  }

  const space = resolvedSpace.space;
  const { database } = openDatabase(rawDbPath);
  const service = createMemoryService(database);
  const handoffs = new ProjectHandoffService(database, {
    accountId: process.env.SPINAL_PLUG_ACCOUNT_ID ?? "local",
    personaId: process.env.SPINAL_PLUG_PERSONA_ID ?? "persona_default"
  });
  const runtime = new MindRuntimeService(database, {
    accountId: process.env.SPINAL_PLUG_ACCOUNT_ID ?? "local",
    personaId: process.env.SPINAL_PLUG_PERSONA_ID ?? "persona_default"
  });
  if (command === "runtime") {
    // The Mind runtime is a reserved extension surface, not a supported
    // workflow: it takes hand-written JSON and no plugin or skill drives it.
    // Keeping it behind one namespace stops six speculative verbs from
    // reading as peers of `remember` in the top-level command list.
    const [entity, ...entityArgs] = rest;
    if (!entity || entity === "list") {
      console.log(JSON.stringify(database.listRuntimeEntities(space.spaceId), null, 2));
      return;
    }
    if (!RUNTIME_ENTITIES.has(entity)) {
      throw new Error(
        `Unsupported runtime entity: ${entity}. Use list, ${[...RUNTIME_ENTITIES].join(", ")}.`
      );
    }
    const rawInput = entityArgs.join(" ");
    if (!rawInput) {
      throw new Error(`Usage: spinal-plug runtime <db-path> <project-dir> ${entity} <json>`);
    }
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(rawInput) as Record<string, unknown>;
    } catch {
      throw new Error(`runtime ${entity} input must be valid JSON.`);
    }
    const result = entity === "mind-core"
      ? runtime.createMindCore({
        space,
        displayName: String(input.displayName ?? ""),
        personaId: typeof input.personaId === "string" ? input.personaId : undefined,
        syncProfile: typeof input.syncProfile === "object" && input.syncProfile
          ? input.syncProfile as never
          : undefined
      })
      : entity === "role"
        ? runtime.createRoleProfile({
          space,
          mindId: String(input.mindId ?? ""),
          displayName: String(input.displayName ?? ""),
          directives: Array.isArray(input.directives) ? input.directives.map(String) : [],
          requiredCapabilities: Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities.map(String) : []
        })
        : entity === "mission"
          ? runtime.createMission({
            space,
            mindId: String(input.mindId ?? ""),
            title: String(input.title ?? ""),
            objective: String(input.objective ?? ""),
            successCriteria: Array.isArray(input.successCriteria) ? input.successCriteria.map(String) : []
          })
          : entity === "task-graph"
            ? runtime.upsertTaskGraph({
              space,
              mindId: String(input.mindId ?? ""),
              missionId: String(input.missionId ?? ""),
              taskGraphId: typeof input.taskGraphId === "string" ? input.taskGraphId : undefined,
              tasks: Array.isArray(input.tasks) ? input.tasks as never : []
            })
            : entity === "capsule"
              ? runtime.compileCapsule({
                space,
                mindId: String(input.mindId ?? ""),
                roleProfileId: String(input.roleProfileId ?? ""),
                missionId: String(input.missionId ?? ""),
                taskGraphId: typeof input.taskGraphId === "string" ? input.taskGraphId : undefined,
                baseSnapshotId: typeof input.baseSnapshotId === "string" ? input.baseSnapshotId : undefined
              })
              : runtime.spawn({
                space,
                capsuleId: String(input.capsuleId ?? ""),
                host: String(input.host ?? ""),
                deviceId: resolveDeviceId(typeof input.deviceId === "string" ? input.deviceId : undefined),
                sessionId: String(input.sessionId ?? "runtime-session"),
                compatibilityWarnings: Array.isArray(input.compatibilityWarnings)
                  ? input.compatibilityWarnings.map(String)
                  : []
              });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "import") {
    // Distinct from `share`, which writes one new fact: this pulls what the
    // host already recorded natively. Only Claude Code exposes readable
    // per-project memory files; Codex's store is write-only to us.
    const [host, url, deviceId] = rest;
    if (host !== "claude-code") {
      throw new Error(
        `Unsupported import host: ${host || "(none)"}. Only claude-code exposes readable native memory.`
      );
    }
    const endpoint = url?.trim() ? { url: url.trim(), explicit: true } : resolveSyncEndpoint();
    console.log(JSON.stringify(
      await shareClaudeAutoMemory(
        database,
        service,
        space,
        projectPath,
        endpoint.url,
        resolveDeviceId(deviceId),
        endpoint.explicit
      ),
      null,
      2
    ));
    return;
  }
  if (command === "share") {
    const [kind, ...shareArgs] = rest;
    // Flags must precede the text: the statement is kept verbatim, so a
    // trailing URL in the text can never be mistaken for a publish endpoint.
    const { flags, rest: statementParts } = takeLeadingFlags(shareArgs, {
      "--url": "value",
      "--device-id": "value",
      "--key": "value"
    });
    const semanticKey = typeof flags["--key"] === "string"
      ? normalizeSemanticKey(flags["--key"])
      : undefined;
    // An empty --url (e.g. an unset $SPINAL_PLUG_SYNC_URL in plugin scripts)
    // falls through to the same three-tier resolution as no flag at all.
    const endpoint = typeof flags["--url"] === "string" && (flags["--url"] as string).trim()
      ? { url: (flags["--url"] as string).trim(), explicit: true }
      : resolveSyncEndpoint();
    const deviceId = typeof flags["--device-id"] === "string" && flags["--device-id"]
      ? flags["--device-id"] as string
      : resolveDeviceId();
    const statement = statementParts.join(" ");
    if (!kind || !statement) {
      throw new Error("Usage: spinal-plug share <db-path> <project-dir> <kind> [--url <url>] [--device-id <id>] [--key <semantic-key>] <text>");
    }
    const memory = service.remember({ space, kind: requireMemoryKind(kind), statement, ...(semanticKey ? { semanticKey } : {}) });
    const { result: publish, mode } = await tryPublish(database, space.spaceId, deviceId, endpoint.url, endpoint.explicit);
    console.log(JSON.stringify({
      memory,
      shared: publish,
      sync: mode,
      activeMemories: database.listActiveMemories(space.spaceId).length
    }, null, 2));
    return;
  }
  if (command === "remember") {
    const [kind, ...statementArgs] = rest;
    const { flags, rest: parts } = takeLeadingFlags(statementArgs, {
      "--candidate": "boolean",
      "--key": "value"
    });
    const asCandidate = flags["--candidate"] === true;
    const semanticKey = typeof flags["--key"] === "string"
      ? normalizeSemanticKey(flags["--key"])
      : undefined;
    const statement = parts.join(" ");
    if (!kind || !statement) {
      throw new Error("Usage: spinal-plug remember <db-path> <project-dir> <kind> [--candidate] [--key <semantic-key>] <text>");
    }
    // Candidates get a deterministic identity: re-staging the same fact
    // (a retried nudge, a rephrased duplicate) returns the existing record
    // instead of piling up identical candidates.
    const memoryId = asCandidate
      ? `mem_candidate_${digest(`${space.spaceId}:${kind}:${statement}`).slice(0, 24)}`
      : undefined;
    if (memoryId) {
      const existing = database.getMemory(memoryId);
      if (existing) {
        console.log(JSON.stringify({ ...existing, duplicate: true }, null, 2));
        return;
      }
    }
    const memory = service.remember({
      space,
      kind: requireMemoryKind(kind),
      statement,
      ...(memoryId ? { memoryId } : {}),
      ...(semanticKey ? { semanticKey } : {}),
      asCandidate,
      ...(asCandidate ? { origin: "agent_inferred" } : {})
    });
    console.log(JSON.stringify(memory, null, 2));
    return;
  }
  if (command === "promote") {
    const [memoryId] = rest;
    if (!memoryId) throw new Error("Usage: spinal-plug promote <db-path> <project-dir> <memory-id>");
    const memory = service.promote(space, memoryId, {
      agentInstallationId: "spinal-plug-cli-review",
      host: "spinal-plug",
      sessionId: "candidate-review"
    });
    const endpoint = resolveSyncEndpoint();
    const { result: published, mode } = await tryPublish(
      database,
      space.spaceId,
      resolveDeviceId(),
      endpoint.url,
      endpoint.explicit
    );
    console.log(JSON.stringify({ memory, published, sync: mode, pendingOutboxEvents: database.listPendingOutboxForSpace(space.spaceId).length }, null, 2));
    return;
  }
  if (command === "handoff") {
    // Reading work state is the same concept as writing it, so it stays on
    // this command as a flag instead of becoming separate verbs.
    if (rest[0] === "--latest") {
      console.log(JSON.stringify(handoffs.latest(space), null, 2));
      return;
    }
    if (rest[0] === "--list") {
      console.log(JSON.stringify(handoffs.list(space, true), null, 2));
      return;
    }
    const rawHandoff = rest.join(" ");
    if (!rawHandoff) {
      throw new Error("Usage: spinal-plug handoff <db-path> <project-dir> <json> | --latest | --list");
    }
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(rawHandoff) as Record<string, unknown>;
    } catch {
      throw new Error("handoff input must be a JSON object.");
    }
    if (typeof input.title !== "string" || !input.title.trim()) {
      throw new Error("handoff input requires a non-empty title.");
    }
    const strings = (key: string) => Array.isArray(input[key])
      ? input[key].filter((value): value is string => typeof value === "string")
      : undefined;
    const handoff = handoffs.record({
      space,
      title: input.title,
      summary: typeof input.summary === "string" ? input.summary : undefined,
      completed: strings("completed"),
      decisions: strings("decisions"),
      openTasks: strings("openTasks"),
      blockers: strings("blockers"),
      nextAction: typeof input.nextAction === "string" ? input.nextAction : undefined,
      artifactRefs: strings("artifactRefs"),
      parentHandoffId: typeof input.parentHandoffId === "string" ? input.parentHandoffId : undefined,
      actor: { agentInstallationId: "spinal-plug-cli-handoff", host: "spinal-plug", sessionId: "handoff" },
      runtimeContext: {
        missionId: typeof input.missionId === "string" ? input.missionId : null,
        branchId: typeof input.branchId === "string" ? input.branchId : null
      }
    });
    console.log(JSON.stringify({ handoff, pendingOutboxEvents: database.listPendingOutboxForSpace(space.spaceId).length }, null, 2));
    return;
  }
  if (command === "update") {
    const [memoryId, ...statementParts] = rest;
    if (!memoryId || statementParts.length === 0) {
      throw new Error("Usage: spinal-plug update <db-path> <project-dir> <memory-id> <text>");
    }
    console.log(JSON.stringify(service.update(space, { memoryId, statement: statementParts.join(" ") }), null, 2));
    return;
  }
  if (command === "forget") {
    const [memoryId] = rest;
    if (!memoryId) throw new Error("Usage: spinal-plug forget <db-path> <project-dir> <memory-id>");
    console.log(JSON.stringify(service.forget(space, memoryId), null, 2));
    return;
  }
  if (command === "list") {
    // One reader for project memory, three views of it: the active set, the
    // review queue, and prompt-relevant recall.
    const { flags, rest: matchParts } = takeLeadingFlags(rest, {
      "--all": "boolean",
      "--candidates": "boolean",
      "--match": "value"
    });
    if (flags["--candidates"] === true) {
      console.log(JSON.stringify(
        service.list(space, true).filter(memory => memory.status === "candidate"),
        null,
        2
      ));
      return;
    }
    // An explicit but empty --match is a caller bug (an unset shell variable
    // in a plugin snippet), not a request for everything. Refuse it rather
    // than dumping the whole Space as though it were relevant recall.
    if (typeof flags["--match"] === "string" && !flags["--match"].trim()) {
      throw new Error("Usage: spinal-plug list <db-path> <project-dir> --match <prompt> (the prompt cannot be empty)");
    }
    const match = typeof flags["--match"] === "string"
      ? flags["--match"]
      : matchParts.join(" ").trim();
    if (match) {
      console.log(JSON.stringify(service.recall(space, match), null, 2));
      return;
    }
    console.log(JSON.stringify(service.list(space, flags["--all"] === true), null, 2));
    return;
  }
  if (command === "keys") {
    // The semantic-key registry a host classifies new facts against before
    // sharing — classification beats free naming for cross-model consistency.
    console.log(JSON.stringify(database.listSemanticKeys(space.spaceId), null, 2));
    return;
  }
  if (command === "boot") {
    const memories = service.list(space);
    // Disputed records carry status "disputed", which the active-only list
    // excludes — count them from the full view instead.
    const disputed = service.list(space, true)
      .filter(memory => memory.status === "disputed").length;
    const pending = database.listPendingOutboxForSpace(space.spaceId).length;
    const fidelity = memories.length === 0 ? "BASELINE ONLY" : `${memories.length} DURABLE MEMORY REFERENCES`;
    
    const lines = [
      "SPINAL-PLUG // NEURAL MEMORY INITIALIZATION v0.2",
      "[01/05] Memory Spinal Plug ....... LOCKED",
      "[02/05] Incarnation Link ......... NEURAL CHANNEL BOUND",
      "[03/05] Mind Capsule ............. PROJECT-SCOPE CONTEXT ENGAGED",
      `[04/05] Memory Fidelity ........ ${fidelity}`,
      `[05/05] Neural Uplink .......... ${pending === 0 ? "STANDBY" : `${pending} SIGNAL${pending === 1 ? "" : "S"} PENDING`}`,
      ...(disputed > 0
        ? [`WARNING: MEMORY FIDELITY CONFLICT DETECTED — ${disputed} DISPUTED REFERENCE${disputed === 1 ? "" : "S"} AWAITING RESOLUTION`]
        : []),
      "STATUS: SPINAL PLUG LOCKED // MEMORY CHANNEL ONLINE"
    ];

    const latestHandoff = handoffs.latest(space);
    if (latestHandoff) {
      lines.push("");
      lines.push("--- ACTIVE PROJECT HANDOFF ---");
      lines.push(`Title: ${latestHandoff.title}`);
      if (latestHandoff.completed.length) {
        lines.push("Completed:");
        latestHandoff.completed.forEach(c => lines.push(`  - ${c}`));
      }
      if (latestHandoff.openTasks.length) {
        lines.push("Open Tasks:");
        latestHandoff.openTasks.forEach(t => lines.push(`  - ${t}`));
      }
      if (latestHandoff.blockers.length) {
        lines.push("Blockers:");
        latestHandoff.blockers.forEach(b => lines.push(`  - ${b}`));
      }
      if (latestHandoff.nextAction) {
        lines.push(`Next Action: ${latestHandoff.nextAction}`);
      }
      lines.push("------------------------------");
    }

    console.log(lines.join("\n"));
    return;
  }
  if (command === "republish") {
    const [url, deviceIdArgument] = rest;
    if (!url) throw new Error("Usage: spinal-plug republish <db-path> <project-dir> <url> [device-id]");
    const deviceId = resolveDeviceId(deviceIdArgument);
    const transport = createSyncTransport(url);
    // Migrating onto an authenticated Control Plane: local events were minted
    // with the unauthenticated runtime's identity and would be rejected, so
    // adopt the credential's account/device identity before re-sending.
    let identity: { accountId: string; deviceId: string } | null = null;
    if (process.env.SPINAL_PLUG_DEVICE_TOKEN) {
      try {
        const principal = await transport.whoami();
        identity = { accountId: principal.accountId, deviceId: principal.deviceId };
        if (principal.deviceId !== deviceId) {
          throw new Error(`Device ${deviceId} does not match the credential's device ${principal.deviceId}.`);
        }
      } catch (error) {
        if (identity) throw error;
        // Unauthenticated development servers have no /v1/me; nothing to adopt.
      }
    }
    const adopted = identity ? database.adoptIdentityForSpace(space.spaceId, identity) : 0;
    const requeued = database.requeueDeliveredOutboxForSpace(space.spaceId);
    const result = await new SpinalPlugSyncClient(database, transport).publish(space.spaceId, deviceId);
    console.log(JSON.stringify({ adoptedIdentity: adopted, requeued, ...result }, null, 2));
    return;
  }
  if (command === "space-register") {
    const [url] = rest;
    if (!url) throw new Error("Usage: spinal-plug space-register <db-path> <project-dir> <url>");
    const registered = await createSyncTransport(url).registerSpace(space);
    console.log(JSON.stringify(registered, null, 2));
    return;
  }
  if (command === "fetch") {
    const [url, deviceIdArgument] = rest;
    if (!url) {
      throw new Error("Usage: spinal-plug fetch <db-path> <project-dir> <url> [device-id]");
    }
    const result = await new SpinalPlugSyncClient(
      database,
      createSyncTransport(url)
    ).fetch(space.spaceId, resolveDeviceId(deviceIdArgument));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "preview") {
    const preview = database.previewCanonicalUpdates(space.spaceId);
    console.log(JSON.stringify(preview, null, 2));
    return;
  }
  if (command === "apply") {
    // Which host to refresh afterwards is an option, not a separate command:
    // the selection semantics below must stay identical across hosts.
    const hostIndex = rest.indexOf("--host");
    const host = hostIndex === -1 ? undefined : rest[hostIndex + 1];
    // Validate the host before anything is committed. Applying first and
    // checking after would turn `apply --host <typo>` into an irreversible
    // apply-everything: the typo is swallowed as the host name, the
    // selection empties, and the whole review queue merges before the error.
    if (hostIndex !== -1 && (!host || host.startsWith("--"))) {
      throw new Error("Usage: spinal-plug apply <db-path> <project-dir> [--host <host>] [--all | update-id...]");
    }
    if (host !== undefined) requireHost(host);
    // Guard on hostIndex: without --host it is -1, and dropping index
    // hostIndex + 1 would silently eat the first update id, turning a
    // one-update apply into apply-everything.
    const selected = rest.filter((value, index) =>
      value !== "--all"
      && (hostIndex === -1 || (index !== hostIndex && index !== hostIndex + 1)));
    // An empty id is an unset shell variable, not a selection. Left in, it
    // matches no pending update, so the command would apply nothing and still
    // report success — the same silent no-op as an empty --match.
    if (selected.some(value => !value.trim())) {
      throw new Error("Usage: spinal-plug apply <db-path> <project-dir> [--host <host>] [--all | update-id...] (an update id cannot be empty)");
    }
    const applied = database.applyCanonicalUpdates(
      space.spaceId,
      rest.includes("--all") || selected.length === 0 ? undefined : selected
    );
    if (!host) {
      console.log(JSON.stringify(applied, null, 2));
      return;
    }
    const materialized = materializeHostProjection(host, space, service, projectPath);
    console.log(JSON.stringify({ applied, materialized }, null, 2));
    return;
  }
  if (command === "project") {
    // Local projection refresh only: network sync goes through the selective
    // fetch → preview → apply flow, never through this command.
    const [host] = rest;
    if (!host) throw new Error("Usage: spinal-plug project <db-path> <project-dir> <host>");
    console.log(JSON.stringify(
      { materialized: materializeHostProjection(host, space, service, projectPath) },
      null,
      2
    ));
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
