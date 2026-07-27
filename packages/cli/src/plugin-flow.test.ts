import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createSyncHttpServer, PersistentSyncServer } from "@spinal-plug/sync-server";

/**
 * End-to-end coverage of the exact commands the Claude/Codex plugins invoke:
 * hook context injection, native memory sharing, selective fetch/apply,
 * mandatory tombstone propagation, and the Codex candidate lifecycle.
 * Every CLI call runs as a real subprocess against a real HTTP sync server.
 *
 * The CLI subprocess talks to the in-process test server over loopback HTTP,
 * so runCli must stay async: a synchronous spawn would freeze this process's
 * event loop and the server could never answer.
 */

const CLI = fileURLToPath(new URL("./index.js", import.meta.url));

interface TestServer {
  url: string;
  close(): Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-server-"));
  const sync = new PersistentSyncServer(join(directory, "central.db"));
  const http = createSyncHttpServer(sync);
  await http.listen(0, "127.0.0.1");
  const address = http.server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await http.close();
    }
  };
}

async function snapshot(server: TestServer, spaceId: string): Promise<{
  memories: Array<{ title: string; statement: string }>;
  candidates: unknown[];
}> {
  const response = await fetch(`${server.url}/v1/spaces/${encodeURIComponent(spaceId)}/snapshot`);
  assert.ok(response.ok, `snapshot request failed: ${response.status}`);
  return response.json() as Promise<{ memories: Array<{ title: string; statement: string }>; candidates: unknown[] }>;
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function initGitProject(remote: string): string {
  const directory = tempDir("spinal-plug-proj-");
  execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: directory, stdio: "ignore" });
  return directory;
}

function sanitizePath(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "-");
}

function claudeMemoryDir(home: string, projectDir: string): string {
  return join(home, ".claude", "projects", sanitizePath(projectDir), "memory");
}

function spaceIdOf(projectDir: string): string {
  const manifest = JSON.parse(readFileSync(join(projectDir, ".spinal-plug", "space.json"), "utf8")) as { spaceId: string };
  return manifest.spaceId;
}

interface CliOptions {
  home: string;
  deviceId?: string;
  deviceToken?: string;
  syncUrl?: string;
  extraEnv?: Record<string, string>;
  input?: string;
}

async function runCli(args: string[], options: CliOptions): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: {
          // Scrub SPINAL_PLUG_* so a developer's or CI's exported endpoint
          // never leaks into the subprocess; tests set their own explicitly.
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("SPINAL_PLUG_"))
          ),
          NODE_NO_WARNINGS: "1",
          HOME: options.home,
          ...(options.deviceId ? { SPINAL_PLUG_DEVICE_ID: options.deviceId } : {}),
          ...(options.deviceToken ? { SPINAL_PLUG_DEVICE_TOKEN: options.deviceToken } : {}),
          ...(options.syncUrl ? { SPINAL_PLUG_SYNC_URL: options.syncUrl } : {}),
          ...options.extraEnv
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error(`spinal-plug ${args.join(" ")} failed: ${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`));
        } else {
          resolvePromise(stdout);
        }
      }
    );
    if (options.input !== undefined) child.stdin?.write(options.input);
    child.stdin?.end();
  });
}

async function runCliJson<T>(args: string[], options: CliOptions): Promise<T> {
  return JSON.parse(await runCli(args, options)) as T;
}

/** The plugin's session-start hook is what binds a Git workspace in real use. */
async function bindViaSessionStart(db: string, project: string, options: CliOptions): Promise<void> {
  await runCli(["hook", "claude-code", "session.start", db, project], options);
}

test("unlinked non-Git workspace gets a one-time discovery prompt, then stays quiet", async () => {
  const server = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const directory = tempDir("spinal-plug-scratch-");
    const db = join(tempDir("spinal-plug-db-"), "local.db");

    const started = await runCliJson<{ hookSpecificOutput: { additionalContext: string } }>(
      ["hook", "claude-code", "session.start", db, directory],
      { home, syncUrl: server.url }
    );
    assert.match(started.hookSpecificOutput.additionalContext, /spinal-plug_workspace_discovery/);
    assert.match(started.hookSpecificOutput.additionalContext, /Ask one concise question/);
    assert.ok(!existsSync(join(directory, ".spinal-plug", "space.json")), "discovery must not bind the workspace");

    const prompt = await runCli(
      ["hook", "claude-code", "prompt.submit", db, directory, "hello"],
      { home, syncUrl: server.url }
    );
    assert.equal(prompt.trim(), "{}");
  } finally {
    await server.close();
  }
});

