import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
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

/** A canonical update as a Control Plane would hand it to this device. */
function canonicalUpdate(spaceId: string, updateId: string, memoryId: string, statement: string) {
  return {
    schema: "spinal-plug.canonical-memory-update/v0.1",
    updateId,
    spaceId,
    memoryId,
    kind: "activate",
    required: false,
    sourceEventIds: [`evt_${memoryId}`],
    memory: {
      schema: "spinal-plug.memory-record/v0.1",
      memoryId,
      spaceId,
      kind: "decision",
      title: statement,
      statement,
      references: [],
      status: "active",
      origin: "user_explicit",
      confidence: 1,
      sourceEventIds: [`evt_${memoryId}`],
      createdFromEventId: `evt_${memoryId}`,
      lastUpdatedFromEventId: `evt_${memoryId}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    generatedAt: "2026-01-01T00:00:00.000Z"
  };
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

test("each connect mode produces the space it names", () => {
  const general = createWorkspace({ git: false });
  expectSuccess(runCli(general, ["connect", general.db, general.project, "general"]));
  const generalStatus = parseJson<StatusLike>(runCli(general, ["status", general.db, general.project]));
  assert.equal(generalStatus.space?.type, "general");
  assert.equal(generalStatus.space?.name, "General");
  assert.equal(generalStatus.space?.id, "spc_general_local");

  const named = createWorkspace({ git: false });
  expectSuccess(runCli(named, ["connect", named.db, named.project, "archive", "Field", "Notes"]));
  const namedStatus = parseJson<StatusLike>(runCli(named, ["status", named.db, named.project]));
  assert.equal(namedStatus.space?.type, "archive");
  assert.equal(namedStatus.space?.name, "Field Notes");

  const linked = createWorkspace({ git: false });
  expectSuccess(runCli(linked, ["connect", linked.db, linked.project, "link", "spc_existing_1", "Shared"]));
  const linkedStatus = parseJson<StatusLike>(runCli(linked, ["status", linked.db, linked.project]));
  assert.equal(linkedStatus.space?.id, "spc_existing_1");
  assert.equal(linkedStatus.space?.name, "Shared");
});

test("connect rejects an unknown mode and a link without a Space ID", () => {
  const workspace = createWorkspace({ git: false });
  const missing = runCli(workspace, ["connect", workspace.db, workspace.project, "link"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage: spinal-plug connect .* link <space-id>/);

  const unknown = runCli(workspace, ["connect", workspace.db, workspace.project, "borrow"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unsupported connect mode: borrow/);

  const status = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project]));
  assert.equal(status.state, "unlinked", "a rejected mode must not bind the directory");
});

test("rebinding an already bound directory keeps the original Space", () => {
  const workspace = createWorkspace({ git: false });
  expectSuccess(runCli(workspace, ["connect", workspace.db, workspace.project, "archive", "First"]));
  const rebind = expectSuccess(runCli(workspace, ["connect", workspace.db, workspace.project, "general"]));
  // An existing binding wins over the newly requested one; the directory is
  // never silently re-pointed at a different Space.
  assert.match(rebind.stdout, /^Linked archive Space: First$/m);
});

test("the merged commands replaced their predecessors rather than aliasing them", () => {
  const workspace = linkedWorkspace();
  // These are retired command names, not the renamed concept: `handoff` is
  // the surviving verb, so `checkpoint` and `checkpoints` must be gone.
  for (const retired of ["general", "archive", "link", "checkpoint", "checkpoints", "apply-claude", "apply-codex", "sync-codex", "share-claude", "mind-core", "capsule", "candidates", "recall", "init-db", "hook"]) {
    const result = runCli(workspace, [retired, workspace.db, workspace.project]);
    assert.equal(result.status, 1, `${retired} should no longer be a command`);
    assert.match(result.stdout, /^spinal-plug$/m, `${retired} should fall through to help`);
  }
});

test("an unlinked directory reports the four binding actions instead of a Space", () => {
  const workspace = createWorkspace({ git: false });
  const status = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project]));
  assert.equal(status.state, "unlinked");
  assert.deepEqual(status.actions, ["archive", "general", "link", "disabled"]);
});

test("a remembered fact is visible to list, --match and boot", () => {
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

  const matched = parseJson<MemoryLike[]>(runCli(workspace, [
    "list", workspace.db, workspace.project, "--match", "SQLite cache"
  ]));
  assert.deepEqual(matched.map(memory => memory.memoryId), [remembered.memoryId]);

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

  const candidates = parseJson<MemoryLike[]>(runCli(workspace, [
    "list", workspace.db, workspace.project, "--candidates"
  ]));
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

test("handoff writes work state that --latest and --list both read back", () => {
  const workspace = linkedWorkspace();
  const handoff = {
    title: "Payments migration handoff",
    completed: ["Ported the ledger writer"],
    openTasks: ["Backfill historical rows"],
    nextAction: "Run the backfill in staging"
  };
  expectSuccess(runCli(workspace, ["handoff", workspace.db, workspace.project, JSON.stringify(handoff)]));

  const latest = parseJson<{ title: string; nextAction?: string }>(
    runCli(workspace, ["handoff", workspace.db, workspace.project, "--latest"])
  );
  assert.equal(latest.title, handoff.title);
  assert.equal(latest.nextAction, handoff.nextAction);

  const all = parseJson<Array<{ title: string }>>(
    runCli(workspace, ["handoff", workspace.db, workspace.project, "--list"])
  );
  assert.deepEqual(all.map(entry => entry.title), [handoff.title]);

  // The next session boots with the handoff attached to the projection.
  const boot = expectSuccess(runCli(workspace, ["boot", workspace.db, workspace.project]));
  assert.equal(boot.status, 0);
  const context = claudeHook(workspace, { hook_event_name: "SessionStart" });
  assert.match(context.hookSpecificOutput?.additionalContext ?? "", /Payments migration handoff/);
});

test("handoff requires a JSON object with a title", () => {
  const workspace = linkedWorkspace();
  const empty = runCli(workspace, ["handoff", workspace.db, workspace.project]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /Usage: spinal-plug handoff/);

  const malformed = runCli(workspace, ["handoff", workspace.db, workspace.project, "not json"]);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /must be a JSON object/);

  const untitled = runCli(workspace, ["handoff", workspace.db, workspace.project, JSON.stringify({ summary: "x" })]);
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

test("project refreshes a host's native memory and names an unsupported host", () => {
  const workspace = linkedWorkspace(["Backups run nightly against the replica"]);

  const claude = parseJson<{ materialized: unknown }>(
    runCli(workspace, ["project", workspace.db, workspace.project, "claude-code"])
  );
  assert.ok(claude.materialized, "Claude now has the same projection refresh Codex always had");

  const codex = parseJson<{ materialized: unknown }>(
    runCli(workspace, ["project", workspace.db, workspace.project, "codex"])
  );
  assert.ok(codex.materialized);

  const unsupported = runCli(workspace, ["project", workspace.db, workspace.project, "emacs"]);
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /Unsupported host: emacs/);

  const missing = runCli(workspace, ["project", workspace.db, workspace.project]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Usage: spinal-plug project/);
});

test("apply reports updates alone, and adds a host projection only when asked", () => {
  const workspace = linkedWorkspace(["Rate limits are enforced at the edge"]);

  const bare = parseJson<Record<string, unknown>>(runCli(workspace, ["apply", workspace.db, workspace.project]));
  assert.ok(!("materialized" in bare), "a plain apply stays a pure canonical-update operation");

  const withHost = parseJson<{ applied: unknown; materialized: unknown }>(
    runCli(workspace, ["apply", workspace.db, workspace.project, "--host", "codex"])
  );
  assert.ok(withHost.applied !== undefined);
  assert.ok(withHost.materialized !== undefined);

  const danglingHost = runCli(workspace, ["apply", workspace.db, workspace.project, "--host"]);
  assert.equal(danglingHost.status, 1);
  assert.match(danglingHost.stderr, /Usage: spinal-plug apply/);
});

test("apply narrows to the update ids it is given", async t => {
  // Regression: --host parsing computed an index of -1 when the flag was
  // absent, so index hostIndex + 1 dropped the first positional id and a
  // one-update apply silently became apply-everything.
  const workspace = linkedWorkspace();
  const spaceId = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project])).space?.id;
  assert.ok(spaceId);


  // A server that hands this device two optional canonical updates.
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    if ((request.url ?? "").startsWith("/v1/events:pull")) {
      // fetch() also drains handoff and runtime events after the updates.
      response.end(JSON.stringify({ events: [], nextCursor: "", hasMore: false }));
      return;
    }
    if ((request.url ?? "").startsWith("/v1/updates:fetch")) {
      response.end(JSON.stringify({
        updates: [
          canonicalUpdate(spaceId, "upd_first", "mem_first", "First shared fact"),
          canonicalUpdate(spaceId, "upd_second", "mem_second", "Second shared fact")
        ],
        nextCursor: "evt_mem_second",
        hasMore: false
      }));
      return;
    }
    response.end(JSON.stringify({ acceptedEventIds: [], duplicateEventIds: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  expectSuccess(await runCliAsync(workspace, ["fetch", workspace.db, workspace.project, url, "device-test"]));
  const pending = parseJson<{ pending: Array<{ updateId: string }> }>(
    runCli(workspace, ["preview", workspace.db, workspace.project])
  ).pending;
  assert.equal(pending.length, 2, "both updates should be waiting for review");

  const first = parseJson<{ applied: number; remaining: number }>(
    runCli(workspace, ["apply", workspace.db, workspace.project, "upd_first"])
  );
  assert.equal(first.applied, 1, "only the named update may apply");
  assert.equal(first.remaining, 1, "the unselected update must stay pending");

  // The same narrowing has to survive a host projection request.
  const second = parseJson<{ applied: { applied: number; remaining: number } }>(
    runCli(workspace, ["apply", workspace.db, workspace.project, "--host", "codex", "upd_second"])
  );
  assert.equal(second.applied.applied, 1);
  assert.equal(second.applied.remaining, 0);
});

test("a bad --host is refused before any update is committed", async t => {
  // Regression: the host was validated only after applyCanonicalUpdates ran.
  // A typo was swallowed as the host name, which emptied the selection and
  // merged the entire review queue. Exit code alone does not prove the fix —
  // the broken version also exited 1 — so this asserts the queue survives.
  const workspace = linkedWorkspace();
  const spaceId = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project])).space?.id;
  assert.ok(spaceId);

  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    if ((request.url ?? "").startsWith("/v1/events:pull")) {
      response.end(JSON.stringify({ events: [], nextCursor: "", hasMore: false }));
      return;
    }
    if ((request.url ?? "").startsWith("/v1/updates:fetch")) {
      response.end(JSON.stringify({
        updates: [
          canonicalUpdate(spaceId, "upd_a", "mem_a", "Queued fact A"),
          canonicalUpdate(spaceId, "upd_b", "mem_b", "Queued fact B")
        ],
        nextCursor: "evt_mem_b",
        hasMore: false
      }));
      return;
    }
    response.end(JSON.stringify({ acceptedEventIds: [], duplicateEventIds: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  expectSuccess(await runCliAsync(workspace, ["fetch", workspace.db, workspace.project, url, "device-test"]));
  const pendingCount = () => parseJson<{ pending: unknown[] }>(
    runCli(workspace, ["preview", workspace.db, workspace.project])
  ).pending.length;
  assert.equal(pendingCount(), 2);

  for (const args of [["--host", "emacs"], ["--host", "--all"], ["--host"]]) {
    const result = runCli(workspace, ["apply", workspace.db, workspace.project, ...args]);
    assert.equal(result.status, 1, `apply ${args.join(" ")} should fail`);
    assert.equal(
      pendingCount(),
      2,
      `apply ${args.join(" ")} must not commit anything before rejecting the host`
    );
  }
});

test("a statement starting with an Object prototype key is not parsed as a flag", () => {
  // Regression: flag parsing used `key in spec`, which walks the prototype
  // chain, so "constructor", "toString" and friends were treated as flags.
  const workspace = linkedWorkspace();
  const stored = parseJson<MemoryLike>(runCli(workspace, [
    "remember", workspace.db, workspace.project, "decision", "constructor injection is the DI convention"
  ]));
  assert.equal(stored.statement, "constructor injection is the DI convention");

  // The same hazard reached recall once it moved onto `list`.
  const matched = parseJson<MemoryLike[]>(runCli(workspace, [
    "list", workspace.db, workspace.project, "constructor injection"
  ]));
  assert.deepEqual(matched.map(memory => memory.memoryId), [stored.memoryId]);

  // A bare prototype key must not throw "Flag toString requires a value".
  expectSuccess(runCli(workspace, ["list", workspace.db, workspace.project, "toString"]));
});

test("an empty --match is refused rather than listing the whole Space", () => {
  // Regression: an unset shell variable in a plugin snippet produced
  // --match "", which fell through to the plain listing and returned every
  // memory as though it were relevant recall.
  const workspace = linkedWorkspace(["First fact", "Second fact"]);
  const empty = runCli(workspace, ["list", workspace.db, workspace.project, "--match", "   "]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /prompt cannot be empty/);
  assert.equal(empty.stdout.trim(), "", "no memories may be emitted for an empty query");
});

test("an empty update id is refused instead of applying nothing successfully", () => {
  // Regression: `apply "$DB" . --host codex "$IDS"` with IDS unset produced
  // selected = [""], which matches no pending update. The command applied
  // nothing, left every approved update pending, and still exited 0.
  const workspace = linkedWorkspace();
  const result = runCli(workspace, ["apply", workspace.db, workspace.project, "--host", "codex", ""]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /update id cannot be empty/);
});

test("the device credential file follows SPINAL_PLUG_HOME", () => {
  // Regression: bindings relocated with SPINAL_PLUG_HOME but device.env was
  // still read from the real $HOME, splitting device-local state in half.
  // Asserting "still linked" would pass either way, so this proves the file
  // was actually read: it sets an explicit sync endpoint that must fail
  // loudly (explicit endpoints never degrade to local mode).
  const workspace = linkedWorkspace();
  mkdirSync(join(workspace.home, ".spinal-plug"), { recursive: true });
  writeFileSync(
    join(workspace.home, ".spinal-plug", "device.env"),
    "SPINAL_PLUG_SYNC_URL=http://127.0.0.1:1\n"
  );
  // $HOME points somewhere with no device.env, so reading the credential from
  // homedir() instead of SPINAL_PLUG_HOME finds nothing and quietly succeeds
  // in local mode — which is exactly what this must not do.
  const decoyHome = realpathSync(mkdtempSync(join(tmpdir(), "spinal-plug-decoy-")));
  const shared = runCli(workspace, [
    "share", workspace.db, workspace.project, "decision", "Credentials come from the relocated home"
  ], { env: { HOME: decoyHome } });
  assert.equal(shared.status, 1, "the endpoint from device.env must be honoured and its failure surfaced");
  assert.notEqual(shared.stderr.trim(), "");
});

test("the device id defers to the stored credential when a call site omits it", async t => {
  // Regression: the id was a required positional argument, so the plugin call
  // sites filled the slot with "${SPINAL_PLUG_DEVICE_ID:-device-local}". Under
  // a hook or skill there is no shell profile, so that expanded to the
  // placeholder, overrode the credential device.env had just supplied, and an
  // authenticated Control Plane answered "Request device does not match
  // credential." — the sync path was unusable exactly where it runs unattended.
  const workspace = linkedWorkspace();
  mkdirSync(join(workspace.home, ".spinal-plug"), { recursive: true });
  writeFileSync(
    join(workspace.home, ".spinal-plug", "device.env"),
    "export SPINAL_PLUG_DEVICE_ID=dev_credential\n"
  );

  const seen: string[] = [];
  const server = createServer((request, response) => {
    const requested = new URL(request.url ?? "/", "http://127.0.0.1");
    const deviceId = requested.searchParams.get("device_id");
    if (deviceId !== null) seen.push(deviceId);
    if (requested.pathname === "/v1/events:push") {
      // A push carries its device in the body, not the query string.
      let body = "";
      request.setEncoding("utf8");
      request.on("data", chunk => { body += chunk; });
      request.on("end", () => {
        try {
          const pushed = JSON.parse(body) as { deviceId?: string };
          if (typeof pushed.deviceId === "string") seen.push(pushed.deviceId);
        } catch {
          // A malformed body is the test's problem, not the server's.
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ acceptedEventIds: [], duplicateEventIds: [] }));
      });
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    if (requested.pathname === "/v1/events:pull") {
      response.end(JSON.stringify({ events: [], nextCursor: "", hasMore: false }));
      return;
    }
    if (requested.pathname === "/v1/updates:fetch") {
      response.end(JSON.stringify({ updates: [], nextCursor: "", hasMore: false }));
      return;
    }
    response.end(JSON.stringify({ acceptedEventIds: [], duplicateEventIds: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // One fetch identifies this device on more than one request, so compare the
  // distinct ids the server saw rather than a request-count-sensitive list.
  const identities = () => [...new Set(seen)];

  expectSuccess(await runCliAsync(workspace, ["fetch", workspace.db, workspace.project, url]));
  assert.deepEqual(identities(), ["dev_credential"], "an omitted id must come from device.env");

  // An empty argument is what an unset shell variable expands to, not a choice.
  seen.length = 0;
  expectSuccess(await runCliAsync(workspace, ["fetch", workspace.db, workspace.project, url, ""]));
  assert.deepEqual(identities(), ["dev_credential"], "a blank id must not reach the endpoint");

  // Nor may a blank variable shadow the credential the file provides.
  seen.length = 0;
  expectSuccess(await runCliAsync(workspace, ["fetch", workspace.db, workspace.project, url], {
    env: { SPINAL_PLUG_DEVICE_ID: "" }
  }));
  assert.deepEqual(identities(), ["dev_credential"], "an empty variable is unset, not a device id");

  // Addressing one device deliberately still has to win.
  seen.length = 0;
  expectSuccess(await runCliAsync(workspace, ["fetch", workspace.db, workspace.project, url, "dev_explicit"]));
  assert.deepEqual(identities(), ["dev_explicit"], "an explicit id must still be honoured");

  // `share --device-id` took a bare truthiness check instead of the shared
  // resolver, so a blank flag value — an unexpanded variable in a plugin
  // script — reached the endpoint verbatim and shadowed the credential.
  seen.length = 0;
  expectSuccess(await runCliAsync(workspace, [
    "share", workspace.db, workspace.project, "decision",
    "--url", url, "--device-id", "   ",
    "A blank flag defers to the stored credential"
  ]));
  assert.deepEqual(identities(), ["dev_credential"], "a blank --device-id must not reach the endpoint");

  // republish shares the same slot and must not demand one either.
  expectSuccess(await runCliAsync(workspace, ["republish", workspace.db, workspace.project, url]));

  // The endpoint stays required: without it there is nothing to talk to.
  const noUrl = runCli(workspace, ["fetch", workspace.db, workspace.project]);
  assert.equal(noUrl.status, 1);
  assert.match(noUrl.stderr, /Usage: spinal-plug fetch/);
});

// SPINAL_PLUG_SYNC_URL: "" resolves to 127.0.0.1:8787 like an unset variable,
// so this test publishes into a locally running Control Plane unless skipped.
test("import reads host-native memory and refuses a host that has none to read", { skip: localEndpointBusy() }, () => {
  const workspace = linkedWorkspace();
  const imported = parseJson<{ source: string; discovered: number; sync: string }>(
    runCli(workspace, ["import", workspace.db, workspace.project, "claude-code"], {
      env: { SPINAL_PLUG_SYNC_URL: "" }
    })
  );
  assert.equal(imported.source, "claude-code-auto-memory");
  assert.equal(imported.discovered, 0, "the throwaway home has no Claude topic files");

  const codex = runCli(workspace, ["import", workspace.db, workspace.project, "codex"]);
  assert.equal(codex.status, 1);
  assert.match(codex.stderr, /Only claude-code exposes readable native memory/);

  const none = runCli(workspace, ["import", workspace.db, workspace.project]);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /Unsupported import host/);
});

test("the Mind runtime lives behind one namespace", () => {
  const workspace = linkedWorkspace();
  assert.deepEqual(parseJson<unknown[]>(runCli(workspace, ["runtime", workspace.db, workspace.project])), []);
  assert.deepEqual(
    parseJson<unknown[]>(runCli(workspace, ["runtime", workspace.db, workspace.project, "list"])),
    [],
    "an explicit list subcommand behaves like the bare namespace"
  );

  const core = parseJson<{ mindId?: string }>(runCli(workspace, [
    "runtime", workspace.db, workspace.project, "mind-core", JSON.stringify({ displayName: "Reviewer" })
  ]));
  assert.ok(core.mindId, "creating an entity still works through the namespace");
  assert.equal(parseJson<unknown[]>(runCli(workspace, ["runtime", workspace.db, workspace.project])).length, 1);

  const unknown = runCli(workspace, ["runtime", workspace.db, workspace.project, "daemon", "{}"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unsupported runtime entity: daemon/);

  const noJson = runCli(workspace, ["runtime", workspace.db, workspace.project, "role"]);
  assert.equal(noJson.status, 1);
  assert.match(noJson.stderr, /Usage: spinal-plug runtime .* role <json>/);

  const badJson = runCli(workspace, ["runtime", workspace.db, workspace.project, "role", "nope"]);
  assert.equal(badJson.status, 1);
  assert.match(badJson.stderr, /runtime role input must be valid JSON/);
});

test("an unknown command prints help and fails", () => {
  const workspace = linkedWorkspace();
  const result = runCli(workspace, ["teleport", workspace.db, workspace.project]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^spinal-plug$/m);
  assert.match(result.stdout, /^For you:$/m);
});

test("help documents the three-tier endpoint resolution", () => {
  const workspace = createWorkspace();
  const help = expectSuccess(runCli(workspace, ["--help"]));
  assert.match(help.stdout, /SPINAL_PLUG_SYNC_URL if set/);
  assert.match(help.stdout, /silent local mode/);
});

test("help groups commands by who runs them", () => {
  const workspace = createWorkspace();
  const help = expectSuccess(runCli(workspace, ["--help"])).stdout;
  for (const group of ["For you:", "For your Agent", "Only with a configured sync endpoint:", "Reserved extension surface"]) {
    assert.ok(help.includes(group), `help is missing the "${group}" group`);
  }
  // The five commands a person actually types must precede everything else,
  // so the tool does not read as 24 things to learn.
  const forYou = help.slice(help.indexOf("For you:"), help.indexOf("For your Agent"));
  for (const command of ["connect", "status", "boot", "share", "handoff"]) {
    assert.ok(forYou.includes(`  ${command} `), `${command} should be in the first group`);
  }
});

test("a database is created on first use without an explicit init step", () => {
  const workspace = createWorkspace();
  // No init-db command exists; connect must be enough to create the cache.
  expectSuccess(runCli(workspace, ["connect", workspace.db, workspace.project]));
  const status = parseJson<StatusLike>(runCli(workspace, ["status", workspace.db, workspace.project]));
  assert.equal(status.state, "linked");
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
