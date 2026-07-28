import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = ["AGENTS.md", "ARCHITECTURE.md", "README.md", "README.en.md"];
const failures = [];

for (const requiredFile of requiredFiles) {
  if (!existsSync(resolve(repositoryRoot, requiredFile))) {
    failures.push(`Missing required repository entry point: ${requiredFile}`);
  }
}

const agentsPath = resolve(repositoryRoot, "AGENTS.md");
if (existsSync(agentsPath)) {
  const agents = readFileSync(agentsPath, "utf8");
  if (!agents.includes("ARCHITECTURE.md")) {
    failures.push("AGENTS.md must point to ARCHITECTURE.md");
  }
}

const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
for (const fileName of requiredFiles) {
  const filePath = resolve(repositoryRoot, fileName);
  if (!existsSync(filePath)) continue;
  const source = readFileSync(filePath, "utf8");
  for (const match of source.matchAll(markdownLink)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, "");
    if (!rawTarget || rawTarget.startsWith("#") || /^(https?:|mailto:|data:)/i.test(rawTarget)) continue;
    const target = rawTarget.split(/[?#]/, 1)[0];
    if (!target || existsSync(resolve(dirname(filePath), target))) continue;
    failures.push(`${relative(repositoryRoot, filePath)} links to missing ${target}`);
  }
}

if (failures.length > 0) {
  console.error("Repository harness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Repository harness check passed for ${requiredFiles.length} entry points.`);
}
