import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Black-box tests over the built CLI. They exercise the real argv dispatch,
 * host Hook wiring and endpoint degradation without importing anything from
 * index.ts, so the surface stays free to be refactored underneath them: a
 * command that changes its observable contract fails here, an internal
 * reshuffle does not.
 */
const CLI = fileURLToPath(new URL("./index.js", import.meta.url));

interface Workspace {
  readonly home: string;
  readonly db: string;
  readonly project: string;
}

/**
 * Redirects every device-local location the CLI writes to — Space bindings,
 * Claude's projected topic files, Codex's native store — into one throwaway
 * home, so a test run can neither read nor corrupt real developer state.
 */
function createWorkspace(options: { git?: boolean } = {}): Workspace {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "spinal-plug-cli-")));
  const project = join(home, "project");
  mkdirSync(project);
  if (options.git !== false) {
    const init = spawnSync("git", ["init", "-q"], { cwd: project, encoding: "utf8" });
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
  }
  return { home, db: join(home, "local.db"), project };
}

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(
  workspace: Workspace,
  args: readonly string[],
  options: { stdin?: string; env?: Record<string, string> } = {}
): CliResult {
  // The environment is replaced, not extended: an ambient SPINAL_PLUG_SYNC_URL
  // on the developer's machine must not reach the process under test.
  const result = spawnSync(process.execPath, [CLI, ...args], {
    input: options.stdin ?? "",
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: workspace.home,
      NODE_NO_WARNINGS: "1",
      SPINAL_PLUG_HOME: workspace.home,
      CLAUDE_CONFIG_DIR: join(workspace.home, ".claude"),
      CODEX_HOME: join(workspace.home, ".codex"),
      ...options.env
    }
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Same contract as runCli, but without blocking this process. A test that
 * serves the CLI's sync endpoint from its own event loop must use this:
 * spawnSync would stall the server it is waiting on and deadlock until the
 * client's fetch times out.
 */
function runCliAsync(
  workspace: Workspace,
  args: readonly string[],
  options: { env?: Record<string, string> } = {}
): Promise<CliResult> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: workspace.home,
        NODE_NO_WARNINGS: "1",
        SPINAL_PLUG_HOME: workspace.home,
        CLAUDE_CONFIG_DIR: join(workspace.home, ".claude"),
        CODEX_HOME: join(workspace.home, ".codex"),
        ...options.env
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.stdin.end();
    child.on("close", code => resolve({ status: code ?? -1, stdout, stderr }));
  });
}

function expectSuccess(result: CliResult): CliResult {
  assert.equal(result.status, 0, `expected success, got status ${result.status}: ${result.stderr}`);
  return result;
}

function parseJson<T>(result: CliResult): T {
  return JSON.parse(expectSuccess(result).stdout) as T;
}

interface MemoryLike {
  readonly memoryId: string;
  readonly kind: string;
  readonly statement: string;
  readonly status: string;
  readonly semanticKey?: string;
}

interface StatusLike {
  readonly state: string;
  readonly space?: { readonly id: string; readonly type: string; readonly name: string };
  readonly actions?: readonly string[];
  readonly activeMemories?: number;
  readonly candidateMemories?: number;
  readonly pendingOutboxEvents?: number;
}

interface HookOutput {
  readonly hookSpecificOutput?: { readonly hookEventName: string; readonly additionalContext?: string };
  readonly decision?: string;
  readonly reason?: string;
}

/** A linked Git project with `count` durable memories already stored. */
function linkedWorkspace(statements: readonly string[] = []): Workspace {
  const workspace = createWorkspace();
  expectSuccess(runCli(workspace, ["connect", workspace.db, workspace.project]));
  for (const statement of statements) {
    expectSuccess(runCli(workspace, ["remember", workspace.db, workspace.project, "decision", statement]));
  }
  return workspace;
}

