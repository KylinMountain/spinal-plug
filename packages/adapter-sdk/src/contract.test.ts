import assert from "node:assert/strict";
import test from "node:test";
import type {
  AdapterObservation,
  ContextProjection,
  HookEventName,
  HostCapabilities,
  HostHookPayload,
  SpinalPlugAdapter
} from "./index.js";

/**
 * This package is the stable contract between Spinal Plug and a host, and it
 * ships no runtime code — so the thing worth testing is that the contract can
 * still be satisfied. A minimal conforming adapter is that test: narrowing a
 * member, renaming one, or making an optional field required stops this file
 * from compiling, which is exactly when a host integration would break.
 */

const EVERY_HOOK: Record<HookEventName, true> = {
  "session.start": true,
  "prompt.submit": true,
  "post.tool.use": true,
  "pre.compact": true,
  stop: true,
  "session.end": true
};

const capabilities: HostCapabilities = {
  host: "test-host",
  adapterVersion: "0.1.0",
  supportedHooks: Object.keys(EVERY_HOOK) as HookEventName[],
  contextSinks: ["hook.additionalContext"],
  maxContextTokens: 2_000,
  supportsAsyncFetch: false
};

class MinimalAdapter implements SpinalPlugAdapter {
  readonly name = "test-host";

  async detectCapabilities(): Promise<HostCapabilities> {
    return capabilities;
  }

  async resolveProjectSpace(): Promise<null> {
    return null;
  }

  async injectContext(projection: ContextProjection): Promise<{ additionalContext: string }> {
    return { additionalContext: projection.content };
  }

  async captureObservations(payload: HostHookPayload): Promise<AdapterObservation[]> {
    if (payload.event !== "stop" || !payload.output) return [];
    return [{
      kind: "decision",
      title: "Observed once",
      statement: payload.output,
      confidence: 0.8,
      source: payload.event
    }];
  }
}

test("a minimal adapter satisfies the contract", async () => {
  const adapter: SpinalPlugAdapter = new MinimalAdapter();

  assert.deepEqual(await adapter.detectCapabilities(), capabilities);
  assert.equal(await adapter.resolveProjectSpace({ event: "stop", cwd: "/tmp", sessionId: "s" }), null);
  // toEventEnvelopes is optional: a host that has nothing to translate must
  // remain conforming without implementing it.
  assert.equal(adapter.toEventEnvelopes, undefined);
});

test("observations are captured only where a host has something to observe", async () => {
  const adapter = new MinimalAdapter();
  const base: HostHookPayload = { event: "prompt.submit", cwd: "/tmp", sessionId: "s" };

  assert.deepEqual(await adapter.captureObservations(base), []);
  assert.deepEqual(await adapter.captureObservations({ ...base, event: "stop" }), []);

  const observed = await adapter.captureObservations({ ...base, event: "stop", output: "Chose SQLite" });
  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.source, "stop");
  assert.ok(observed[0]!.confidence <= 1 && observed[0]!.confidence >= 0);
});

test("the projection carries a Space and its generation time", () => {
  const projection: ContextProjection = {
    kind: "project_boot",
    space: {
      schema: "spinal-plug.project-space/v0.1",
      spaceId: "spc_test",
      type: "archive",
      displayName: "test"
    },
    content: "BOOT SEQUENCE",
    generatedAt: "2026-07-31T00:00:00.000Z",
    relatedMemoryIds: []
  };

  assert.equal(projection.space.type, "archive");
  assert.match(projection.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
