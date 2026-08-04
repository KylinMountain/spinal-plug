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
/**
 * The tag is the version. `release.yml` passes it in; nothing in the repository
 * records it, because npm reads the version from the tarball and both plugin
 * hosts version a plugin by the commit they fetched. A local build with no tag
 * gets the placeholder in the CLI manifest, which says plainly that it is not a
 * release.
 */
const releaseVersion = (process.env.SPINAL_PLUG_RELEASE_VERSION ?? process.argv[2] ?? "")
  .trim()
  .replace(/^v/, "") || cliManifest.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
  console.error(`Not a semver version: ${releaseVersion}`);
  process.exit(1);
}
const entryPoint = resolve(repositoryRoot, "packages/cli/dist/index.js");
const outputDirectory = resolve(repositoryRoot, "release/npm");
const bundleName = "spinal-plug.mjs";
const PUBLISHED_NAME = "spinal-plug";

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
  // Published as `spinal-plug`, not as the workspace package name: what a user
  // installs should be what a user types, and the binary is `spinal-plug`. The
  // workspace keeps `@spinal-plug/cli` because that name is a dependency of the
  // private server repository, which resolves it over `link:`.
  name: PUBLISHED_NAME,
  version: releaseVersion,
  description: "Spinal Plug client: durable, project-scoped agent memory with local-first storage and selective sync.",
  type: "module",
  // No "./" prefix: npm normalizes it away and warns that the bin script name
  // "was cleaned", which means the manifest published is not the one written.
  bin: { "spinal-plug": bundleName },
  files: [bundleName],
  // Only the Node floor is a consumer constraint; the pnpm floor is a
  // development one and engine-strict installs would enforce it on users.
  // Resolve the field, not the object: an `engines` block on the CLI manifest
  // that omits `node` would otherwise drop the floor from the published package
  // and let the install succeed on a Node without `node:sqlite`.
  engines: { node: cliManifest.engines?.node ?? rootManifest.engines.node },
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
