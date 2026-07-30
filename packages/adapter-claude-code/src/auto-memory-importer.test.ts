import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { ProjectSpace } from "@spinal-plug/protocol";
import { ClaudeAutoMemoryImporter, ClaudeAutoMemoryMaterializer } from "./auto-memory-importer.js";

const space: ProjectSpace = {
  schema: "spinal-plug.project-space/v0.1",
  spaceId: "spc_auto_memory_test",
  type: "project",
  displayName: "auto-memory-test"
};

interface Fixture {
  readonly home: string;
  readonly project: string;
  readonly memoryDir: string;
}

/** Isolated Claude home so tests never touch real per-project memory. */
function createFixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), "spinal-plug-claude-home-"));
  const project = join(home, "project");
  mkdirSync(project, { recursive: true });
  const memoryDir = new ClaudeAutoMemoryImporter({ homeDirectory: home }).memoryDirectory(project);
  mkdirSync(memoryDir, { recursive: true });
  return { home, project, memoryDir };
}

const baseMemory = {
  memoryId: "mem_test_alpha",
  kind: "decision",
  title: "Keep the CLI local-first",
  statement: "The CLI must work fully offline; the endpoint is an optional accelerator.",
  updatedAt: "2026-07-30T02:17:53.512Z"
};

test("materialize writes hyphen-prefixed managed files and index links", () => {
  const fixture = createFixture();
  const materializer = new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home });

  const result = materializer.materialize(fixture.project, [baseMemory]);

  assert.equal(result.memoryCount, 1);
  assert.equal(result.filePath, join(fixture.memoryDir, "MEMORY.md"));

  const managedPath = join(fixture.memoryDir, "spinal-plug-managed-mem_test_alpha.md");
  assert.ok(existsSync(managedPath), "managed file must use the spinal-plug- prefix");
  const managed = readFileSync(managedPath, "utf8");
  assert.match(managed, /^---\n/);
  assert.match(managed, /name: spinal-plug-decision-mem_test/);
  assert.match(managed, /modified: 2026-07-30T02:17:53\.512Z/);
  assert.match(managed, /# Keep the CLI local-first/);

  const index = readFileSync(result.filePath, "utf8");
  assert.match(index, /- \[Keep the CLI local-first\]\(spinal-plug-managed-mem_test_alpha\.md\)/);
});

test("materialize preserves user-owned MEMORY.md content across reruns", () => {
  const fixture = createFixture();
  const entrypoint = join(fixture.memoryDir, "MEMORY.md");
  writeFileSync(entrypoint, "# Memory Index\n\n- [My own topic](my-topic.md)\n", "utf8");
  const materializer = new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home });

  materializer.materialize(fixture.project, [baseMemory]);
  materializer.materialize(fixture.project, [baseMemory]);

  const index = readFileSync(entrypoint, "utf8");
  assert.match(index, /- \[My own topic\]\(my-topic\.md\)/);
  // Rerunning must replace, not stack, the managed block.
  assert.equal(index.split("<!-- spinal-plug:managed:start -->").length, 2);
});

test("materialize removes stale managed files from both legacy naming schemes", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.memoryDir, "spinal_plug_managed_mem_old.md"), "# Old projection\n", "utf8");
  writeFileSync(join(fixture.memoryDir, "spinal-plug-synced.md"), "# Old aggregate file\n", "utf8");
  writeFileSync(join(fixture.memoryDir, "spinal-plug-managed-mem_gone.md"), "# Removed remotely\n", "utf8");
  writeFileSync(join(fixture.memoryDir, "user-topic.md"), "# User topic\n\nUser owned.\n", "utf8");

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, [baseMemory]);

  const names = readdirSync(fixture.memoryDir).sort();
  assert.deepEqual(names, ["MEMORY.md", "spinal-plug-managed-mem_test_alpha.md", "user-topic.md"]);
});

test("import never re-imports the materialized projection", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.memoryDir, "user-topic.md"), "# User topic\n\nUser owned.\n", "utf8");
  // A leftover from the underscore era must also stay excluded even before
  // the next materialize cleans it up.
  writeFileSync(join(fixture.memoryDir, "spinal_plug_managed_mem_old.md"), "# Old projection\n\nStale.\n", "utf8");

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, [baseMemory]);
  const imported = new ClaudeAutoMemoryImporter({ homeDirectory: fixture.home }).import(space, fixture.project);

  assert.equal(imported.candidates.length, 1);
  assert.equal(imported.candidates[0]?.title, "User topic");
});

test("a hostile memoryId cannot escape the memory directory", () => {
  const fixture = createFixture();
  const hostile = { ...baseMemory, memoryId: "../../escape" };

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, [hostile]);

  assert.ok(!existsSync(resolve(fixture.memoryDir, "../../escape.md")));
  const managed = readdirSync(fixture.memoryDir).filter(name => name.startsWith("spinal-plug-managed-"));
  assert.equal(managed.length, 1, "sanitized id must stay inside the memory directory");
  assert.doesNotMatch(managed[0]!, /[/\\.]{2}|\//);
});
