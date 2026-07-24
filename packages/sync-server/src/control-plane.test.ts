import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EventEnvelope } from "@mind-palace/protocol";
import { MindPalaceControlPlane } from "./control-plane.js";
import { createControlPlaneHttpServer } from "./control-plane-http-server.js";

function testControlPlane(): MindPalaceControlPlane {
  const directory = mkdtempSync(join(tmpdir(), "mind-palace-control-"));
  return new MindPalaceControlPlane(join(directory, "control.db"));
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
      "x-mind-palace-bootstrap-token": "bootstrap-test"
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
