import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
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
function createFixture(t: TestContext): Fixture {
  const home = mkdtempSync(join(tmpdir(), "spinal-plug-claude-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
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

test("materialize writes hyphen-prefixed managed files and index links", t => {
  const fixture = createFixture(t);
  const materializer = new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home });

  const result = materializer.materialize(fixture.project, [baseMemory]);

  assert.equal(result.memoryCount, 1);
  assert.equal(result.filePath, join(fixture.memoryDir, "MEMORY.md"));

  const managedPath = join(fixture.memoryDir, "spinal-plug-managed-mem_test_alpha.md");
  assert.ok(existsSync(managedPath), "managed file must use the spinal-plug- prefix");
  const managed = readFileSync(managedPath, "utf8");
  assert.match(managed, /^---\n/);
  assert.match(managed, /name: spinal-plug-decision-mem_test/);
  // Values that come from a record are quoted so their content cannot open a key.
  assert.match(managed, /modified: "2026-07-30T02:17:53\.512Z"/);
  assert.match(managed, /type: "decision"/);
  assert.match(managed, /# Keep the CLI local-first/);

  const index = readFileSync(result.filePath, "utf8");
  assert.match(index, /- \[Keep the CLI local-first\]\(spinal-plug-managed-mem_test_alpha\.md\)/);
});

test("materialize preserves user-owned MEMORY.md content across reruns", t => {
  const fixture = createFixture(t);
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

test("materialize removes stale managed files from both legacy naming schemes", t => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.memoryDir, "spinal_plug_managed_mem_old.md"), "# Old projection\n", "utf8");
  writeFileSync(join(fixture.memoryDir, "spinal-plug-synced.md"), "# Old aggregate file\n", "utf8");
  writeFileSync(join(fixture.memoryDir, "spinal-plug-managed-mem_gone.md"), "# Removed remotely\n", "utf8");
  writeFileSync(join(fixture.memoryDir, "user-topic.md"), "# User topic\n\nUser owned.\n", "utf8");

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, [baseMemory]);

  const names = readdirSync(fixture.memoryDir).sort();
  assert.deepEqual(names, ["MEMORY.md", "spinal-plug-managed-mem_test_alpha.md", "user-topic.md"]);
});

test("import never re-imports the materialized projection", t => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.memoryDir, "user-topic.md"), "# User topic\n\nUser owned.\n", "utf8");
  // A leftover from the underscore era must also stay excluded even before
  // the next materialize cleans it up.
  writeFileSync(join(fixture.memoryDir, "spinal_plug_managed_mem_old.md"), "# Old projection\n\nStale.\n", "utf8");

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, [baseMemory]);
  const imported = new ClaudeAutoMemoryImporter({ homeDirectory: fixture.home }).import(space, fixture.project);

  assert.equal(imported.candidates.length, 1);
  assert.equal(imported.candidates[0]?.title, "User topic");
});

test("a hostile memoryId cannot escape the memory directory", t => {
  const fixture = createFixture(t);
  const hostile = { ...baseMemory, memoryId: "../../escape" };

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, [hostile]);

  // An unsanitized name would normalize to memoryDir/escape.md (the leading
  // "spinal-plug-managed-.." path segment absorbs the first "..").
  assert.ok(!existsSync(join(fixture.memoryDir, "escape.md")));
  assert.ok(!existsSync(resolve(fixture.memoryDir, "../../escape.md")));
  const managed = readdirSync(fixture.memoryDir).filter(name => name.startsWith("spinal-plug-managed-"));
  assert.equal(managed.length, 1, "sanitized id must stay inside the memory directory");
});

