import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EventEnvelope } from "@spinal-plug/protocol";
import { SpinalPlugControlPlane } from "./control-plane.js";
import { createControlPlaneHttpServer } from "./control-plane-http-server.js";

function testControlPlane(): SpinalPlugControlPlane {
  const directory = mkdtempSync(join(tmpdir(), "spinal-plug-control-"));
  return new SpinalPlugControlPlane(join(directory, "control.db"));
}

function eventFor(
  accountId: string,
  deviceId: string,
  spaceId: string,
  id: string
): EventEnvelope {
  return {
    schemaVersion: 1,
    eventId: id,
    eventType: "memory.created",
    eventVersion: 1,
    accountId,
    personaId: "persona_default",
    spaceId,
    actor: {
      deviceId,
      agentInstallationId: "test",
      host: "test",
      sessionId: "test",
      adapterVersion: "0.1.0"
    },
    causality: { parentEventIds: [] },
    runtimeContext: {},
    payload: {
      memoryId: `mem_${id}`,
      kind: "decision",
      title: "Queue",
      statement: "Use Kafka",
      origin: "user_explicit",
      confidence: 1
    },
    createdAt: "2026-07-23T12:00:00Z",
    idempotencyKey: id
  };
}

test("isolates accounts and enforces Space roles", async () => {
  const control = testControlPlane();
  const owner = control.provisionAccount({
    accountName: "Acme",
    ownerEmail: "owner@acme.test",
    ownerName: "Owner",
    deviceName: "Owner Mac"
  });
  const ownerPrincipal = control.authenticate(owner.credential.token);
  const spaceId = "spc_acme";
  control.createSpace(ownerPrincipal, {
    spaceId,
    type: "project",
    displayName: "payments"
  });

  const memberId = control.createUser(ownerPrincipal, {
    email: "viewer@acme.test",
    displayName: "Viewer"
  });
  control.setSpaceMember(ownerPrincipal, spaceId, memberId, "viewer");
  const viewerCredential = control.registerDevice(ownerPrincipal, "Viewer Mac", memberId);
  const viewer = control.authenticate(viewerCredential.token);

  await assert.rejects(
    control.push(viewer, {
      spaceId,
      deviceId: viewer.deviceId,
      events: [eventFor(viewer.accountId, viewer.deviceId, spaceId, "evt_viewer")]
    }),
    /permission denied/
  );
  assert.equal((await control.pull(viewer, {
    spaceId,
    deviceId: viewer.deviceId
  })).events.length, 0);

  const other = control.provisionAccount({
    accountName: "Other",
    ownerEmail: "owner@other.test",
    ownerName: "Other Owner",
    deviceName: "Other Mac"
  });
  const otherPrincipal = control.authenticate(other.credential.token);
  assert.throws(() => control.snapshot(otherPrincipal, spaceId), /not found/);
  control.close();
});

test("accepts matching account and device events and rejects mismatches", async () => {
  const control = testControlPlane();
  const provisioned = control.provisionAccount({
    accountName: "Acme",
    ownerEmail: "owner@acme.test",
    ownerName: "Owner",
    deviceName: "Owner Mac"
  });
  const principal = control.authenticate(provisioned.credential.token);
  const spaceId = "spc_events";
  control.createSpace(principal, { spaceId, type: "project", displayName: "events" });

  const accepted = await control.push(principal, {
    spaceId,
    deviceId: principal.deviceId,
    events: [eventFor(principal.accountId, principal.deviceId, spaceId, "evt_01")]
  });
  assert.deepEqual(accepted.acceptedEventIds, ["evt_01"]);
  assert.deepEqual(control.events(principal, spaceId).map(event => event.eventId), ["evt_01"]);

  await assert.rejects(
    control.push(principal, {
      spaceId,
      deviceId: principal.deviceId,
      events: [eventFor("acc_wrong", principal.deviceId, spaceId, "evt_02")]
    }),
    /account does not match/
  );
  control.close();
});

test("revoked device credentials cannot authenticate", () => {
  const control = testControlPlane();
  const provisioned = control.provisionAccount({
    accountName: "Acme",
    ownerEmail: "owner@acme.test",
    ownerName: "Owner",
    deviceName: "Owner Mac"
  });
  const principal = control.authenticate(provisioned.credential.token);
  const secondary = control.registerDevice(principal, "Second Device");
  control.revokeDevice(principal, secondary.device.deviceId);

  assert.throws(() => control.authenticate(secondary.token), /revoked/);
  control.close();
});