test("Git workspace auto-binds on session start and receives a boot projection", async () => {
  const server = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/alpha.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");

    const started = await runCliJson<{ hookSpecificOutput: { hookEventName: string; additionalContext: string } }>(
      ["hook", "claude-code", "session.start", db, project],
      { home, syncUrl: server.url }
    );
    assert.equal(started.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(started.hookSpecificOutput.additionalContext, /<spinal-plug_project_context/);

    const manifest = JSON.parse(readFileSync(join(project, ".spinal-plug", "space.json"), "utf8")) as {
      spaceId: string;
      type: string;
      repository?: { canonicalRemote: string };
    };
    assert.match(manifest.spaceId, /^spc_git_[0-9a-f]{32}$/);
    assert.equal(manifest.type, "project");
    assert.equal(manifest.repository?.canonicalRemote, "https://github.com/spinal-plug-tests/alpha");
  } finally {
    await server.close();
  }
});

test("share-claude imports topic files once, skips secrets, and stays idempotent", async () => {
  const server = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/share.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home, syncUrl: server.url });

    const memoryDir = claudeMemoryDir(home, project);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "deploy.md"), "---\nname: deploy-runbook\n---\n\nDeploy with pnpm build && pnpm start.\n");
    writeFileSync(join(memoryDir, "ports.md"), "# Port map\n\nAPI listens on 48081 by default.\n");
    writeFileSync(join(memoryDir, "credentials.md"), "# do not share\n\nkey = sk-abcdefghijklmnopqrstuvwxyz123456\n");
    writeFileSync(join(memoryDir, "MEMORY.md"), "- [Deploy](deploy.md) — index only, never imported\n");
    writeFileSync(join(memoryDir, "spinal-plug-synced.md"), "stale managed projection, never imported\n");

    interface ShareResult {
      discovered: number;
      created: number;
      updated: number;
      unchanged: number;
      skippedSecretFiles: number;
      shared: { pushed: number };
    }
    const first = await runCliJson<ShareResult>(["share-claude", db, project, server.url, "device-a"], { home });
    assert.equal(first.discovered, 2);
    assert.equal(first.created, 2);
    assert.equal(first.skippedSecretFiles, 1);
    assert.equal(first.shared.pushed, 2);

    const second = await runCliJson<ShareResult>(["share-claude", db, project, server.url, "device-a"], { home });
    assert.equal(second.created, 0);
    assert.equal(second.unchanged, 2);
    assert.equal(second.shared.pushed, 0);

    const serverSnapshot = await snapshot(server, spaceIdOf(project));
    const titles = serverSnapshot.memories.map(memory => memory.title).sort();
    assert.deepEqual(titles, ["Port map", "deploy-runbook"]);
  } finally {
    await server.close();
  }
});

test("second device fetches, previews, and selectively applies shared memory", async () => {
  const server = await startServer();
  try {
    const remote = "https://github.com/spinal-plug-tests/selective.git";
    const homeA = tempDir("spinal-plug-home-a-");
    const homeB = tempDir("spinal-plug-home-b-");
    const projectA = initGitProject(remote);
    const projectB = initGitProject(remote);
    const dbA = join(tempDir("spinal-plug-db-a-"), "local.db");
    const dbB = join(tempDir("spinal-plug-db-b-"), "local.db");
    await bindViaSessionStart(dbA, projectA, { home: homeA, syncUrl: server.url });
    await bindViaSessionStart(dbB, projectB, { home: homeB, syncUrl: server.url });

    const memoryDirA = claudeMemoryDir(homeA, projectA);
    mkdirSync(memoryDirA, { recursive: true });
    writeFileSync(join(memoryDirA, "one.md"), "# Alpha fact\n\nFirst durable fact.\n");
    writeFileSync(join(memoryDirA, "two.md"), "# Beta fact\n\nSecond durable fact.\n");
    await runCli(["share-claude", dbA, projectA, server.url, "device-a"], { home: homeA });

    const fetched = await runCliJson<{ fetched: number; stored: number }>(
      ["fetch", dbB, projectB, server.url, "device-b"],
      { home: homeB }
    );
    assert.equal(fetched.fetched, 2);
    assert.equal(fetched.stored, 2);

    const preview = await runCliJson<{ pending: Array<{ updateId: string; required: boolean }>; requiredUpdateIds: string[] }>(
      ["preview", dbB, projectB],
      { home: homeB }
    );
    assert.equal(preview.pending.length, 2);
    assert.equal(preview.requiredUpdateIds.length, 0);

    const first = await runCliJson<{ applied: number; remaining: number }>(
      ["apply", dbB, projectB, preview.pending[0].updateId],
      { home: homeB }
    );
    assert.equal(first.applied, 1);
    assert.equal(first.remaining, 1);
    const afterFirst = await runCliJson<Array<{ title: string }>>(["list", dbB, projectB], { home: homeB });
    assert.equal(afterFirst.length, 1);

    const rest = await runCliJson<{ applied: number; remaining: number }>(["apply", dbB, projectB], { home: homeB });
    assert.equal(rest.applied, 1);
    assert.equal(rest.remaining, 0);
    const afterAll = await runCliJson<Array<{ title: string }>>(["list", dbB, projectB], { home: homeB });
    assert.equal(afterAll.length, 2);
  } finally {
    await server.close();
  }
});