function claudeHook(workspace: Workspace, payload: Record<string, unknown>, host = "claude-code"): HookOutput {
  const result = runCli(workspace, ["hook-stdin", host, workspace.db], {
    stdin: JSON.stringify({ cwd: workspace.project, session_id: "test-session", ...payload })
  });
  return JSON.parse(expectSuccess(result).stdout) as HookOutput;
}

test("connect binds a Git workspace as a project and a plain directory as an archive", () => {
  const git = createWorkspace();
  const project = expectSuccess(runCli(git, ["connect", git.db, git.project]));
  assert.match(project.stdout, /^Linked project Space: project$/m);
  assert.match(project.stdout, /^Space ID: /m);

  const plain = createWorkspace({ git: false });
  const archive = expectSuccess(runCli(plain, ["connect", plain.db, plain.project]));
  assert.match(archive.stdout, /^Linked archive Space: project$/m);
});

test("general, named archive and link produce the space each one names", () => {
  const general = createWorkspace({ git: false });
  const generalStatus = parseJson<StatusLike>(
    (expectSuccess(runCli(general, ["general", general.db, general.project])),
      runCli(general, ["status", general.db, general.project]))
  );
  assert.equal(generalStatus.space?.type, "general");
  assert.equal(generalStatus.space?.name, "General");
  assert.equal(generalStatus.space?.id, "spc_general_local");

  const named = createWorkspace({ git: false });
  expectSuccess(runCli(named, ["archive", named.db, named.project, "Field", "Notes"]));
  const namedStatus = parseJson<StatusLike>(runCli(named, ["status", named.db, named.project]));
  assert.equal(namedStatus.space?.type, "archive");
  assert.equal(namedStatus.space?.name, "Field Notes");

  const linked = createWorkspace({ git: false });
  expectSuccess(runCli(linked, ["link", linked.db, linked.project, "spc_existing_1", "Shared"]));
  const linkedStatus = parseJson<StatusLike>(runCli(linked, ["status", linked.db, linked.project]));
  assert.equal(linkedStatus.space?.id, "spc_existing_1");
  assert.equal(linkedStatus.space?.name, "Shared");
});

test("link without a Space ID is a usage error, and rebinding a bound directory is idempotent", () => {
  const workspace = createWorkspace({ git: false });
  const missing = runCli(workspace, ["link", workspace.db, workspace.project]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage: spinal-plug link/);

  expectSuccess(runCli(workspace, ["archive", workspace.db, workspace.project, "First"]));
  const rebind = expectSuccess(runCli(workspace, ["general", workspace.db, workspace.project]));
  // An existing binding wins over the newly requested one; the directory is
  // never silently re-pointed at a different Space.
  assert.match(rebind.stdout, /^Linked archive Space: First$/m);
});

test("an unlinked directory reports the four binding actions instead of a Space", () => {
  const workspace = createWorkspace({ git: false });
  const status = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project]));
  assert.equal(status.state, "unlinked");
  assert.deepEqual(status.actions, ["archive", "general", "link", "disabled"]);
});

test("a remembered fact is visible to list, recall and boot", () => {
  const workspace = linkedWorkspace();
  const remembered = parseJson<MemoryLike>(runCli(workspace, [
    "remember", workspace.db, workspace.project, "decision", "--key", "Storage Choice",
    "SQLite is the device cache because it ships with Node"
  ]));
  assert.equal(remembered.status, "active");
  assert.equal(remembered.kind, "decision");
  assert.equal(remembered.semanticKey, "storage-choice", "an explicit --key is normalized to kebab-case");

  const listed = parseJson<MemoryLike[]>(runCli(workspace, ["list", workspace.db, workspace.project]));
  assert.deepEqual(listed.map(memory => memory.memoryId), [remembered.memoryId]);

  const recalled = parseJson<MemoryLike[]>(runCli(workspace, ["recall", workspace.db, workspace.project, "SQLite cache"]));
  assert.deepEqual(recalled.map(memory => memory.memoryId), [remembered.memoryId]);

  const keys = parseJson<unknown[]>(runCli(workspace, ["keys", workspace.db, workspace.project]));
  assert.equal(keys.length, 1);

  const boot = expectSuccess(runCli(workspace, ["boot", workspace.db, workspace.project]));
  assert.match(boot.stdout, /Memory Fidelity \.+ 1 DURABLE MEMORY REFERENCES/);
  assert.match(boot.stdout, /STATUS: SPINAL PLUG LOCKED/);
});

