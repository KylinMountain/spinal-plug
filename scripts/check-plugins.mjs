/**
 * Plugin release guard.
 *
 * Both hosts cache a plugin under its version string — Claude Code in
 * `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, Codex in
 * `~/.codex/plugins/cache/...` — so an unchanged version means the host keeps
 * serving the copy it already has however much this directory moved. That
 * happened: eleven commits of hook fixes, a new command and a rewritten handoff
 * prompt were invisible to both hosts until someone noticed by hand.
 *
 * A digest recorded beside each version turns that into a failed check. Run
 * `pnpm stamp:plugins` after bumping a version to re-record it; the stamp refuses
 * to record new content under a version that did not change.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const digestFile = resolve(repositoryRoot, "plugins/digests.json");
const write = process.argv.includes("--write");

const PLUGINS = [
  {
    directory: "plugins/spinal-plug-claude",
    manifest: "plugins/spinal-plug-claude/.claude-plugin/plugin.json",
    /** Claude reads the version from the enclosing marketplace entry as well. */
    marketplace: { file: ".claude-plugin/marketplace.json", entry: "spinal-plug" }
  },
  {
    directory: "plugins/spinal-plug-codex",
    manifest: "plugins/spinal-plug-codex/.codex-plugin/plugin.json",
    marketplace: null
  }
];

const failures = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
}

/** Content digest over every committed file in the plugin, path included so a rename counts. */
function digestOf(directory) {
  const files = [];
  const walk = current => {
    for (const entry of readdirSync(resolve(repositoryRoot, current), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // Finder droppings are not part of the plugin and are gitignored.
      if (entry.name === ".DS_Store") continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else files.push(child);
    }
  };
  walk(directory);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(directory, file).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(resolve(repositoryRoot, file)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex").slice(0, 32)}`;
}

/** Build metadata (`+codex.<stamp>`) identifies a packaging run, not a different release. */
function baseVersion(version) {
  return version.split("+", 1)[0];
}

const recorded = existsSync(digestFile) ? JSON.parse(readFileSync(digestFile, "utf8")) : {};
const current = {};

for (const plugin of PLUGINS) {
  const manifest = readJson(plugin.manifest);
  const digest = digestOf(plugin.directory);
  current[plugin.directory] = { version: manifest.version, digest };

  if (plugin.marketplace) {
    const entry = readJson(plugin.marketplace.file).plugins
      .find(candidate => candidate.name === plugin.marketplace.entry);
    if (!entry) {
      failures.push(`${plugin.marketplace.file} has no entry named ${plugin.marketplace.entry}`);
    } else if (entry.version !== manifest.version) {
      failures.push(
        `${plugin.marketplace.file} says ${plugin.marketplace.entry}@${entry.version}, ${plugin.manifest} says ${manifest.version}`
      );
    }
  }

  const previous = recorded[plugin.directory];
  if (!previous) {
    if (!write) failures.push(`${plugin.directory} has no recorded digest; run pnpm stamp:plugins`);
    continue;
  }
  // A version that moves without its content is fine and often required: the two
  // plugins share one version, so a change to either moves both.
  if (previous.digest === digest) continue;
  // Content moved. The version has to move with it, or every host keeps serving
  // the copy it cached under the old one.
  if (previous.version === manifest.version) {
    failures.push(
      `${plugin.directory} content changed but version is still ${manifest.version}; bump it, then run pnpm stamp:plugins`
    );
  } else if (!write) {
    failures.push(`${plugin.directory} is at ${manifest.version} with unrecorded content; run pnpm stamp:plugins`);
  }
}

const versions = new Set(PLUGINS.map(plugin => baseVersion(current[plugin.directory].version)));
if (versions.size > 1) {
  failures.push(`the plugins must share one version; found ${[...versions].sort().join(", ")}`);
}

if (failures.length > 0) {
  console.error("Plugin release check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (write) {
  writeFileSync(digestFile, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Stamped ${PLUGINS.length} plugins at version ${[...versions][0]}.`);
} else {
  console.log(`Plugin release check passed for ${PLUGINS.length} plugins at version ${[...versions][0]}.`);
}
