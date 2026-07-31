import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { ProjectSpaceResolver, SpinalPlugDatabase, ProjectMemoryService } from "@spinal-plug/local-node";
import { SpinalPlugMcpServer } from "./index.js";

/**
 * The MCP surface answers per-directory questions, so every test binds its own
 * throwaway home: none of them may read or write the developer's real bindings.
 */
function fixture(t: TestContext): { home: string; project: string; database: SpinalPlugDatabase } {
  const home = mkdtempSync(join(tmpdir(), "spinal-plug-mcp-"));
  const project = join(home, "project");
  mkdirSync(project, { recursive: true });
  const database = new SpinalPlugDatabase(join(home, "local.db"));
  database.init();
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, project, database };
}

test("the advertised tools require the directory they answer for", t => {
  const { database, home } = fixture(t);

  const tools = new SpinalPlugMcpServer(database, { homeDirectory: home }).listTools();

  assert.deepEqual(tools.map(tool => tool.name), ["spinal-plug_status", "spinal-plug_recall"]);
  for (const tool of tools) {
    const schema = tool.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    assert.ok(schema.required?.includes("cwd"), `${tool.name} must require cwd`);
    assert.ok(schema.properties?.cwd, `${tool.name} must declare cwd`);
    assert.ok(tool.description.length > 0);
  }
  assert.deepEqual(
    (tools[1]?.inputSchema as { required?: string[] }).required,
    ["cwd", "query"]
  );
});

test("status reports an unlinked directory instead of inventing a Space", t => {
  const { database, home, project } = fixture(t);

  const status = new SpinalPlugMcpServer(database, { homeDirectory: home }).status(project);

  assert.equal(status.space, null);
  assert.equal(status.activeMemoryCount, 0);
  assert.equal(status.pendingOutboxEvents, 0);
});

test("recall refuses an unlinked directory rather than answering from another Space", t => {
  const { database, home, project } = fixture(t);

  assert.throws(
    () => new SpinalPlugMcpServer(database, { homeDirectory: home }).recall(project, "queue"),
    /Project Space is not initialized/
  );
});

test("status and recall answer from the Space bound to the given directory", t => {
  const { database, home, project } = fixture(t);
  const { space } = new ProjectSpaceResolver({ homeDirectory: home }).initializeArchive(project, "mcp-test");
  const memories = new ProjectMemoryService(database);
  memories.remember({ space, kind: "decision", statement: "Kafka is the queue for ingestion" });
  memories.remember({ space, kind: "context", statement: "Backups run nightly against the replica" });

  const server = new SpinalPlugMcpServer(database, { homeDirectory: home });

  const status = server.status(project);
  assert.equal(status.space?.spaceId, space.spaceId);
  assert.equal(status.activeMemoryCount, 2);
  assert.equal(status.pendingOutboxEvents, 2, "each memory queues one event for publication");

  const recalled = server.recall(project, "which queue do we use");
  assert.ok(recalled.length >= 1);
  assert.match(recalled[0]!.statement, /Kafka/, "the relevant memory ranks first");
});