test("tombstones travel as required updates and cannot be revived on the peer", async () => {
  const server = await startServer();
  try {
    const remote = "https://github.com/spinal-plug-tests/tombstone.git";
    const homeA = tempDir("spinal-plug-home-a-");
    const homeB = tempDir("spinal-plug-home-b-");
    const projectA = initGitProject(remote);
    const projectB = initGitProject(remote);
    const dbA = join(tempDir("spinal-plug-db-a-"), "local.db");
    const dbB = join(tempDir("spinal-plug-db-b-"), "local.db");
    await bindViaSessionStart(dbA, projectA, { home: homeA, syncUrl: server.url });
    await bindViaSessionStart(dbB, projectB, { home: homeB, syncUrl: server.url });

    const memoryDirA = claudeMemoryDir(homeA, projectA);
    mkdirSync(memoryDirA, { recursive: true });
    writeFileSync(join(memoryDirA, "doomed.md"), "# Doomed fact\n\nThis memory will be forgotten.\n");
    await runCli(["share-claude", dbA, projectA, server.url, "device-a"], { home: homeA });

    await runCli(["fetch", dbB, projectB, server.url, "device-b"], { home: homeB });
    await runCli(["apply", dbB, projectB], { home: homeB });
    const beforeForget = await runCliJson<Array<{ memoryId: string }>>(["list", dbB, projectB], { home: homeB });
    assert.equal(beforeForget.length, 1);

    await runCli(["forget", dbA, projectA, beforeForget[0].memoryId], { home: homeA });
    // A second share publishes the tombstone event from the durable outbox.
    const republish = await runCliJson<{ shared: { pushed: number } }>(
      ["share-claude", dbA, projectA, server.url, "device-a"],
      { home: homeA }
    );
    assert.ok(republish.shared.pushed >= 1);

    const fetched = await runCliJson<{ requiredApplied: number }>(
      ["fetch", dbB, projectB, server.url, "device-b"],
      { home: homeB }
    );
    assert.equal(fetched.requiredApplied, 1);
    const afterForget = await runCliJson<Array<{ memoryId: string }>>(["list", dbB, projectB], { home: homeB });
    assert.equal(afterForget.length, 0, "mandatory delete applies during fetch, before any optional apply");

    const allOnB = await runCliJson<Array<{ status: string }>>(["list", dbB, projectB, "--all"], { home: homeB });
    assert.deepEqual(allOnB.map(memory => memory.status), ["deleted"]);
  } finally {
    await server.close();
  }
});

test("Claude Stop hook auto-shares new native memory without an explicit command", async () => {
  const server = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/hook-share.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home, syncUrl: server.url });

    const memoryDir = claudeMemoryDir(home, project);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "late.md"), "# Late fact\n\nWritten mid-session by the user.\n");

    const payload = JSON.stringify({
      hook_event_name: "Stop",
      cwd: project,
      session_id: "session-1",
      last_assistant_message: "Done."
    });
    await runCli(["hook-stdin", "claude-code", db], { home, syncUrl: server.url, deviceId: "device-a", input: payload });

    const serverSnapshot = await snapshot(server, spaceIdOf(project));
    assert.deepEqual(serverSnapshot.memories.map(memory => memory.title), ["Late fact"]);
  } finally {
    await server.close();
  }
});

test("Codex Stop hook extracts reviewable candidates and promote publishes them", async () => {
  const server = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/codex-flow.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");

    await runCli(["hook", "codex", "session.start", db, project], { home, syncUrl: server.url });

    const stopPayload = JSON.stringify({
      hook_event_name: "Stop",
      cwd: project,
      session_id: "codex-session-1",
      last_assistant_message: "决定采用 pnpm 作为本仓库唯一的包管理器。其他改动已经完成。"
    });
    const stopResult = await runCliJson<{ notices: string[] }>(
      ["hook-stdin", "codex", db],
      { home, syncUrl: server.url, deviceId: "device-codex", input: stopPayload }
    );
    assert.match(stopResult.notices[0], /stored 1 reviewable candidate/);

    const candidates = await runCliJson<Array<{ memoryId: string; status: string; statement: string }>>(
      ["candidates", db, project],
      { home }
    );
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].status, "candidate");
    assert.match(candidates[0].statement, /pnpm/);

    // Candidates are reviewable locally but must not leak to the Control Plane.
    const beforePromote = await snapshot(server, spaceIdOf(project));
    assert.equal(beforePromote.memories.length, 0);
    assert.equal(beforePromote.candidates.length, 0);

    const promoted = await runCliJson<{ memory: { status: string }; published: { pushed: number } }>(
      ["promote", db, project, candidates[0].memoryId],
      { home, syncUrl: server.url, deviceId: "device-codex" }
    );
    assert.equal(promoted.memory.status, "active");
    assert.ok(promoted.published.pushed >= 1);

    const afterPromote = await snapshot(server, spaceIdOf(project));
    assert.equal(afterPromote.memories.length, 1);
    assert.match(afterPromote.memories[0].statement, /pnpm/);
  } finally {
    await server.close();
  }
});