test("plain HTTP control plane refuses non-loopback listeners", () => {
  const control = testControlPlane();
  const server = createControlPlaneHttpServer(control, { bootstrapToken: "bootstrap-test" });
  assert.throws(() => server.listen(8787, "0.0.0.0"), /require TLS/);
  control.close();
});

test("HTTP control plane rate-limits authenticated devices", async () => {
  const control = testControlPlane();
  const server = createControlPlaneHttpServer(control, {
    bootstrapToken: "bootstrap-test",
    rateLimit: { requests: 1, windowMs: 60_000 }
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);

  const bootstrap = await fetch(`http://127.0.0.1:${port}/v1/admin/bootstrap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spinal-plug-bootstrap-token": "bootstrap-test"
    },
    body: JSON.stringify({
      accountName: "Acme",
      ownerEmail: "owner@acme.test",
      ownerName: "Owner",
      deviceName: "Owner Mac"
    })
  });
  assert.equal(bootstrap.status, 201);
  const provisioned = await bootstrap.json() as { credential: { token: string } };

  const first = await fetch(`http://127.0.0.1:${port}/v1/devices`, {
    headers: { authorization: `Bearer ${provisioned.credential.token}` }
  });
  assert.equal(first.status, 200);
  const second = await fetch(`http://127.0.0.1:${port}/v1/devices`, {
    headers: { authorization: `Bearer ${provisioned.credential.token}` }
  });
  assert.equal(second.status, 429);

  await server.close();
  control.close();
});

