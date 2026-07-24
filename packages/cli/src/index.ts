#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
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
  ProjectSpaceResolver
} from "@spinal-plug/local-node";
import type { MindCapsule, MemoryKind, ProjectSpace } from "@spinal-plug/protocol";
import {
  createControlPlaneHttpServer,
  createSyncHttpServer,
  SpinalPlugControlPlane,
  PersistentSyncServer
} from "@spinal-plug/sync-server";

const MEMORY_KINDS: ReadonlySet<string> = new Set(["directive", "decision", "context", "reference"]);
const HOOK_EVENTS: ReadonlySet<string> = new Set([
  "session.start",
  "prompt.submit",
  "post.tool.use",
  "pre.compact",
  "stop",
  "session.end"
]);

function printHelp(): void {
  console.log(`spinal-plug

Spinal Plug is the project command and lifecycle runtime.

Commands:
  connect <db-path> <project-dir>                  Create a project or archive binding for this directory
  archive <db-path> <project-dir> [name]           Create a named non-Git workspace archive
  general <db-path> <project-dir>                  Bind this directory to General Space
  link <db-path> <project-dir> <space-id> [name]   Bind this directory to an existing archive
  status <db-path> [project-dir]                   Show user-facing status for the current Space
  boot <db-path> <project-dir>                     Show the Spinal Plug neural-link loading sequence
  share <db-path> <project-dir> <kind> <text> <url> <device-id>
                                                     Share a durable memory with the Control Plane
  share-claude <db-path> <project-dir> <url> <device-id>
                                                     Share current Claude Code project memory
  remember <db-path> <project-dir> <kind> <text>   Internal local staging command
  candidates <db-path> <project-dir>               List reviewable inferred memory candidates
  promote <db-path> <project-dir> <memory-id>      Accept a candidate as active project memory
  checkpoint <db-path> <project-dir> <json>        Save a work-state checkpoint for Agent handoff
  mind-core <db-path> <project-dir> <json>         Create a Mind Core runtime entity
  role <db-path> <project-dir> <json>              Create a Role Profile runtime entity
  mission <db-path> <project-dir> <json>           Create a Mission runtime entity
  task-graph <db-path> <project-dir> <json>        Create or update a Task Graph
  capsule <db-path> <project-dir> <json>           Compile a Mind Capsule boot package
  incarnate <db-path> <project-dir> <json>         Spawn an Incarnation from a Capsule
  runtime <db-path> <project-dir>                  List runtime entities in this Space
  handoff <db-path> <project-dir>                  Show the newest work-state handoff
  checkpoints <db-path> <project-dir>              List work-state checkpoints
  update <db-path> <project-dir> <memory-id> <text> Update active memory
  forget <db-path> <project-dir> <memory-id>       Tombstone active memory
  list <db-path> <project-dir> [--all]             List project memories
  recall <db-path> <project-dir> <prompt>          Print relevant active memories
  sync <db-path> <project-dir> <url> <device-id>   Download and merge central memory updates
  fetch <db-path> <project-dir> <url> <device-id>  Fetch updates without applying optional changes
  preview <db-path> <project-dir>                  Preview fetched canonical updates
  apply <db-path> <project-dir> [update-id...]     Apply selected updates; no IDs applies all
  apply-claude <db-path> <project-dir> [update-id...]
                                                     Apply selection and refresh Claude native memory
  apply-codex <db-path> <project-dir> [update-id...]
                                                     Apply selection and refresh Codex native memory
  sync-claude <db-path> <project-dir> <url> <device-id>
                                                     Sync and materialize into Claude Auto Memory
  sync-codex <db-path> <project-dir> <url> <device-id>
                                                     Sync and materialize into Codex native memory
  serve <server-db-path> [port]                    Start a durable local sync HTTP server
  serve-control-plane <server-db-path> [port]      Start authenticated Control Plane
  control-provision <server-db-path> <account> <email> <owner> <device>
                                                     Provision an account and first device
  hook <host> <event> <db-path> <project-dir> [prompt]
                                                     Emit Claude Code / Codex hook context as JSON
  hook-stdin <host> <db-path>                        Read a host Hook payload from stdin

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

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireMemoryKind(value: string): MemoryKind {
  if (!MEMORY_KINDS.has(value)) {
    throw new Error(`Unsupported memory kind: ${value}`);
  }
  return value as MemoryKind;
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

interface ClaudeAutoMemoryShareResult {
  source: "claude-code-auto-memory";
  discovered: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedSecretFiles: number;
  shared: { pushed: number; duplicates: number };
}

/** Import native Claude topic files before publishing; the SQLite cache itself never leaves the device. */
async function shareClaudeAutoMemory(
  database: SpinalPlugDatabase,
  service: ProjectMemoryService,
  space: import("@spinal-plug/protocol").ProjectSpace,
  projectPath: string,
  url: string,
  deviceId: string
): Promise<ClaudeAutoMemoryShareResult> {
  const imported = new ClaudeAutoMemoryImporter().import(space, projectPath);
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const candidate of imported.candidates) {
    const existing = database.getMemory(candidate.memoryId);
    if (!existing) {
      service.remember({
        space,
        memoryId: candidate.memoryId,
        kind: "context",
        title: candidate.title,
        statement: candidate.statement,
        references: [candidate.sourceUri],
        semanticKey: candidate.semanticKey,
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
    ) {
      service.update(space, {
        memoryId: candidate.memoryId,
        title: candidate.title,
        statement: candidate.statement,
        references: [candidate.sourceUri],
        semanticKey: candidate.semanticKey,
        origin: "host_native",
        confidence: 0.95,
        actor: { agentInstallationId: "claude-code-auto-memory", host: "claude-code" }
      });
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  const shared = await new SpinalPlugSyncClient(database, createSyncTransport(url)).publish(space.spaceId, deviceId);
  return {
    source: "claude-code-auto-memory",
    discovered: imported.candidates.length,
    created,
    updated,
    unchanged,
    skippedSecretFiles: imported.skippedSecretFiles,
    shared
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
      }
      database.completeCandidateExtraction(job.jobId);
    } catch (error) {
      database.requeueCandidateExtraction(job.jobId);
      throw error;
    }
  }
  return created;
}

async function executeHook(
  host: string,
  rawEvent: string,
  rawDbPath: string,
  projectDir: string,
  prompt?: string,
  sessionId = process.env.SPINAL_PLUG_SESSION_ID ?? "hook-session",
  output?: string
): Promise<void> {
  if (!HOOK_EVENTS.has(rawEvent)) {
    throw new Error(`Unsupported hook event: ${rawEvent}`);
  }

  const adapter = resolveAdapter(host);
  const payload = {
    event: rawEvent as HookEventName,
    cwd: resolve(process.cwd(), projectDir),
    sessionId,
    prompt,
    output
  };
  const space = await adapter.resolveProjectSpace(payload);
  if (!space) {
    if (payload.event === "session.start") {
      const discovery = createWorkspaceDiscoveryContext(payload.cwd);
      const output = host === "claude-code"
        ? { additionalContext: discovery }
        : { systemMessage: discovery };
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
          process.env.SPINAL_PLUG_SYNC_URL ?? DEFAULT_LOCAL_SYNC_URL,
          process.env.SPINAL_PLUG_DEVICE_ID ?? "device-local"
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
        deviceId: process.env.SPINAL_PLUG_DEVICE_ID ?? `device-${host}`,
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
          process.env.SPINAL_PLUG_SYNC_URL ?? DEFAULT_LOCAL_SYNC_URL,
          process.env.SPINAL_PLUG_DEVICE_ID ?? "device-local"
        );
      } catch {
        // Keep the host prompt path available while the local development server is down.
      }
    }
    const output = await adapter.injectContext(service.createRecallProjection(space, payload.prompt), payload);
    console.log(JSON.stringify(toHostHookOutput(host, payload.event, output)));
    return;
  }

  if (host === "claude-code" && (payload.event === "stop" || payload.event === "session.end")) {
    try {
      await shareClaudeAutoMemory(
        database,
        service,
        space,
        payload.cwd,
        process.env.SPINAL_PLUG_SYNC_URL ?? DEFAULT_LOCAL_SYNC_URL,
        process.env.SPINAL_PLUG_DEVICE_ID ?? "device-local"
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
        createSyncTransport(process.env.SPINAL_PLUG_SYNC_URL ?? DEFAULT_LOCAL_SYNC_URL)
      ).publish(space.spaceId, process.env.SPINAL_PLUG_DEVICE_ID ?? "device-local");
    } catch {
      // The local WAL/outbox retries on a later lifecycle boundary.
    }
  }
  console.log(JSON.stringify({
    notices: [
      candidatesCreated > 0
        ? `Spinal Plug stored ${candidatesCreated} reviewable candidate memor${candidatesCreated === 1 ? "y" : "ies"}.`
        : "Spinal Plug hook completed."
    ]
  }));
}

async function runHook(args: string[]): Promise<void> {
  const [host, rawEvent, rawDbPath, projectDir, ...promptParts] = args;
  if (!host || !rawEvent || !rawDbPath || !projectDir) {
    throw new Error("Usage: spinal-plug hook <host> <event> <db-path> <project-dir> [prompt]");
  }
  await executeHook(host, rawEvent, rawDbPath, projectDir, promptParts.join(" ") || undefined);
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
  const sessionId = typeof input.session_id === "string" ? input.session_id : "hook-session";
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
  await executeHook(host, event, rawDbPath, cwd, prompt, sessionId, output);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "hook") {
    await runHook(args);
    return;
  }
  if (command === "hook-stdin") {
    await runStdinHook(args);
    return;
  }
  if (command === "serve") {
    const [serverDbPath, rawPort] = args;
    if (!serverDbPath) throw new Error("Usage: spinal-plug serve <server-db-path> [port]");
    const databasePath = resolve(process.cwd(), serverDbPath);
    ensureParentDir(databasePath);
    const syncServer = new PersistentSyncServer(databasePath);
    const httpServer = createSyncHttpServer(syncServer);
    const port = rawPort ? Number(rawPort) : 8787;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer from 1 to 65535.");
    await httpServer.listen(port);
    console.log(`Spinal Plug sync server listening on http://127.0.0.1:${port}`);
    return;
  }
  if (command === "serve-control-plane") {
    const [serverDbPath, rawPort] = args;
    if (!serverDbPath) {
      throw new Error("Usage: spinal-plug serve-control-plane <server-db-path> [port]");
    }
    const bootstrapToken = process.env.SPINAL_PLUG_BOOTSTRAP_TOKEN;
    if (!bootstrapToken) throw new Error("SPINAL_PLUG_BOOTSTRAP_TOKEN is required.");
    const databasePath = resolve(process.cwd(), serverDbPath);
    ensureParentDir(databasePath);
    const certPath = process.env.SPINAL_PLUG_TLS_CERT;
    const keyPath = process.env.SPINAL_PLUG_TLS_KEY;
    if (Boolean(certPath) !== Boolean(keyPath)) {
      throw new Error("SPINAL_PLUG_TLS_CERT and SPINAL_PLUG_TLS_KEY must be set together.");
    }
    const controlPlane = new SpinalPlugControlPlane(databasePath);
    const httpServer = createControlPlaneHttpServer(controlPlane, {
      bootstrapToken,
      tls: certPath && keyPath
        ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
        : undefined
    });
    const port = rawPort ? Number(rawPort) : 8787;
    const host = process.env.SPINAL_PLUG_LISTEN_HOST ?? "127.0.0.1";
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be an integer from 1 to 65535.");
    }
    await httpServer.listen(port, host);
    console.log(`Spinal Plug Control Plane listening on ${httpServer.secure ? "https" : "http"}://${host}:${port}`);
    return;
  }
  if (command === "control-provision") {
    const [serverDbPath, accountName, ownerEmail, ownerName, deviceName] = args;
    if (!serverDbPath || !accountName || !ownerEmail || !ownerName || !deviceName) {
      throw new Error(
        "Usage: spinal-plug control-provision <server-db-path> <account> <email> <owner> <device>"
      );
    }
    const databasePath = resolve(process.cwd(), serverDbPath);
    ensureParentDir(databasePath);
    const controlPlane = new SpinalPlugControlPlane(databasePath);
    try {
      console.log(JSON.stringify(controlPlane.provisionAccount({
        accountName,
        ownerEmail,
        ownerName,
        deviceName
      }), null, 2));
    } finally {
      controlPlane.close();
    }
    return;
  }

  const [rawDbPath, projectDir, ...rest] = args;
  if (!rawDbPath) {
    throw new Error("Missing <db-path> argument.");
  }
  if (command === "init-db") {
    const { dbPath } = openDatabase(rawDbPath);
    console.log(`Initialized Spinal Plug local cache at ${dbPath}`);
    return;
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
  if (command === "connect" || command === "archive" || command === "general" || command === "link") {
    // The database is a private device cache and outbox, not a synced project artifact.
    openDatabase(rawDbPath);
    let result;
    if (command === "general") {
      result = resolver.initializeGeneral(projectPath);
    } else if (command === "archive") {
      result = resolver.initializeArchive(projectPath, rest.join(" ") || undefined);
    } else if (command === "link") {
      const [spaceId, ...nameParts] = rest;
      if (!spaceId) throw new Error("Usage: spinal-plug link <db-path> <project-dir> <space-id> [name]");
      result = resolver.linkExisting(projectPath, spaceId, nameParts.join(" ") || spaceId);
    } else if (resolver.isGitWorkspace(projectPath)) {
      result = resolver.initialize(projectPath);
    } else {
      result = resolver.initializeArchive(projectPath);
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
  if (["mind-core", "role", "mission", "task-graph", "capsule", "incarnate"].includes(command)) {
    const rawInput = rest.join(" ");
    if (!rawInput) throw new Error(`Usage: spinal-plug ${command} <db-path> <project-dir> <json>`);
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(rawInput) as Record<string, unknown>;
    } catch {
      throw new Error(`${command} input must be valid JSON.`);
    }
    const result = command === "mind-core"
      ? runtime.createMindCore({
        space,
        displayName: String(input.displayName ?? ""),
        personaId: typeof input.personaId === "string" ? input.personaId : undefined,
        syncProfile: typeof input.syncProfile === "object" && input.syncProfile
          ? input.syncProfile as never
          : undefined
      })
      : command === "role"
        ? runtime.createRoleProfile({
          space,
          mindId: String(input.mindId ?? ""),
          displayName: String(input.displayName ?? ""),
          directives: Array.isArray(input.directives) ? input.directives.map(String) : [],
          requiredCapabilities: Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities.map(String) : []
        })
        : command === "mission"
          ? runtime.createMission({
            space,
            mindId: String(input.mindId ?? ""),
            title: String(input.title ?? ""),
            objective: String(input.objective ?? ""),
            successCriteria: Array.isArray(input.successCriteria) ? input.successCriteria.map(String) : []
          })
          : command === "task-graph"
            ? runtime.upsertTaskGraph({
              space,
              mindId: String(input.mindId ?? ""),
              missionId: String(input.missionId ?? ""),
              taskGraphId: typeof input.taskGraphId === "string" ? input.taskGraphId : undefined,
              tasks: Array.isArray(input.tasks) ? input.tasks as never : []
            })
            : command === "capsule"
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
                deviceId: String(input.deviceId ?? process.env.SPINAL_PLUG_DEVICE_ID ?? "device-local"),
                sessionId: String(input.sessionId ?? "runtime-session"),
                compatibilityWarnings: Array.isArray(input.compatibilityWarnings)
                  ? input.compatibilityWarnings.map(String)
                  : []
              });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "runtime") {
    console.log(JSON.stringify(database.listRuntimeEntities(space.spaceId), null, 2));
    return;
  }
  if (command === "share-claude") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) {
      throw new Error("Usage: spinal-plug share-claude <db-path> <project-dir> <url> <device-id>");
    }
    console.log(JSON.stringify(await shareClaudeAutoMemory(database, service, space, projectPath, url, deviceId), null, 2));
    return;
  }
  if (command === "share") {
    const [kind, ...shareArgs] = rest;
    const deviceId = shareArgs.pop();
    const url = shareArgs.pop();
    const statement = shareArgs.join(" ");
    if (!kind || !statement || !url || !deviceId) {
      throw new Error("Usage: spinal-plug share <db-path> <project-dir> <kind> <text> <url> <device-id>");
    }
    const memory = service.remember({ space, kind: requireMemoryKind(kind), statement });
    const publish = await new SpinalPlugSyncClient(database, createSyncTransport(url)).publish(space.spaceId, deviceId);
    console.log(JSON.stringify({ memory, shared: publish }, null, 2));
    return;
  }
  if (command === "remember") {
    const [kind, ...statementParts] = rest;
    if (!kind || statementParts.length === 0) {
      throw new Error("Usage: spinal-plug remember <db-path> <project-dir> <kind> <text>");
    }
    const memory = service.remember({ space, kind: requireMemoryKind(kind), statement: statementParts.join(" ") });
    console.log(JSON.stringify(memory, null, 2));
    return;
  }
  if (command === "candidates") {
    console.log(JSON.stringify(
      service.list(space, true).filter(memory => memory.status === "candidate"),
      null,
      2
    ));
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
    let published: unknown = undefined;
    if (process.env.SPINAL_PLUG_SYNC_URL) {
      try {
        published = await new SpinalPlugSyncClient(
          database,
          createSyncTransport(process.env.SPINAL_PLUG_SYNC_URL)
        ).publish(space.spaceId, process.env.SPINAL_PLUG_DEVICE_ID ?? "device-local");
      } catch {
        // The candidate and promotion events remain in the durable outbox.
      }
    }
    console.log(JSON.stringify({ memory, published, pendingOutboxEvents: database.listPendingOutboxForSpace(space.spaceId).length }, null, 2));
    return;
  }
  if (command === "checkpoint") {
    const rawCheckpoint = rest.join(" ");
    if (!rawCheckpoint) {
      throw new Error("Usage: spinal-plug checkpoint <db-path> <project-dir> <json>");
    }
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(rawCheckpoint) as Record<string, unknown>;
    } catch {
      throw new Error("checkpoint input must be a JSON object.");
    }
    if (typeof input.title !== "string" || !input.title.trim()) {
      throw new Error("checkpoint input requires a non-empty title.");
    }
    const strings = (key: string) => Array.isArray(input[key])
      ? input[key].filter((value): value is string => typeof value === "string")
      : undefined;
    const checkpoint = handoffs.checkpoint({
      space,
      title: input.title,
      summary: typeof input.summary === "string" ? input.summary : undefined,
      completed: strings("completed"),
      decisions: strings("decisions"),
      openTasks: strings("openTasks"),
      blockers: strings("blockers"),
      nextAction: typeof input.nextAction === "string" ? input.nextAction : undefined,
      artifactRefs: strings("artifactRefs"),
      parentCheckpointId: typeof input.parentCheckpointId === "string" ? input.parentCheckpointId : undefined,
      actor: { agentInstallationId: "spinal-plug-cli-handoff", host: "spinal-plug", sessionId: "handoff" },
      runtimeContext: {
        missionId: typeof input.missionId === "string" ? input.missionId : null,
        branchId: typeof input.branchId === "string" ? input.branchId : null
      }
    });
    console.log(JSON.stringify({ checkpoint, pendingOutboxEvents: database.listPendingOutboxForSpace(space.spaceId).length }, null, 2));
    return;
  }
  if (command === "handoff") {
    console.log(JSON.stringify(handoffs.latest(space), null, 2));
    return;
  }
  if (command === "checkpoints") {
    console.log(JSON.stringify(handoffs.list(space, true), null, 2));
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
    console.log(JSON.stringify(service.list(space, rest.includes("--all")), null, 2));
    return;
  }
  if (command === "recall") {
    if (rest.length === 0) throw new Error("Usage: spinal-plug recall <db-path> <project-dir> <prompt>");
    console.log(JSON.stringify(service.recall(space, rest.join(" ")), null, 2));
    return;
  }
  if (command === "boot") {
    const memories = service.list(space);
    const pending = database.listPendingOutboxForSpace(space.spaceId).length;
    const fidelity = memories.length === 0 ? "BASELINE ONLY" : `${memories.length} DURABLE MEMORY REFERENCES`;
    const lines = [
      "SPINAL-PLUG // NEURAL MEMORY INITIALIZATION v0.2",
      "[01/05] Memory Spinal Plug ....... LOCKED",
      "[02/05] Incarnation Link ......... NEURAL CHANNEL BOUND",
      "[03/05] Mind Capsule ............. PROJECT-SCOPE CONTEXT ENGAGED",
      `[04/05] Memory Fidelity ........ ${fidelity}`,
      `[05/05] Neural Uplink .......... ${pending === 0 ? "STANDBY" : `${pending} SIGNAL${pending === 1 ? "" : "S"} PENDING`}`,
      "STATUS: SPINAL PLUG LOCKED // MEMORY CHANNEL ONLINE"
    ];
    console.log(lines.join("\n"));
    return;
  }
  if (command === "sync") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) throw new Error("Usage: spinal-plug sync <db-path> <project-dir> <url> <device-id>");
    const result = await new SpinalPlugSyncClient(database, createSyncTransport(url)).synchronize(space.spaceId, deviceId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "fetch") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) {
      throw new Error("Usage: spinal-plug fetch <db-path> <project-dir> <url> <device-id>");
    }
    const result = await new SpinalPlugSyncClient(
      database,
      createSyncTransport(url)
    ).fetch(space.spaceId, deviceId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "preview") {
    const preview = database.previewCanonicalUpdates(space.spaceId);
    console.log(JSON.stringify(preview, null, 2));
    return;
  }
  if (command === "apply") {
    const selected = rest.filter(value => value !== "--all");
    const result = database.applyCanonicalUpdates(
      space.spaceId,
      rest.includes("--all") || selected.length === 0 ? undefined : selected
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "apply-claude") {
    const selected = rest.filter(value => value !== "--all");
    const applied = database.applyCanonicalUpdates(
      space.spaceId,
      rest.includes("--all") || selected.length === 0 ? undefined : selected
    );
    const importer = new ClaudeAutoMemoryImporter();
    const localNativeMemoryIds = new Set(
      importer.import(space, projectPath).candidates.map(candidate => candidate.memoryId)
    );
    const allMemories = service.list(space);
    const projectedMemories = allMemories.filter(memory => !localNativeMemoryIds.has(memory.memoryId));
    const materialized = new ClaudeAutoMemoryMaterializer().materialize(
      projectPath,
      projectedMemories
    );
    console.log(JSON.stringify({ applied, materialized }, null, 2));
    return;
  }
  if (command === "apply-codex") {
    const selected = rest.filter(value => value !== "--all");
    const applied = database.applyCanonicalUpdates(
      space.spaceId,
      rest.includes("--all") || selected.length === 0 ? undefined : selected
    );
    const materialized = new CodexNativeMemoryStore().materialize(space, service.list(space));
    console.log(JSON.stringify({ applied, materialized }, null, 2));
    return;
  }
  if (command === "sync-claude") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) throw new Error("Usage: spinal-plug sync-claude <db-path> <project-dir> <url> <device-id>");
    const synchronized = await new SpinalPlugSyncClient(database, createSyncTransport(url)).synchronize(space.spaceId, deviceId);
    const importer = new ClaudeAutoMemoryImporter();
    const localNativeMemoryIds = new Set(
      importer.import(space, projectPath).candidates.map(candidate => candidate.memoryId)
    );
    const allMemories = service.list(space);
    const projectedMemories = allMemories.filter(memory => !localNativeMemoryIds.has(memory.memoryId));
    const materialized = new ClaudeAutoMemoryMaterializer().materialize(projectPath, projectedMemories);
    console.log(JSON.stringify({
      synchronized,
      materialized,
      excludedLocalClaudeMemories: allMemories.length - projectedMemories.length
    }, null, 2));
    return;
  }
  if (command === "sync-codex") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) throw new Error("Usage: spinal-plug sync-codex <db-path> <project-dir> <url> <device-id>");
    const synchronized = await new SpinalPlugSyncClient(database, createSyncTransport(url)).synchronize(space.spaceId, deviceId);
    const materialized = new CodexNativeMemoryStore().materialize(space, service.list(space));
    console.log(JSON.stringify({ synchronized, materialized }, null, 2));
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