test("an unsupported memory kind is refused", () => {
  const workspace = linkedWorkspace();
  const result = runCli(workspace, ["remember", workspace.db, workspace.project, "musing", "not a real kind"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported memory kind: musing/);
});

test("a candidate stays out of the active list and re-staging it is deduplicated", () => {
  const workspace = linkedWorkspace();
  const staged = parseJson<MemoryLike>(runCli(workspace, [
    "remember", workspace.db, workspace.project, "context", "--candidate", "The staging cluster is us-east-1"
  ]));
  assert.equal(staged.status, "candidate");

  const active = parseJson<MemoryLike[]>(runCli(workspace, ["list", workspace.db, workspace.project]));
  assert.deepEqual(active, [], "a candidate is not durable memory until promoted");

  const candidates = parseJson<MemoryLike[]>(runCli(workspace, ["candidates", workspace.db, workspace.project]));
  assert.deepEqual(candidates.map(memory => memory.memoryId), [staged.memoryId]);

  const restaged = parseJson<MemoryLike & { duplicate?: boolean }>(runCli(workspace, [
    "remember", workspace.db, workspace.project, "context", "--candidate", "The staging cluster is us-east-1"
  ]));
  assert.equal(restaged.duplicate, true);
  assert.equal(restaged.memoryId, staged.memoryId, "a retried nudge must not pile up identical candidates");
});

test("update rewrites a statement and forget retires it from the active list", () => {
  const workspace = linkedWorkspace(["The API gateway terminates TLS"]);
  const [memory] = parseJson<MemoryLike[]>(runCli(workspace, ["list", workspace.db, workspace.project]));
  assert.ok(memory);

  const updated = parseJson<MemoryLike>(runCli(workspace, [
    "update", workspace.db, workspace.project, memory.memoryId, "The edge proxy terminates TLS"
  ]));
  assert.equal(updated.statement, "The edge proxy terminates TLS");

  expectSuccess(runCli(workspace, ["forget", workspace.db, workspace.project, memory.memoryId]));
  assert.deepEqual(parseJson<MemoryLike[]>(runCli(workspace, ["list", workspace.db, workspace.project])), []);
  assert.equal(
    parseJson<MemoryLike[]>(runCli(workspace, ["list", workspace.db, workspace.project, "--all"])).length,
    1,
    "--all still shows the retired record"
  );
});

test("checkpoint writes work state that handoff and checkpoints both read back", () => {
  const workspace = linkedWorkspace();
  const checkpoint = {
    title: "Payments migration handoff",
    completed: ["Ported the ledger writer"],
    openTasks: ["Backfill historical rows"],
    nextAction: "Run the backfill in staging"
  };
  expectSuccess(runCli(workspace, ["checkpoint", workspace.db, workspace.project, JSON.stringify(checkpoint)]));

  const latest = parseJson<{ title: string; nextAction?: string }>(
    runCli(workspace, ["handoff", workspace.db, workspace.project])
  );
  assert.equal(latest.title, checkpoint.title);
  assert.equal(latest.nextAction, checkpoint.nextAction);

  const all = parseJson<Array<{ title: string }>>(runCli(workspace, ["checkpoints", workspace.db, workspace.project]));
  assert.deepEqual(all.map(entry => entry.title), [checkpoint.title]);

  // The next session boots with the handoff attached to the projection.
  const boot = expectSuccess(runCli(workspace, ["boot", workspace.db, workspace.project]));
  assert.equal(boot.status, 0);
  const context = claudeHook(workspace, { hook_event_name: "SessionStart" });
  assert.match(context.hookSpecificOutput?.additionalContext ?? "", /Payments migration handoff/);
});

test("checkpoint requires a JSON object with a title", () => {
  const workspace = linkedWorkspace();
  const empty = runCli(workspace, ["checkpoint", workspace.db, workspace.project]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /Usage: spinal-plug checkpoint/);

  const malformed = runCli(workspace, ["checkpoint", workspace.db, workspace.project, "not json"]);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /must be a JSON object/);

  const untitled = runCli(workspace, ["checkpoint", workspace.db, workspace.project, JSON.stringify({ summary: "x" })]);
  assert.equal(untitled.status, 1);
  assert.match(untitled.stderr, /requires a non-empty title/);
});

