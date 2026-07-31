/**
 * Version consistency across everything a release publishes.
 *
 * A tag is the version: `release.yml` derives it from the pushed tag, writes it
 * into every manifest with `scripts/set-version.mjs`, and commits the result. So
 * these files always agree with each other, and this check is what notices when
 * they stop — a hand-edit, a partial stamp, a merge that took one side.
 *
 * They must agree because they are not independently usable. A plugin's skills
 * invoke CLI commands, so a plugin newer than the CLI a user installed calls
 * commands that do not exist: `sync` under a client that never had it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
}

const SOURCES = [
  { label: "packages/cli/package.json", version: () => readJson("packages/cli/package.json").version },
  {
    label: "plugins/spinal-plug-claude/.claude-plugin/plugin.json",
    version: () => readJson("plugins/spinal-plug-claude/.claude-plugin/plugin.json").version
  },
  {
    label: "plugins/spinal-plug-codex/.codex-plugin/plugin.json",
    version: () => readJson("plugins/spinal-plug-codex/.codex-plugin/plugin.json").version
  },
  {
    label: ".claude-plugin/marketplace.json (spinal-plug entry)",
    version: () => {
      const entry = readJson(".claude-plugin/marketplace.json").plugins
        .find(candidate => candidate.name === "spinal-plug");
      if (!entry) throw new Error("no marketplace entry named spinal-plug");
      return entry.version;
    }
  }
];

const found = new Map();
for (const source of SOURCES) {
  try {
    found.set(source.label, source.version());
  } catch (error) {
    failures.push(`${source.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const versions = new Set(found.values());
if (versions.size > 1) {
  failures.push("the CLI and both plugins must carry one version:");
  for (const [label, version] of found) failures.push(`    ${version}  ${label}`);
}

const [version] = versions;
// Build metadata is refused: semver ignores it for precedence, so two releases
// differing only there are indistinguishable to every consumer while looking
// different in a host cache directory keyed by the string.
if (version !== undefined && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  failures.push(`${version} is not a plain semver version; run pnpm set-version <version>`);
}

if (failures.length > 0) {
  console.error("Release version check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Release version check passed: CLI, both plugins and the marketplace entry are at ${version}.`);
}