test("overview aggregates memory lifecycle, fidelity, and activity for the dashboard", async t => {
  const control = testControlPlane();
  const provisioned = control.provisionAccount({
    accountName: "Acme",
    ownerEmail: "owner@acme.test",
    ownerName: "Owner",
    deviceName: "Owner Mac"
  });
  const principal = control.authenticate(provisioned.credential.token);
  control.createSpace(principal, { spaceId: "spc_overview", type: "project", displayName: "overview" });
  const secondEvent = eventFor(principal.accountId, principal.deviceId, "spc_overview", "evt_ov2");
  secondEvent.payload = { ...secondEvent.payload, statement: "Use NATS", title: "Broker" };
  await control.push(principal, {
    spaceId: "spc_overview",
    deviceId: principal.deviceId,
    events: [
      eventFor(principal.accountId, principal.deviceId, "spc_overview", "evt_ov1"),
      secondEvent
    ]
  });

  const server = createControlPlaneHttpServer(control, { bootstrapToken: "bootstrap-test" });
  t.after(async () => {
    await server.close();
    control.close();
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);

  const response = await fetch(`http://127.0.0.1:${port}/v1/spaces/spc_overview/overview`, {
    headers: { authorization: `Bearer ${provisioned.credential.token}` }
  });
  assert.equal(response.status, 200);
  const overview = await response.json() as {
    schema: string;
    memory: { active: number; candidates: number; disputes: number; tombstones: number };
    fidelity: { percent: number; activeReferences: number; capsuleUsage: { used: number; budget: number } };
    incarnations: unknown[];
    incomingUpdates: unknown[];
    activity: Array<{ eventType: string; deviceId: string }>;
  };
  assert.equal(overview.schema, "spinal-plug.space-overview/v0.1");
  assert.equal(overview.memory.active, 2);
  assert.equal(overview.memory.candidates, 0);
  assert.equal(overview.fidelity.percent, 100);
  assert.equal(overview.fidelity.activeReferences, 2);
  assert.ok(overview.fidelity.capsuleUsage.used > 0);
  assert.equal(overview.fidelity.capsuleUsage.budget, 24_000);
  assert.equal(overview.activity.length, 2);
  assert.equal(overview.activity[0].deviceId, principal.deviceId);
  assert.deepEqual(overview.incarnations, []);

  // ACL still applies: another account's token gets no overview.
  const other = control.provisionAccount({
    accountName: "Other",
    ownerEmail: "owner@other.test",
    ownerName: "Other Owner",
    deviceName: "Other Mac"
  });
  const forbidden = await fetch(`http://127.0.0.1:${port}/v1/spaces/spc_overview/overview`, {
    headers: { authorization: `Bearer ${other.credential.token}` }
  });
  assert.equal(forbidden.status, 404);
});

test("serves the memory palace shell and static assets", async t => {
  const control = testControlPlane();
  const server = createControlPlaneHttpServer(control, { bootstrapToken: "bootstrap-test" });
  // Close via t.after so a failed assertion cannot leave a listening server
  // keeping the test process alive.
  t.after(async () => {
    await server.close();
    control.close();
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);
  const base = `http://127.0.0.1:${port}`;

  const shell = await fetch(`${base}/palace`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(shell.headers.get("cache-control"), "no-store");
  assert.equal(shell.headers.get("x-content-type-options"), "nosniff");
  assert.match(await shell.text(), /MEMORY PALACE/);

  const script = await fetch(`${base}/palace/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /text\/javascript/);

  const styles = await fetch(`${base}/palace/styles.css`);
  assert.equal(styles.status, 200);
  assert.match(styles.headers.get("content-type") ?? "", /text\/css/);

  const missing = await fetch(`${base}/palace/does-not-exist.js`);
  assert.equal(missing.status, 404);
});

test("rejects palace path traversal attempts", async t => {
  const control = testControlPlane();
  const server = createControlPlaneHttpServer(control, { bootstrapToken: "bootstrap-test" });
  t.after(async () => {
    await server.close();
    control.close();
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);

  // Encoded dot segments must be refused. node:http sends the path verbatim.
  // The WHATWG URL parser collapses %2e%2e during parsing, so that variant
  // never reaches the /palace route and is refused with 401; the encoded-slash
  // variants reach servePalaceAsset, where the dot-segment rejection answers
  // 404 before the path is ever resolved — exact statuses, so removing the
  // guard cannot keep this test green.
  const cases: Array<[string, number]> = [
    ["/palace/%2e%2e/%2e%2e/package.json", 401],
    ["/palace/..%2f..%2fpackage.json", 404],
    ["/palace/vendor/..%2f..%2fsrc%2fcontrol-plane.ts", 404]
  ];
  for (const [path, expected] of cases) {
    const status = await new Promise<number>((resolveStatus, rejectStatus) => {
      const request = httpGet({ host: "127.0.0.1", port, path }, response => {
        response.resume();
        response.on("end", () => resolveStatus(response.statusCode ?? 0));
      });
      request.on("error", rejectStatus);
    });
    assert.equal(status, expected, `${path} -> ${status}`);
  }
});

test("palace assets support HEAD and refuse other methods", async t => {
  const control = testControlPlane();
  const server = createControlPlaneHttpServer(control, { bootstrapToken: "bootstrap-test" });
  t.after(async () => {
    await server.close();
    control.close();
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);
  const base = `http://127.0.0.1:${port}`;

  const head = await fetch(`${base}/palace/app.js`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.match(head.headers.get("content-type") ?? "", /text\/javascript/);
  assert.ok(Number(head.headers.get("content-length")) > 0);
  assert.equal(await head.text(), "");

  const post = await fetch(`${base}/palace/app.js`, { method: "POST" });
  assert.equal(post.status, 405);
});

test("palace never serves dotfiles or test sources", async t => {
  const control = testControlPlane();
  const server = createControlPlaneHttpServer(control, { bootstrapToken: "bootstrap-test" });
  t.after(async () => {
    await server.close();
    control.close();
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);
  const base = `http://127.0.0.1:${port}`;

  for (const path of ["/palace/.env", "/palace/.git/config", "/palace/.hidden key"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, `${path} -> ${response.status}`);
  }
});

test("palace refuses symlinks escaping the asset directory", async t => {
  const control = testControlPlane();
  const palace = mkdtempSync(join(tmpdir(), "spinal-plug-palace-"));
  const outside = join(tmpdir(), `spinal-plug-outside-${process.pid}-${Date.now()}.txt`);
  writeFileSync(join(palace, "index.html"), "<h1>palace</h1>");
  writeFileSync(outside, "secret");
  symlinkSync(outside, join(palace, "escape.txt"));
  t.after(() => {
    rmSync(join(palace, "escape.txt"), { force: true });
    rmSync(join(palace, "index.html"), { force: true });
    rmSync(palace, { recursive: true, force: true });
    rmSync(outside, { force: true });
  });
  const server = createControlPlaneHttpServer(control, { bootstrapToken: "bootstrap-test", palaceDir: palace });
  t.after(async () => {
    await server.close();
    control.close();
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);

  const escape = await fetch(`http://127.0.0.1:${port}/palace/escape.txt`);
  assert.equal(escape.status, 403);
});

test("palace asset requests are rate-limited per client", async t => {
  const control = testControlPlane();
  const server = createControlPlaneHttpServer(control, {
    bootstrapToken: "bootstrap-test",
    rateLimit: { requests: 2, windowMs: 60_000 }
  });
  t.after(async () => {
    await server.close();
    control.close();
  });
  await server.listen(0);
  const port = server.address()?.port;
  assert.ok(port);
  const base = `http://127.0.0.1:${port}`;

  assert.equal((await fetch(`${base}/palace/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/palace/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/palace/app.js`)).status, 429);
});