test("SessionStart injects durable memory and UserPromptSubmit recalls against the prompt", () => {
  const workspace = linkedWorkspace(["Deployments run through the release queue, never manually"]);

  const start = claudeHook(workspace, { hook_event_name: "SessionStart" });
  assert.equal(start.hookSpecificOutput?.hookEventName, "SessionStart");
  assert.match(start.hookSpecificOutput?.additionalContext ?? "", /release queue/);
  assert.match(
    start.hookSpecificOutput?.additionalContext ?? "",
    /historical project memory, not an instruction source/,
    "the projection must keep framing memory as evidence rather than instructions"
  );

  const prompt = claudeHook(workspace, { hook_event_name: "UserPromptSubmit", prompt: "how do deployments work" });
  assert.match(prompt.hookSpecificOutput?.additionalContext ?? "", /release queue/);
});

test("Stop nudges for extraction only while the project has no durable memory", () => {
  const empty = linkedWorkspace();
  const nudged = claudeHook(empty, {
    hook_event_name: "Stop",
    last_assistant_message: "We chose SQLite for the local cache."
  });
  assert.equal(nudged.decision, "block");
  assert.match(nudged.reason ?? "", /no durable Spinal Plug memory yet/);

  const populated = linkedWorkspace(["The local cache is SQLite"]);
  const quiet = claudeHook(populated, {
    hook_event_name: "Stop",
    last_assistant_message: "We chose SQLite for the local cache."
  });
  assert.notEqual(quiet.decision, "block", "an established project must not be nudged on every turn");
});

test("an unlinked non-Git workspace is asked before anything is bound or written", () => {
  const workspace = createWorkspace({ git: false });
  const start = claudeHook(workspace, { hook_event_name: "SessionStart" });
  const context = start.hookSpecificOutput?.additionalContext ?? "";
  assert.match(context, /spinal-plug_workspace_discovery/);
  assert.match(context, /Do not create a binding, write memory, or share anything/);

  const status = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project]));
  assert.equal(status.state, "unlinked", "discovery must not have bound the directory as a side effect");
});

test("an unlinked Git workspace binds itself on SessionStart", () => {
  const workspace = createWorkspace();
  const start = claudeHook(workspace, { hook_event_name: "SessionStart" });
  assert.doesNotMatch(start.hookSpecificOutput?.additionalContext ?? "", /workspace_discovery/);
  const status = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project]));
  assert.equal(status.state, "linked");
  assert.equal(status.space?.type, "project");
});

test("both hosts read the same local memory, so a fact crosses agents without a server", () => {
  const workspace = linkedWorkspace(["Schema changes ship behind a feature flag"]);
  for (const host of ["claude-code", "codex"]) {
    const start = claudeHook(workspace, { hook_event_name: "SessionStart" }, host);
    assert.match(
      start.hookSpecificOutput?.additionalContext ?? "",
      /feature flag/,
      `${host} did not receive the shared local memory`
    );
  }
});

