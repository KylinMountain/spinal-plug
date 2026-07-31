/**
 * Build the publishable client: one dependency-free file plus a generated
 * manifest under `release/npm/`.
 *
 * The workspace manifests keep `@spinal-plug/*` in `dependencies` — the
 * architecture check reads them there, and those packages are not published on
 * their own. Bundling resolves them at build time, so the published package
 * declares no runtime dependencies and a generated manifest is what ships.
 */
import { build } from "esbuild";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliManifestPath = resolve(repositoryRoot, "packages/cli/package.json");
const cliManifest = JSON.parse(readFileSync(cliManifestPath, "utf8"));
const entryPoint = resolve(repositoryRoot, "packages/cli/dist/index.js");
const outputDirectory = resolve(repositoryRoot, "release/npm");
const bundleName = "spinal-plug.mjs";

if (!existsSync(entryPoint)) {
  console.error(`Missing ${entryPoint}. Run pnpm build first.`);
  process.exit(1);
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const outputFile = resolve(outputDirectory, bundleName);
await build({
  entryPoints: [entryPoint],
  outfile: outputFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // The compiled entry keeps its own shebang, and a second one further down the
  // file would be a syntax error rather than a comment.
  banner: { js: "" },
  legalComments: "inline",
  logLevel: "warning"
});
chmodSync(outputFile, 0o755);

const bundle = readFileSync(outputFile, "utf8");
if (!bundle.startsWith("#!")) {
  writeFileSync(outputFile, `#!/usr/bin/env node\n${bundle}`);
  chmodSync(outputFile, 0o755);
}
if (/from\s*["']@spinal-plug\//.test(bundle)) {
  console.error("The bundle still imports a workspace package; the published package would not install.");
  process.exit(1);
}

const rootManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
const publishManifest = {
  name: cliManifest.name,
  version: cliManifest.version,
  description: "Spinal Plug client: durable, project-scoped agent memory with local-first storage and selective sync.",
  type: "module",
  bin: { "spinal-plug": `./${bundleName}` },
  files: [bundleName],
  // Only the Node floor is a consumer constraint; the pnpm floor is a
  // development one and engine-strict installs would enforce it on users.
  engines: { node: (cliManifest.engines ?? rootManifest.engines).node },
  keywords: ["agent", "memory", "claude-code", "codex", "skill", "mcp"],
  repository: { type: "git", url: "git+https://github.com/KylinMountain/spinal-plug.git" },
  homepage: "https://github.com/KylinMountain/spinal-plug#readme",
  ...(rootManifest.license ? { license: rootManifest.license } : {})
};
writeFileSync(resolve(outputDirectory, "package.json"), `${JSON.stringify(publishManifest, null, 2)}\n`);
copyFileSync(resolve(repositoryRoot, "README.en.md"), resolve(outputDirectory, "README.md"));
if (existsSync(resolve(repositoryRoot, "LICENSE"))) {
  copyFileSync(resolve(repositoryRoot, "LICENSE"), resolve(outputDirectory, "LICENSE"));
} else {
  console.warn("No LICENSE at the repository root: the published package will carry no license.");
}

const kilobytes = Math.round(Buffer.byteLength(readFileSync(outputFile)) / 1024);
console.log(`Built ${publishManifest.name}@${publishManifest.version} → release/npm/${bundleName} (${kilobytes} kB, no runtime dependencies).`);
