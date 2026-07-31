import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SpinalPlugDatabase } from "./index.js";
import { SpinalPlugSyncClient, type SyncTransport } from "./sync-client.js";

function openTestDatabase(): SpinalPlugDatabase {
  const database = new SpinalPlugDatabase(join(mkdtempSync(join(tmpdir(), "spinal-plug-pages-")), "local.db"));
  database.init();
  return database;
}

/** An endpoint that claims another page forever, and never advances its cursor. */
function neverDrainingTransport(): { transport: SyncTransport; calls: () => number } {
  let calls = 0;
  const transport: SyncTransport = {
    async push() {
      return { acceptedEventIds: [], duplicateEventIds: [], serverCursor: "" };
    },
    async pull() {
      calls += 1;
      return { events: [], nextCursor: "cur_stuck", hasMore: true };
    },
    async fetchUpdates() {
      calls += 1;
      return { updates: [], nextCursor: "cur_stuck", hasMore: true };
    }
  };
  return { transport, calls: () => calls };
}

test("a fetch against an endpoint that never drains stops instead of looping forever", async () => {
  const { transport, calls } = neverDrainingTransport();
  const client = new SpinalPlugSyncClient(openTestDatabase(), transport);

  await assert.rejects(
    () => client.fetch("spc_pages", "device:test"),
    /exceeded 1000 pages/
  );
  // Bounded by the page budget, not by luck: the guard refuses the page after
  // the budget rather than fetching it.
  assert.equal(calls(), 1000);
});