test("republish re-bootstraps a new server after delivered events were stranded", async () => {
  const serverA = await startServer();
  const serverB = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/republish.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home, syncUrl: serverA.url });

    const memoryDir = claudeMemoryDir(home, project);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "migrated.md"), "# Migrated fact\n\nLives on the old server only.\n");
    await runCli(["share-claude", db, project, serverA.url, "device-a"], { home });

    // The old server dies / the device is pointed at a fresh Control Plane.
    const stranded = await runCliJson<{ shared: { pushed: number } }>(
      ["share-claude", db, project, serverB.url, "device-a"],
      { home }
    );
    assert.equal(stranded.shared.pushed, 0, "delivered events are not re-sent automatically");
    assert.equal((await snapshot(serverB, spaceIdOf(project))).memories.length, 0);

    const republished = await runCliJson<{ requeued: number; pushed: number }>(
      ["republish", db, project, serverB.url, "device-a"],
      { home }
    );
    assert.equal(republished.requeued, 1);
    assert.equal(republished.pushed, 1);
    const titles = (await snapshot(serverB, spaceIdOf(project))).memories.map(memory => memory.title);
    assert.deepEqual(titles, ["Migrated fact"]);

    // Re-publishing is a no-op once the new server acknowledges the events.
    const again = await runCliJson<{ requeued: number; pushed: number }>(
      ["republish", db, project, serverB.url, "device-a"],
      { home }
    );
    assert.equal(again.requeued, 1);
    assert.equal(again.pushed, 0);
  } finally {
    await serverA.close();
    await serverB.close();
  }
});

test("Control Plane requires space registration and a valid device token", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-control-"));
  const { SpinalPlugControlPlane, createControlPlaneHttpServer } = await import("@spinal-plug/sync-server");
  const controlPlane = new SpinalPlugControlPlane(join(directory, "control.db"));
  const http = createControlPlaneHttpServer(controlPlane, { bootstrapToken: "test-bootstrap" });
  await http.listen(0, "127.0.0.1");
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const provisioned = controlPlane.provisionAccount({
      accountName: "test-account",
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
      deviceName: "device-test"
    });
    const token = provisioned.credential.token;
    const deviceId = provisioned.credential.device.deviceId;

    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/control-plane.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home, syncUrl: url, deviceToken: token });

    const memoryDir = claudeMemoryDir(home, project);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "guarded.md"), "# Guarded fact\n\nOnly flows with auth.\n");

    // No token: the Control Plane refuses the push.
    await assert.rejects(
      runCli(["share-claude", db, project, url, deviceId], { home }),
      /credential|required/i
    );

    // A credential must not be usable under a different device id.
    await assert.rejects(
      runCli(["share-claude", db, project, url, "device-impostor"], { home, deviceToken: token }),
      /does not match credential/i
    );

    // Valid token but an unregistered Space: also refused.
    await assert.rejects(
      runCli(["share-claude", db, project, url, deviceId], { home, deviceToken: token }),
      /Space not found/i
    );

    // Registering the Space with the device token unblocks sharing. The failed
    // attempts above already minted the event with the unauthenticated
    // runtime's identity, so republish adopts the credential's identity and
    // re-sends — the same path a real migration takes.
    await runCli(["space-register", db, project, url], { home, deviceToken: token });
    const shared = await runCliJson<{ adoptedIdentity: number; pushed: number }>(
      ["republish", db, project, url, deviceId],
      { home, deviceToken: token }
    );
    assert.ok(shared.adoptedIdentity >= 1);
    assert.ok(shared.pushed >= 1);

    // A second device with its own credential can fetch and apply the memory.
    const secondDevice = controlPlane.registerDevice(
      {
        accountId: provisioned.account.accountId,
        userId: provisioned.userId,
        deviceId: provisioned.credential.device.deviceId,
        deviceStatus: "active"
      },
      "device-peer"
    );
    const homePeer = tempDir("spinal-plug-home-peer-");
    const projectPeer = initGitProject("https://github.com/spinal-plug-tests/control-plane.git");
    const dbPeer = join(tempDir("spinal-plug-db-peer-"), "local.db");
    const peerDeviceId = secondDevice.device.deviceId;
    await bindViaSessionStart(dbPeer, projectPeer, { home: homePeer, syncUrl: url, deviceToken: secondDevice.token });
    await runCli(["fetch", dbPeer, projectPeer, url, peerDeviceId], { home: homePeer, deviceToken: secondDevice.token });
    await runCli(["apply", dbPeer, projectPeer], { home: homePeer });
    const peerMemories = await runCliJson<Array<{ title: string }>>(["list", dbPeer, projectPeer], { home: homePeer });
    assert.deepEqual(peerMemories.map(memory => memory.title), ["Guarded fact"]);
  } finally {
    await http.close();
    controlPlane.close();
  }
});

