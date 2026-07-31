/**
 * Keeps a version out of the plugin manifests.
 *
 * A tag is the version, and only npm needs one — it travels in the tarball the
 * release job builds. Both plugin hosts serve a plugin straight from this
 * repository and version it by the commit they fetched, so a number written here
 * buys nothing and costs something real: each host caches a plugin under its
 * version string, so a hardcoded version pins every host to the copy it first
 * cached, however much this directory moves afterwards. That is not theoretical —
 * eleven commits of hook fixes, a new command and a rewritten handoff prompt once
 * sat invisible behind an unchanged 0.2.0.
 *
 * Claude Code accepts a manifest with no version (262 of the 276 plugins in the
 * official marketplace omit it, and validation only warns); Codex installs one
 * too. Both were checked before this rule was written.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
}

const MANIFESTS = [
  "plugins/spinal-plug-claude/.claude-plugin/plugin.json",
  "plugins/spinal-plug-codex/.codex-plugin/plugin.json"
];

for (const file of MANIFESTS) {
  const version = readJson(file).version;
  if (version !== undefined) {
    failures.push(`${file} declares version ${version}; a plugin is versioned by its commit, so remove the field`);
  }
}

const marketplace = readJson(".claude-plugin/marketplace.json");
const entry = marketplace.plugins.find(candidate => candidate.name === "spinal-plug");
if (!entry) {
  failures.push(".claude-plugin/marketplace.json has no entry named spinal-plug");
} else if (entry.version !== undefined) {
  failures.push(
    `.claude-plugin/marketplace.json pins spinal-plug at ${entry.version}; the entry is served from this repository, so remove the field`
  );
}

// The CLI manifest keeps a version because npm requires one to build with. It is
// a placeholder: the release overrides it from the tag, and saying so out loud
// beats a stale real-looking number that nobody publishes.
const cliVersion = readJson("packages/cli/package.json").version;
if (!/-dev$/.test(cliVersion)) {
  failures.push(
    `packages/cli/package.json is at ${cliVersion}; it holds a placeholder like 0.0.0-dev because the tag supplies the real version`
  );
}

if (failures.length > 0) {
  console.error("Plugin version check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Plugin version check passed: ${MANIFESTS.length} manifests and the marketplace entry carry no version.`);
}
