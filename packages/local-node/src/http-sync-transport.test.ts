import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { HttpSyncTransport } from "./http-sync-transport.js";

/**
 * A sync endpoint is remote input. These tests stand one up and make it
 * misbehave the way a faulty or hostile server would: never answering, and
 * answering without end.
 */
async function serve(t: TestContext, handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server: Server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const pullRequest = { spaceId: "spc_test", deviceId: "device:test" };

test("a request that never answers times out instead of hanging", async t => {
  const url = await serve(t, () => {
    // Accept the request and answer nothing at all.
  });
  const transport = new HttpSyncTransport(url, undefined, { requestTimeoutMs: 250 });

  await assert.rejects(() => transport.pull(pullRequest), /timed out after 250ms/);
});

test("an unbounded response body is abandoned at the cap", async t => {
  let stopped = false;
  const url = await serve(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    // Announce a plausible object and then never stop writing.
    response.write('{"events":[');
    const pump = (): void => {
      if (stopped || !response.write(`"${"x".repeat(4096)}",`)) return;
      setImmediate(pump);
    };
    response.on("close", () => { stopped = true; });
    pump();
  });
  const transport = new HttpSyncTransport(url, undefined, { maxResponseBytes: 64 * 1024 });

  await assert.rejects(() => transport.pull(pullRequest), /exceeded 65536 bytes/);
});

test("a body under the cap is still parsed normally", async t => {
  const url = await serve(t, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ events: [], nextCursor: "cur_1", hasMore: false }));
  });
  const transport = new HttpSyncTransport(url, undefined, { maxResponseBytes: 64 * 1024 });

  const result = await transport.pull(pullRequest);
  assert.deepEqual(result, { events: [], nextCursor: "cur_1", hasMore: false });
});

test("a non-JSON body is reported as such, not as a parser crash", async t => {
  const url = await serve(t, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html>proxy error</html>");
  });
  const transport = new HttpSyncTransport(url);

  await assert.rejects(() => transport.pull(pullRequest), /was not valid JSON/);
});
