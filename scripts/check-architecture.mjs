import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = resolve(repositoryRoot, "packages");
const allowedDependencies = new Map([
  ["@spinal-plug/protocol", new Set()],
  ["@spinal-plug/adapter-sdk", new Set(["@spinal-plug/protocol"])],
  ["@spinal-plug/local-node", new Set(["@spinal-plug/protocol"])],
  ["@spinal-plug/adapter-claude-code", new Set(["@spinal-plug/protocol", "@spinal-plug/local-node", "@spinal-plug/adapter-sdk"])],
  ["@spinal-plug/adapter-codex", new Set(["@spinal-plug/protocol", "@spinal-plug/local-node", "@spinal-plug/adapter-sdk"])],
  ["@spinal-plug/mcp-server", new Set(["@spinal-plug/protocol", "@spinal-plug/local-node"])],
  [
    "@spinal-plug/cli",
    new Set([
      "@spinal-plug/protocol",
      "@spinal-plug/sync-server",
      "@spinal-plug/local-node",
      "@spinal-plug/adapter-sdk",
      "@spinal-plug/adapter-claude-code",
      "@spinal-plug/adapter-codex",
      "@spinal-plug/mcp-server"
    ])
  ]
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return extname(entry.name) === ".ts" ? [entryPath] : [];
  });
}

const failures = [];
const packageDirectories = readdirSync(packagesRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => resolve(packagesRoot, entry.name));

for (const packageDirectory of packageDirectories) {
  const manifestPath = resolve(packageDirectory, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const packageName = manifest.name;
  const allowed = allowedDependencies.get(packageName);
  if (!allowed) {
    failures.push(`No architecture policy exists for ${packageName}`);
    continue;
  }

  const declared = new Set(Object.keys(manifest.dependencies ?? {}).filter(name => name.startsWith("@spinal-plug/")));
  for (const dependency of declared) {
    if (!allowed.has(dependency)) {
      failures.push(`${packageName} declares forbidden dependency ${dependency}`);
    }
  }

  const sourceDirectory = resolve(packageDirectory, "src");
  const imported = new Map();
  const importPattern = /(?:from\s*|import\s*\()\s*["'](@spinal-plug\/[^"']+)["']/g;
  for (const sourceFile of sourceFiles(sourceDirectory)) {
    const source = readFileSync(sourceFile, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const dependency = match[1];
      if (!imported.has(dependency)) imported.set(dependency, []);
      imported.get(dependency).push(relative(repositoryRoot, sourceFile));
    }
  }

  for (const [dependency, importers] of imported) {
    if (!allowed.has(dependency)) {
      failures.push(`${packageName} imports forbidden dependency ${dependency} from ${importers.join(", ")}`);
    }
    if (!declared.has(dependency)) {
      failures.push(`${packageName} imports undeclared dependency ${dependency} from ${importers.join(", ")}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Architecture check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed for ${packageDirectories.length} workspace packages.`);
}