test("republish adopts Control Plane identity when migrating from a dev server", async () => {
  const devServer = await startServer();
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-control-"));
  const { SpinalPlugControlPlane, createControlPlaneHttpServer } = await import("@spinal-plug/sync-server");
  const controlPlane = new SpinalPlugControlPlane(join(directory, "control.db"));
  const http = createControlPlaneHttpServer(controlPlane, { bootstrapToken: "test-bootstrap" });
  await http.listen(0, "127.0.0.1");
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const controlUrl = `http://127.0.0.1:${address.port}`;
  try {
    // Phase 1: memory flows to the unauthenticated dev server, minted as "local".
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/migration.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home, syncUrl: devServer.url });
    const memoryDir = claudeMemoryDir(home, project);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "legacy.md"), "# Legacy fact\n\nMinted before the Control Plane existed.\n");
    await runCli(["share-claude", db, project, devServer.url, "device-local"], { home });

    // Phase 2: the Control Plane replaces the dev server.
    const provisioned = controlPlane.provisionAccount({
      accountName: "migration-account",
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
      deviceName: "device-local"
    });
    const token = provisioned.credential.token;
    const deviceId = provisioned.credential.device.deviceId;
    await runCli(["space-register", db, project, controlUrl], { home, deviceToken: token });

    // Even a freshly minted event is rejected while the device still writes
    // with the unauthenticated runtime's identity.
    writeFileSync(join(memoryDir, "blocked.md"), "# Blocked fact\n\nMinted with the old identity.\n");
    await assert.rejects(
      runCli(["share-claude", db, project, controlUrl, deviceId], { home, deviceToken: token }),
      /does not match credential/i
    );

    const republished = await runCliJson<{ adoptedIdentity: number; requeued: number; pushed: number }>(
      ["republish", db, project, controlUrl, deviceId],
      { home, deviceToken: token }
    );
    assert.ok(republished.adoptedIdentity >= 1);
    assert.ok(republished.requeued >= 1);
    assert.ok(republished.pushed >= 1);

    const response = await fetch(
      `${controlUrl}/v1/spaces/${encodeURIComponent(spaceIdOf(project))}/snapshot`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    assert.ok(response.ok);
    const controlSnapshot = await response.json() as { memories: Array<{ title: string }> };
    assert.deepEqual(
      controlSnapshot.memories.map(memory => memory.title).sort(),
      ["Blocked fact", "Legacy fact"]
    );

    // New events pass once the device writes with the adopted identity.
    writeFileSync(join(memoryDir, "post-migration.md"), "# Post migration\n\nWritten after the move.\n");
    const adoptedEnv = {
      SPINAL_PLUG_ACCOUNT_ID: provisioned.account.accountId,
      SPINAL_PLUG_DEVICE_ID: deviceId
    };
    const after = await runCliJson<{ created: number; shared: { pushed: number } }>(
      ["share-claude", db, project, controlUrl, deviceId],
      { home, deviceToken: token, extraEnv: adoptedEnv }
    );
    assert.equal(after.created, 1);
    assert.equal(after.shared.pushed, 1);
  } finally {
    await devServer.close();
    await http.close();
    controlPlane.close();
  }
});

test("device.env file authenticates hook-context CLI runs without shell env", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-control-"));
  const { SpinalPlugControlPlane, createControlPlaneHttpServer } = await import("@spinal-plug/sync-server");
  const controlPlane = new SpinalPlugControlPlane(join(directory, "control.db"));
  const http = createControlPlaneHttpServer(controlPlane, { bootstrapToken: "test-bootstrap" });
  await http.listen(0, "127.0.0.1");
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const provisioned = controlPlane.provisionAccount({
      accountName: "env-file-account",
      ownerEmail: "owner@example.com",
      ownerName: "Owner",
      deviceName: "device-hooks"
    });
    const deviceId = provisioned.credential.device.deviceId;

    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/env-file.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home, syncUrl: url, deviceToken: provisioned.credential.token });
    await runCli(["space-register", db, project, url], { home, deviceToken: provisioned.credential.token });

    // The env file is what a hook-spawned CLI falls back to: no token in the
    // process environment, credentials only under the fake HOME.
    mkdirSync(join(home, ".spinal-plug"), { recursive: true });
    writeFileSync(join(home, ".spinal-plug", "device.env"), [
      `export SPINAL_PLUG_DEVICE_TOKEN=${provisioned.credential.token}`,
      `export SPINAL_PLUG_ACCOUNT_ID=${provisioned.account.accountId}`,
      `SPINAL_PLUG_DEVICE_ID=${deviceId}`,
      ""
    ].join("\n"));

    const memoryDir = claudeMemoryDir(home, project);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "hooked.md"), "# Hooked fact\n\nPublished by a bare hook process.\n");

    // No deviceToken passed: the CLI must pick up credentials from the env file.
    const shared = await runCliJson<{ created: number; shared: { pushed: number } }>(
      ["share-claude", db, project, url, deviceId],
      { home }
    );
    assert.equal(shared.created, 1);
    assert.equal(shared.shared.pushed, 1);

    // An explicit environment variable still wins over the file: pushing a new
    // event with the wrong token must be rejected.
    writeFileSync(join(memoryDir, "second.md"), "# Second fact\n\nPushed with an overridden token.\n");
    await assert.rejects(
      runCli(["share-claude", db, project, url, deviceId], {
        home,
        deviceToken: "wrong-token",
        extraEnv: { SPINAL_PLUG_ACCOUNT_ID: provisioned.account.accountId, SPINAL_PLUG_DEVICE_ID: deviceId }
      }),
      /Invalid device credential/i
    );
  } finally {
    await http.close();
    controlPlane.close();
  }
});

