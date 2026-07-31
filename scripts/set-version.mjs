/**
 * Writes one version into every manifest that carries it.
 *
 * A tag is the version. Nobody edits these files by hand and no pull request
 * exists to bump them: `release.yml` derives the version from the pushed tag,
 * runs this, and commits the result back. The files therefore record the last
 * released version rather than declaring the next one.
 *
 *   node scripts/set-version.mjs 0.2.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2]?.trim().replace(/^v/, "");

// Semver, optionally with a prerelease. Build metadata is refused rather than
// silently kept: two artifacts must not differ only by a field semver ignores.
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Usage: node scripts/set-version.mjs <version>   (got ${process.argv[2] ?? "nothing"})`);
  process.exit(1);
}

/** Every place the version is written, and how to reach it. */
const TARGETS = [
  { file: "packages/cli/package.json", set: manifest => { manifest.version = version; } },
  { file: "plugins/spinal-plug-claude/.claude-plugin/plugin.json", set: manifest => { manifest.version = version; } },
  { file: "plugins/spinal-plug-codex/.codex-plugin/plugin.json", set: manifest => { manifest.version = version; } },
  {
    file: ".claude-plugin/marketplace.json",
    set: manifest => {
      const entry = manifest.plugins.find(candidate => candidate.name === "spinal-plug");
      if (!entry) throw new Error("no marketplace entry named spinal-plug");
      entry.version = version;
    }
  }
];

for (const target of TARGETS) {
  const path = resolve(repositoryRoot, target.file);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  target.set(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  ${target.file} → ${version}`);
}
console.log(`Set ${TARGETS.length} manifests to ${version}.`);