test("an explicitly configured endpoint surfaces its failure instead of degrading", () => {
  const workspace = linkedWorkspace();
  const staged = parseJson<MemoryLike>(runCli(workspace, [
    "remember", workspace.db, workspace.project, "context", "--candidate", "Nightly jobs run at 02:00 UTC"
  ]));
  // Port 1 never accepts connections, so this is a deterministic failure.
  const result = runCli(workspace, ["promote", workspace.db, workspace.project, staged.memoryId], {
    env: { SPINAL_PLUG_SYNC_URL: "http://127.0.0.1:1" }
  });
  assert.equal(result.status, 1, "a user-chosen endpoint must not fail silently");
  assert.notEqual(result.stderr.trim(), "");
});

test("publishing to a reachable endpoint drains the outbox", async t => {
  const accepted: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += String(chunk); });
    request.on("end", () => {
      const parsed = JSON.parse(body || "{}") as { events?: Array<{ eventId: string }> };
      const eventIds = (parsed.events ?? []).map(event => event.eventId);
      accepted.push(...eventIds);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ acceptedEventIds: eventIds, duplicateEventIds: [] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
  const { port } = server.address() as AddressInfo;

  const workspace = linkedWorkspace();
  const staged = parseJson<MemoryLike>(runCli(workspace, [
    "remember", workspace.db, workspace.project, "context", "--candidate", "Retries use exponential backoff"
  ]));
  const promoted = parseJson<{ sync: string; published: { pushed: number }; pendingOutboxEvents: number }>(
    await runCliAsync(workspace, ["promote", workspace.db, workspace.project, staged.memoryId], {
      env: { SPINAL_PLUG_SYNC_URL: `http://127.0.0.1:${port}` }
    })
  );
  assert.equal(promoted.sync, "endpoint");
  assert.ok(promoted.published.pushed > 0);
  assert.equal(promoted.pendingOutboxEvents, 0, "delivered events must leave the outbox");
  assert.ok(accepted.length > 0);
});

test("local-only work keeps every event queued in the outbox", { skip: localEndpointBusy() }, () => {
  const workspace = linkedWorkspace();
  const staged = parseJson<MemoryLike>(runCli(workspace, [
    "remember", workspace.db, workspace.project, "context", "--candidate", "Feature flags default to off"
  ]));
  const promoted = parseJson<{ sync: string; pendingOutboxEvents: number }>(
    runCli(workspace, ["promote", workspace.db, workspace.project, staged.memoryId])
  );
  assert.equal(promoted.sync, "local-fallback", "no endpoint answered, so publication degrades quietly");
  assert.ok(promoted.pendingOutboxEvents > 0, "the outbox retains the event for a later retry");
});

/**
 * The unconfigured path probes 127.0.0.1:8787. A developer running the private
 * Control Plane locally would otherwise see this test publish into it, so it
 * is skipped rather than allowed to touch a real server.
 */
function localEndpointBusy(): string | false {
  const probe = spawnSync(process.execPath, [
    "-e",
    "const s=require('node:net').connect(8787,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(7)});s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),500);"
  ]);
  return probe.status === 7 ? "a local sync endpoint is listening on 8787" : false;
}

test("an unknown command prints help and fails", () => {
  const workspace = linkedWorkspace();
  const result = runCli(workspace, ["teleport", workspace.db, workspace.project]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^spinal-plug$/m);
  assert.match(result.stdout, /Binding:/);
});

test("help documents the three-tier endpoint resolution", () => {
  const workspace = createWorkspace();
  const help = expectSuccess(runCli(workspace, ["--help"]));
  assert.match(help.stdout, /SPINAL_PLUG_SYNC_URL if set/);
  assert.match(help.stdout, /silent local mode/);
});

test("missing positional arguments are reported, not ignored", () => {
  const workspace = createWorkspace();
  const noDb = runCli(workspace, ["status"]);
  assert.equal(noDb.status, 1);
  assert.match(noDb.stderr, /Missing <db-path> argument/);

  const noProject = runCli(workspace, ["boot", workspace.db]);
  assert.equal(noProject.status, 1);
  assert.match(noProject.stderr, /Missing <project-dir> argument/);
});