test("share without an endpoint stays local-only and needs no server", async () => {
  const home = tempDir("spinal-plug-home-");
  const project = initGitProject("https://github.com/spinal-plug-tests/local-only.git");
  const db = join(tempDir("spinal-plug-db-"), "local.db");
  // No syncUrl anywhere: binding and sharing must work with zero configuration.
  await bindViaSessionStart(db, project, { home });

  interface ShareResult {
    sync: string;
    shared: { pushed: number; duplicates: number };
    activeMemories: number;
  }
  const first = await runCliJson<ShareResult>(["share", db, project, "decision", "Use pnpm as the only package manager."], { home });
  assert.equal(first.sync, "local-only");
  assert.equal(first.shared.pushed, 0);
  assert.equal(first.activeMemories, 1);

  // An unset $SPINAL_PLUG_SYNC_URL passed as --url "" in the plugin scripts
  // must also select local-only, not a usage error.
  const second = await runCliJson<ShareResult>(
    ["share", db, project, "context", "--url", "", "--device-id", "device-a", "The API listens on 48081."],
    { home }
  );
  assert.equal(second.sync, "local-only");
  assert.equal(second.activeMemories, 2);

  const memories = await runCliJson<Array<{ statement: string }>>(["list", db, project], { home });
  assert.equal(memories.length, 2);
});

test("share keeps statements verbatim and only publishes to --url", async () => {
  const server = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/verbatim.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home });

    // A statement ending in "URL + word" must not be reparsed as endpoint
    // arguments: the text stays intact and nothing leaves the device.
    const statement = "See the runbook https://example.com/runbook now";
    const local = await runCliJson<{ memory: { statement: string }; sync: string }>(
      ["share", db, project, "reference", "--url", "", statement],
      { home }
    );
    assert.equal(local.memory.statement, statement);
    assert.equal(local.sync, "local-only");

    // --url alone (no --device-id) is a valid publish form.
    const published = await runCliJson<{ memory: { statement: string }; sync: string; shared: { pushed: number } }>(
      ["share", db, project, "decision", "--url", server.url, "Use pnpm as the only package manager."],
      { home }
    );
    assert.equal(published.sync, "endpoint");
    assert.equal(published.shared.pushed, 2);
    // Publishing flushes the durable outbox: the earlier local-only memory
    // travels with the new one — local-first, not local-forever.
    const serverSnapshot = await snapshot(server, spaceIdOf(project));
    assert.deepEqual(
      serverSnapshot.memories.map(memory => memory.statement).sort(),
      ["See the runbook https://example.com/runbook now", "Use pnpm as the only package manager."]
    );
  } finally {
    await server.close();
  }
});

test("remember --candidate dedupes identical facts and preserves literal flag text", async () => {
  const home = tempDir("spinal-plug-home-");
  const project = initGitProject("https://github.com/spinal-plug-tests/candidate-flags.git");
  const db = join(tempDir("spinal-plug-db-"), "local.db");
  await bindViaSessionStart(db, project, { home });

  // Re-staging the same candidate fact returns the existing record.
  await runCli(["remember", db, project, "context", "--candidate", "Generated from the session."], { home });
  const duplicate = await runCliJson<{ memoryId: string; duplicate?: boolean }>(
    ["remember", db, project, "context", "--candidate", "Generated from the session."],
    { home }
  );
  assert.equal(duplicate.duplicate, true);
  const candidates = await runCliJson<Array<{ status: string }>>(["candidates", db, project], { home });
  assert.equal(candidates.length, 1);

  // A literal "--candidate" inside the text is just text: the memory stays
  // active and its statement is untouched.
  const literal = await runCliJson<{ status: string; statement: string }>(
    ["remember", db, project, "context", "部署脚本接受 --candidate 参数表示灰度发布"],
    { home }
  );
  assert.equal(literal.status, "active");
  assert.equal(literal.statement, "部署脚本接受 --candidate 参数表示灰度发布");
});

