import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const markdownFiles = execFileSync("git", ["ls-files", "*.md"], {
  cwd: repositoryRoot,
  encoding: "utf8"
})
  .split("\n")
  .filter(Boolean);

// Relative markdown links and images must resolve on disk. Anchors, absolute
// URLs, and data URIs are checked by readers, not by the filesystem.
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
for (const fileName of markdownFiles) {
  const filePath = resolve(repositoryRoot, fileName);
  const source = readFileSync(filePath, "utf8");
  for (const match of source.matchAll(markdownLink)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (!rawTarget || rawTarget.startsWith("#") || /^(https?:|mailto:|data:)/i.test(rawTarget)) continue;
    const target = rawTarget.split(/[?#]/, 1)[0];
    if (!target || existsSync(resolve(dirname(filePath), target))) continue;
    failures.push(`${fileName} links to missing ${target}`);
  }
}

// Backticked paths under the top-level directories agents cite by name. Only
// these prefixes are checked so prose like `some/package` is not misread as a
// reference. Placeholders and globs (`<path>`, `packages/*`) are skipped.
const pathReference = /`((?:packages|plugins|skills|scripts|apps|docs)\/[^`]+)`/g;
for (const fileName of markdownFiles) {
  const source = readFileSync(resolve(repositoryRoot, fileName), "utf8");
  for (const match of source.matchAll(pathReference)) {
    const target = match[1].trim();
    if (/[<>*]/.test(target)) continue;
    if (existsSync(resolve(repositoryRoot, target))) continue;
    failures.push(`${fileName} references missing path ${target}`);
  }
}

if (failures.length > 0) {
  console.error("Documentation check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed for ${markdownFiles.length} markdown files.`);
}