test("the frontmatter name is as injective as the filename", t => {
  const fixture = createFixture(t);
  // Regression: the name truncated the id to 8 characters, so two `mem_<uuid>`
  // ids agreeing on four hex digits — and every `mem_candidate_*` id — declared
  // the same name in the same directory.
  const memories = [
    { ...baseMemory, memoryId: "mem_1234abcd-1111-4111-8111-111111111111", title: "First" },
    { ...baseMemory, memoryId: "mem_1234abcd-2222-4222-8222-222222222222", title: "Second" },
    { ...baseMemory, memoryId: "mem_candidate_aaaaaaaaaaaaaaaaaaaaaaaa", title: "Third" },
    { ...baseMemory, memoryId: "mem_candidate_bbbbbbbbbbbbbbbbbbbbbbbb", title: "Fourth" }
  ];

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, memories);

  const names = readdirSync(fixture.memoryDir)
    .filter(name => name.startsWith("spinal-plug-managed-"))
    .map(name => /^name: (.+)$/m.exec(readFileSync(join(fixture.memoryDir, name), "utf8"))?.[1]);
  assert.equal(names.length, memories.length);
  assert.equal(new Set(names).size, memories.length, "each managed file must declare its own name");
});

test("no record field can break out of the frontmatter block", t => {
  const fixture = createFixture(t);
  // Every one of these reaches YAML, and a record can be minted on another
  // device: the id and kind are interpolated into `name`, and kind and
  // updatedAt are values of their own keys.
  const hostile = [
    { ...baseMemory, memoryId: 'mem_a"\ninjected: id\n', title: "Hostile id" },
    { ...baseMemory, memoryId: "mem_b", kind: "decision\ninjected: kind\nfoo: bar", title: "Hostile kind" },
    { ...baseMemory, memoryId: "mem_c", updatedAt: "2026-07-30\ninjected: modified", title: "Hostile timestamp" }
  ];

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, hostile);

  const files = readdirSync(fixture.memoryDir).filter(name => name.startsWith("spinal-plug-managed-"));
  assert.equal(files.length, hostile.length);
  for (const file of files) {
    const content = readFileSync(join(fixture.memoryDir, file), "utf8");
    const frontmatter = content.slice(0, content.indexOf("\n---", 4));
    assert.doesNotMatch(frontmatter, /\n *injected:/, `${file} must not gain a key from record content`);
    assert.doesNotMatch(frontmatter, /\n *foo:/, `${file} must not gain a key from record content`);
  }
});

test("distinct ids that sanitize alike still get distinct managed files", t => {
  const fixture = createFixture(t);
  const first = { ...baseMemory, memoryId: "mem.a", title: "First" };
  const second = { ...baseMemory, memoryId: "mem/a", title: "Second" };

  new ClaudeAutoMemoryMaterializer({ homeDirectory: fixture.home }).materialize(fixture.project, [first, second]);

  const managed = readdirSync(fixture.memoryDir).filter(name => name.startsWith("spinal-plug-managed-"));
  assert.equal(managed.length, 2, "colliding sanitized ids must not overwrite each other");
  const contents = managed.map(name => readFileSync(join(fixture.memoryDir, name), "utf8")).join("\n");
  assert.match(contents, /# First/);
  assert.match(contents, /# Second/);
});

test("a secret in a topic title skips that file instead of failing the import", t => {
  // Regression: the filter read only the body, so a secret in frontmatter `name`
  // reached `remember`, which refused it — aborting the whole import over one
  // file rather than skipping it.
  const fixture = createFixture(t);
  writeFileSync(
    join(fixture.memoryDir, "poisoned.md"),
    "---\nname: AKIAIOSFODNN7EXAMPLE\n---\n\nThe deploy pipeline runs nightly.\n",
    "utf8"
  );
  writeFileSync(join(fixture.memoryDir, "clean.md"), "# Retention\n\nLogs are kept for 30 days.\n", "utf8");

  const result = new ClaudeAutoMemoryImporter({ homeDirectory: fixture.home }).import(space, fixture.project);

  assert.equal(result.skippedSecretFiles, 1);
  assert.deepEqual(result.candidates.map(candidate => candidate.title), ["Retention"]);
});
