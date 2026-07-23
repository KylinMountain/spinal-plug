#!/usr/bin/env node

import { mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { ClaudeAutoMemoryImporter, ClaudeAutoMemoryMaterializer, ClaudeCodeAdapter } from "@mind-palace/adapter-claude-code";
import { CodexAdapter, CodexNativeMemoryStore } from "@mind-palace/adapter-codex";
import type { HookEventName, MindPalaceAdapter } from "@mind-palace/adapter-sdk";
import {
  HttpSyncTransport,
  MindPalaceDatabase,
  MindPalaceSyncClient,
  ProjectMemoryService,
  ProjectSpaceResolver
} from "@mind-palace/local-node";
import type { MemoryKind } from "@mind-palace/protocol";
import {
  createControlPlaneHttpServer,
  createSyncHttpServer,
  MindPalaceControlPlane,
  PersistentSyncServer
} from "@mind-palace/sync-server";

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
  console.log(`mind-palace

Commands:
  connect <db-path> <project-dir>                  Create a project or archive binding for this directory
  archive <db-path> <project-dir> [name]           Create a named non-Git workspace archive
  general <db-path> <project-dir>                  Bind this directory to General Space
  link <db-path> <project-dir> <space-id> [name]   Bind this directory to an existing archive
  init <db-path> [project-dir]                     Legacy alias for connect (development compatibility)
  status <db-path> [project-dir]                   Show user-facing status for the current Space
  boot <db-path> <project-dir>                     Show the Mind Palace memory-core loading sequence
  share <db-path> <project-dir> <kind> <text> <url> <device-id>
                                                     Share a durable memory with the Control Plane
  share-claude <db-path> <project-dir> <url> <device-id>
                                                     Share current Claude Code project memory
  remember <db-path> <project-dir> <kind> <text>   Internal local staging command
  update <db-path> <project-dir> <memory-id> <text> Update active memory
  forget <db-path> <project-dir> <memory-id>       Tombstone active memory
  list <db-path> <project-dir> [--all]             List project memories
  recall <db-path> <project-dir> <prompt>          Print relevant active memories
  sync <db-path> <project-dir> <url> <device-id>   Download and merge central memory updates
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

function openDatabase(rawPath: string): { dbPath: string; database: MindPalaceDatabase } {
  const dbPath = resolve(process.cwd(), rawPath);
  ensureParentDir(dbPath);
  const database = new MindPalaceDatabase(dbPath);
  database.init();
  return { dbPath, database };
}

function createMemoryService(database: MindPalaceDatabase): ProjectMemoryService {
  const deviceId = process.env.MIND_PALACE_DEVICE_ID;
  return new ProjectMemoryService(database, {
    accountId: process.env.MIND_PALACE_ACCOUNT_ID ?? "local",
    personaId: process.env.MIND_PALACE_PERSONA_ID ?? "persona_default"
  }, deviceId ? { deviceId } : {});
}

function createSyncTransport(url: string): HttpSyncTransport {
  return new HttpSyncTransport(url, process.env.MIND_PALACE_DEVICE_TOKEN);
}

function requireMemoryKind(value: string): MemoryKind {
  if (!MEMORY_KINDS.has(value)) {
    throw new Error(`Unsupported memory kind: ${value}`);
  }
  return value as MemoryKind;
}

function resolveAdapter(host: string): MindPalaceAdapter {
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
    '<mind-palace_workspace_discovery schema="v0.1">',
    `This non-Git workspace has no Mind Palace binding. Suggested archive name: ${suggestedName}.`,
    "Ask one concise question before using Mind Palace memory: create this archive, use General, link an existing archive, or keep Mind Palace disabled for this directory.",
    "Do not create a binding, write memory, or share anything until the user selects an option.",
    "</mind-palace_workspace_discovery>"
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
  database: MindPalaceDatabase,
  service: ProjectMemoryService,
  space: import("@mind-palace/protocol").ProjectSpace,
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
  const shared = await new MindPalaceSyncClient(database, createSyncTransport(url)).publish(space.spaceId, deviceId);
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

async function executeHook(
  host: string,
  rawEvent: string,
  rawDbPath: string,
  projectDir: string,
  prompt?: string,
  sessionId = process.env.MIND_PALACE_SESSION_ID ?? "hook-session"
): Promise<void> {
  if (!HOOK_EVENTS.has(rawEvent)) {
    throw new Error(`Unsupported hook event: ${rawEvent}`);
  }

  const adapter = resolveAdapter(host);
  const payload = {
    event: rawEvent as HookEventName,
    cwd: resolve(process.cwd(), projectDir),
    sessionId,
    prompt
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
          process.env.MIND_PALACE_SYNC_URL ?? DEFAULT_LOCAL_SYNC_URL,
          process.env.MIND_PALACE_DEVICE_ID ?? "device-local"
        );
      } catch {
        // An unavailable development Control Plane must not delay host startup.
      }
    }
    const output = await adapter.injectContext(service.createBootProjection(space), payload);
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
          process.env.MIND_PALACE_SYNC_URL ?? DEFAULT_LOCAL_SYNC_URL,
          process.env.MIND_PALACE_DEVICE_ID ?? "device-local"
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
        process.env.MIND_PALACE_SYNC_URL ?? DEFAULT_LOCAL_SYNC_URL,
        process.env.MIND_PALACE_DEVICE_ID ?? "device-local"
      );
    } catch {
      // The next session boundary retries idempotently from the local cache.
    }
  }
  await adapter.captureObservations(payload);
  console.log(JSON.stringify({ notices: ["Mind Palace hook completed."] }));
}

async function runHook(args: string[]): Promise<void> {
  const [host, rawEvent, rawDbPath, projectDir, ...promptParts] = args;
  if (!host || !rawEvent || !rawDbPath || !projectDir) {
    throw new Error("Usage: mind-palace hook <host> <event> <db-path> <project-dir> [prompt]");
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
    throw new Error("Usage: mind-palace hook-stdin <host> <db-path>");
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
  await executeHook(host, event, rawDbPath, cwd, prompt, sessionId);
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
    if (!serverDbPath) throw new Error("Usage: mind-palace serve <server-db-path> [port]");
    const databasePath = resolve(process.cwd(), serverDbPath);
    ensureParentDir(databasePath);
    const syncServer = new PersistentSyncServer(databasePath);
    const httpServer = createSyncHttpServer(syncServer);
    const port = rawPort ? Number(rawPort) : 8787;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer from 1 to 65535.");
    await httpServer.listen(port);
    console.log(`Mind Palace sync server listening on http://127.0.0.1:${port}`);
    return;
  }
  if (command === "serve-control-plane") {
    const [serverDbPath, rawPort] = args;
    if (!serverDbPath) {
      throw new Error("Usage: mind-palace serve-control-plane <server-db-path> [port]");
    }
    const bootstrapToken = process.env.MIND_PALACE_BOOTSTRAP_TOKEN;
    if (!bootstrapToken) throw new Error("MIND_PALACE_BOOTSTRAP_TOKEN is required.");
    const databasePath = resolve(process.cwd(), serverDbPath);
    ensureParentDir(databasePath);
    const certPath = process.env.MIND_PALACE_TLS_CERT;
    const keyPath = process.env.MIND_PALACE_TLS_KEY;
    if (Boolean(certPath) !== Boolean(keyPath)) {
      throw new Error("MIND_PALACE_TLS_CERT and MIND_PALACE_TLS_KEY must be set together.");
    }
    const controlPlane = new MindPalaceControlPlane(databasePath);
    const httpServer = createControlPlaneHttpServer(controlPlane, {
      bootstrapToken,
      tls: certPath && keyPath
        ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
        : undefined
    });
    const port = rawPort ? Number(rawPort) : 8787;
    const host = process.env.MIND_PALACE_LISTEN_HOST ?? "127.0.0.1";
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Port must be an integer from 1 to 65535.");
    }
    await httpServer.listen(port, host);
    console.log(`Mind Palace Control Plane listening on ${httpServer.secure ? "https" : "http"}://${host}:${port}`);
    return;
  }
  if (command === "control-provision") {
    const [serverDbPath, accountName, ownerEmail, ownerName, deviceName] = args;
    if (!serverDbPath || !accountName || !ownerEmail || !ownerName || !deviceName) {
      throw new Error(
        "Usage: mind-palace control-provision <server-db-path> <account> <email> <owner> <device>"
      );
    }
    const databasePath = resolve(process.cwd(), serverDbPath);
    ensureParentDir(databasePath);
    const controlPlane = new MindPalaceControlPlane(databasePath);
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
    console.log(`Initialized Mind Palace local cache at ${dbPath}`);
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
    const pendingOutboxEvents = database.listPendingOutboxForSpace(resolvedSpace.space.spaceId).length;
    console.log(JSON.stringify({
      state: "linked",
      space: {
        id: resolvedSpace.space.spaceId,
        type: resolvedSpace.space.type,
        name: resolvedSpace.space.displayName
      },
      activeMemories,
      pendingOutboxEvents
    }, null, 2));
    return;
  }
  if (!projectDir) {
    throw new Error("Missing <project-dir> argument.");
  }

  const resolver = new ProjectSpaceResolver();
  const projectPath = resolve(process.cwd(), projectDir);
  if (command === "init" || command === "connect" || command === "archive" || command === "general" || command === "link") {
    // The database is a private device cache and outbox, not a synced project artifact.
    openDatabase(rawDbPath);
    let result;
    if (command === "general") {
      result = resolver.initializeGeneral(projectPath);
    } else if (command === "archive") {
      result = resolver.initializeArchive(projectPath, rest.join(" ") || undefined);
    } else if (command === "link") {
      const [spaceId, ...nameParts] = rest;
      if (!spaceId) throw new Error("Usage: mind-palace link <db-path> <project-dir> <space-id> [name]");
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
        "MIND PALACE // MEMORY CORE BOOT SEQUENCE v0.1",
        "[01/05] Project Space ............ UNLINKED",
        "[02/05] Incarnation Link ......... STANDBY",
        "[03/05] Mind Capsule ............. NOT REQUESTED",
        "[04/05] Memory Fidelity .......... NOT AVAILABLE",
        "[05/05] Sync Uplink .............. IDLE",
        "STATUS: AWAITING WORKSPACE SELECTION",
        "ACTION: Create an archive, use General, link an existing Space, or keep this directory unlinked."
      ].join("\n"));
      return;
    }
    throw new Error("Project Space is not connected. Use mind-palace connect <db-path> <project-dir> after user confirmation.");
  }

  const space = resolvedSpace.space;
  const { database } = openDatabase(rawDbPath);
  const service = createMemoryService(database);
  if (command === "share-claude") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) {
      throw new Error("Usage: mind-palace share-claude <db-path> <project-dir> <url> <device-id>");
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
      throw new Error("Usage: mind-palace share <db-path> <project-dir> <kind> <text> <url> <device-id>");
    }
    const memory = service.remember({ space, kind: requireMemoryKind(kind), statement });
    const publish = await new MindPalaceSyncClient(database, createSyncTransport(url)).publish(space.spaceId, deviceId);
    console.log(JSON.stringify({ memory, shared: publish }, null, 2));
    return;
  }
  if (command === "remember") {
    const [kind, ...statementParts] = rest;
    if (!kind || statementParts.length === 0) {
      throw new Error("Usage: mind-palace remember <db-path> <project-dir> <kind> <text>");
    }
    const memory = service.remember({ space, kind: requireMemoryKind(kind), statement: statementParts.join(" ") });
    console.log(JSON.stringify(memory, null, 2));
    return;
  }
  if (command === "update") {
    const [memoryId, ...statementParts] = rest;
    if (!memoryId || statementParts.length === 0) {
      throw new Error("Usage: mind-palace update <db-path> <project-dir> <memory-id> <text>");
    }
    console.log(JSON.stringify(service.update(space, { memoryId, statement: statementParts.join(" ") }), null, 2));
    return;
  }
  if (command === "forget") {
    const [memoryId] = rest;
    if (!memoryId) throw new Error("Usage: mind-palace forget <db-path> <project-dir> <memory-id>");
    console.log(JSON.stringify(service.forget(space, memoryId), null, 2));
    return;
  }
  if (command === "list") {
    console.log(JSON.stringify(service.list(space, rest.includes("--all")), null, 2));
    return;
  }
  if (command === "recall") {
    if (rest.length === 0) throw new Error("Usage: mind-palace recall <db-path> <project-dir> <prompt>");
    console.log(JSON.stringify(service.recall(space, rest.join(" ")), null, 2));
    return;
  }
  if (command === "boot") {
    const memories = service.list(space);
    const pending = database.listPendingOutboxForSpace(space.spaceId).length;
    const fidelity = memories.length === 0 ? "BASELINE ONLY" : `${memories.length} DURABLE MEMORY REFERENCES`;
    const lines = [
      "MIND PALACE // MEMORY CORE BOOT SEQUENCE v0.1",
      "[01/05] Mind Palace Control Plane . LOCAL LINK ESTABLISHED",
      "[02/05] Incarnation Link ......... HOST CONTEXT BOUND",
      "[03/05] Mind Capsule ............. PROJECT-SCOPE CONTEXT READY",
      `[04/05] Memory Fidelity ........ ${fidelity}`,
      `[05/05] Sync Uplink ............ ${pending === 0 ? "STANDBY" : `${pending} EVENT${pending === 1 ? "" : "S"} PENDING`}`,
      "STATUS: MEMORY CORE LOADED"
    ];
    console.log(lines.join("\n"));
    return;
  }
  if (command === "sync") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) throw new Error("Usage: mind-palace sync <db-path> <project-dir> <url> <device-id>");
    const result = await new MindPalaceSyncClient(database, createSyncTransport(url)).synchronize(space.spaceId, deviceId);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "sync-claude") {
    const [url, deviceId] = rest;
    if (!url || !deviceId) throw new Error("Usage: mind-palace sync-claude <db-path> <project-dir> <url> <device-id>");
    const synchronized = await new MindPalaceSyncClient(database, createSyncTransport(url)).synchronize(space.spaceId, deviceId);
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
    if (!url || !deviceId) throw new Error("Usage: mind-palace sync-codex <db-path> <project-dir> <url> <device-id>");
    const synchronized = await new MindPalaceSyncClient(database, createSyncTransport(url)).synchronize(space.spaceId, deviceId);
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