test("keys lists the registry and share/remember classify with --key", async () => {
  const home = tempDir("spinal-plug-home-");
  const project = initGitProject("https://github.com/spinal-plug-tests/semantic-keys.git");
  const db = join(tempDir("spinal-plug-db-"), "local.db");
  await bindViaSessionStart(db, project, { home });

  // Keys are normalized mechanically: case, spaces, and underscores collapse.
  const shared = await runCliJson<{ memory: { semanticKey?: string } }>(
    ["share", db, project, "decision", "--key", "Package Manager", "Use pnpm."],
    { home }
  );
  assert.equal(shared.memory.semanticKey, "package-manager");
  await runCli(
    ["share", db, project, "context", "--key", "package-manager", "Lockfile is pnpm-lock.yaml."],
    { home }
  );

  // Candidates can carry keys too, including namespaced ones.
  const candidate = await runCliJson<{ semanticKey?: string; status: string }>(
    ["remember", db, project, "context", "--candidate", "--key", "deploy:runbook", "Deploy via pnpm start."],
    { home }
  );
  assert.equal(candidate.semanticKey, "deploy:runbook");
  assert.equal(candidate.status, "candidate");

  // The registry lists active memories only, grouped by key.
  const keys = await runCliJson<Array<{ semanticKey: string; memoryCount: number; sample: string }>>(
    ["keys", db, project],
    { home }
  );
  assert.equal(keys.length, 1);
  assert.equal(keys[0].semanticKey, "package-manager");
  assert.equal(keys[0].memoryCount, 2);
  assert.ok(keys[0].sample.length > 0);

  // A key that normalizes to nothing is rejected, not silently mangled.
  await assert.rejects(
    runCli(["share", db, project, "context", "--key", "!!!", "No key survives."], { home }),
    /Invalid semantic key/
  );
});

test("empty-chamber Claude Stop nudges once per session and stops after generation", async () => {
  const home = tempDir("spinal-plug-home-");
  const project = initGitProject("https://github.com/spinal-plug-tests/nudge.git");
  const db = join(tempDir("spinal-plug-db-"), "local.db");
  await bindViaSessionStart(db, project, { home });

  const stopPayload = (sessionId: string) => JSON.stringify({
    hook_event_name: "Stop",
    cwd: project,
    session_id: sessionId,
    last_assistant_message: "Done."
  });

  const first = await runCliJson<{ decision?: string; reason?: string }>(
    ["hook-stdin", "claude-code", db],
    { home, input: stopPayload("session-1") }
  );
  assert.equal(first.decision, "block");
  assert.match(first.reason ?? "", /spinal-plug_memory_nudge/);
  assert.match(first.reason ?? "", /--candidate/);

  // The same session is never nudged twice, even while the chamber stays empty.
  const second = await runCliJson<{ decision?: string; notices?: string[] }>(
    ["hook-stdin", "claude-code", db],
    { home, input: stopPayload("session-1") }
  );
  assert.equal(second.decision, undefined);
  assert.ok(second.notices);

  // Following the nudge stages a reviewable candidate, which ends nudging for
  // good — even in a brand-new session.
  await runCli(["remember", db, project, "context", "--candidate", "Generated from the session."], { home });
  const candidates = await runCliJson<Array<{ status: string; statement: string }>>(
    ["candidates", db, project],
    { home }
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "candidate");

  const third = await runCliJson<{ decision?: string; notices?: string[] }>(
    ["hook-stdin", "claude-code", db],
    { home, input: stopPayload("session-2") }
  );
  assert.equal(third.decision, undefined);
  assert.ok(third.notices);
});

test("empty-chamber Codex Stop emits a systemMessage nudge instead of blocking", async () => {
  const home = tempDir("spinal-plug-home-");
  const project = initGitProject("https://github.com/spinal-plug-tests/nudge-codex.git");
  const db = join(tempDir("spinal-plug-db-"), "local.db");
  await runCli(["hook", "codex", "session.start", db, project], { home });

  const payload = JSON.stringify({
    hook_event_name: "Stop",
    cwd: project,
    session_id: "codex-session-1",
    last_assistant_message: "已完成。"
  });
  const first = await runCliJson<{ systemMessage?: string }>(
    ["hook-stdin", "codex", db],
    { home, input: payload }
  );
  assert.match(first.systemMessage ?? "", /spinal-plug_memory_nudge/);

  // A Codex Stop whose output yields a candidate never triggers the nudge.
  const withOutput = JSON.stringify({
    hook_event_name: "Stop",
    cwd: project,
    session_id: "codex-session-2",
    last_assistant_message: "决定采用 pnpm 作为本仓库唯一的包管理器。其他改动已经完成。"
  });
  const second = await runCliJson<{ systemMessage?: string; notices?: string[] }>(
    ["hook-stdin", "codex", db],
    { home, input: withOutput }
  );
  assert.equal(second.systemMessage, undefined);
  assert.match(second.notices?.[0] ?? "", /stored 1 reviewable candidate/);
});

test("Claude PostToolUse on a memory-dir write hot-syncs; other writes stay quiet", async () => {
  const server = await startServer();
  try {
    const home = tempDir("spinal-plug-home-");
    const project = initGitProject("https://github.com/spinal-plug-tests/hot-sync.git");
    const db = join(tempDir("spinal-plug-db-"), "local.db");
    await bindViaSessionStart(db, project, { home, syncUrl: server.url });

    const memoryDir = claudeMemoryDir(home, project);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, "fresh.md"), "# Fresh fact\n\nWritten by Claude's own extractor.\n");

    const postToolUse = (filePath: string) => JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: project,
      session_id: "session-1",
      tool_name: "Edit",
      tool_input: { file_path: filePath }
    });

    // A write to an ordinary source file must not import or publish anything.
    const ignored = await runCli(
      ["hook-stdin", "claude-code", db],
      { home, syncUrl: server.url, input: postToolUse(join(project, "src", "index.ts")) }
    );
    assert.equal(ignored.trim(), "{}");
    assert.equal((await snapshot(server, spaceIdOf(project))).memories.length, 0);

    // A write inside the native memory directory syncs while the write is hot.
    const hot = await runCli(
      ["hook-stdin", "claude-code", db],
      { home, syncUrl: server.url, input: postToolUse(join(memoryDir, "fresh.md")) }
    );
    assert.equal(hot.trim(), "{}");
    const serverSnapshot = await snapshot(server, spaceIdOf(project));
    assert.deepEqual(serverSnapshot.memories.map(memory => memory.title), ["Fresh fact"]);

    // The managed projection file lives in the same directory: it triggers the
    // hook but the importer skips it, so projection writes cannot self-retrigger.
    writeFileSync(join(memoryDir, "spinal-plug-synced.md"), "managed projection\n");
    await runCli(
      ["hook-stdin", "claude-code", db],
      { home, syncUrl: server.url, input: postToolUse(join(memoryDir, "spinal-plug-synced.md")) }
    );
    assert.equal((await snapshot(server, spaceIdOf(project))).memories.length, 1);
  } finally {
    await server.close();
  }
});

test("apply-claude materializes a managed projection without touching user memory", async () => {
  const server = await startServer();
  try {
    const remote = "https://github.com/spinal-plug-tests/materialize.git";
    const homeA = tempDir("spinal-plug-home-a-");
    const homeB = tempDir("spinal-plug-home-b-");
    const projectA = initGitProject(remote);
    const projectB = initGitProject(remote);
    const dbA = join(tempDir("spinal-plug-db-a-"), "local.db");
    const dbB = join(tempDir("spinal-plug-db-b-"), "local.db");
    await bindViaSessionStart(dbA, projectA, { home: homeA, syncUrl: server.url });
    await bindViaSessionStart(dbB, projectB, { home: homeB, syncUrl: server.url });

    const memoryDirA = claudeMemoryDir(homeA, projectA);
    mkdirSync(memoryDirA, { recursive: true });
    writeFileSync(join(memoryDirA, "shared.md"), "# Shared runbook\n\nRestart the gateway before upgrades.\n");
    await runCli(["share-claude", dbA, projectA, server.url, "device-a"], { home: homeA });

    // Device B has its own user-owned native memory that must survive projection.
    const memoryDirB = claudeMemoryDir(homeB, projectB);
    mkdirSync(memoryDirB, { recursive: true });
    writeFileSync(join(memoryDirB, "MEMORY.md"), "- [Local note](local.md) — user owned\n");
    writeFileSync(join(memoryDirB, "local.md"), "# Local note\n\nPrivate to this machine.\n");

    await runCli(["fetch", dbB, projectB, server.url, "device-b"], { home: homeB });
    const applied = await runCliJson<{
      applied: { applied: number };
      materialized: { filePath: string; memoryCount: number };
    }>(["apply-claude", dbB, projectB], { home: homeB });
    assert.equal(applied.applied.applied, 1);
    assert.equal(applied.materialized.memoryCount, 1);

    const synced = readFileSync(join(memoryDirB, "spinal-plug-synced.md"), "utf8");
    assert.match(synced, /Shared runbook/);
    assert.match(synced, /Restart the gateway before upgrades/);

    const index = readFileSync(join(memoryDirB, "MEMORY.md"), "utf8");
    assert.match(index, /user owned/, "user index content is preserved");
    assert.match(index, /spinal-plug:managed:start/);

    // A second run replaces the managed block instead of appending another one.
    await runCli(["apply-claude", dbB, projectB], { home: homeB });
    const indexAgain = readFileSync(join(memoryDirB, "MEMORY.md"), "utf8");
    assert.equal(indexAgain.match(/spinal-plug:managed:start/g)?.length, 1);
    // B's own native topic must not round-trip into the managed projection.
    assert.doesNotMatch(readFileSync(join(memoryDirB, "spinal-plug-synced.md"), "utf8"), /Private to this machine/);
  } finally {
    await server.close();
  }
});
