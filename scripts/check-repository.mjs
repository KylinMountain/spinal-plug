import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "AGENTS.md",
  "ARCHITECTURE.md",
  "README.md",
  "README.en.md",
  "skills/README.md",
  "skills/spinal-plug/SKILL.md"
];
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

// Skills are instructions an agent executes verbatim, so a stale command name
// or a missing frontmatter field fails at the user's terminal, not in CI. These
// checks are the only mechanical guard they have.
const hostAgnosticSkill = "skills/spinal-plug/SKILL.md";
const cliSource = resolve(repositoryRoot, "packages/cli/src/index.ts");
const cliCommands = new Set(["--help", "-h"]);
if (existsSync(cliSource)) {
  const source = readFileSync(cliSource, "utf8");
  for (const match of source.matchAll(/command === "([a-z-]+)"/g)) cliCommands.add(match[1]);
} else {
  failures.push("Missing packages/cli/src/index.ts; skill commands cannot be validated");
}

function findSkillFiles(directory) {
  const absolute = resolve(repositoryRoot, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) return findSkillFiles(child);
    return entry.name === "SKILL.md" ? [child] : [];
  });
}

// A host-agnostic skill that *runs* a hook-only surface tells hookless agents to
// do something their host cannot do. Prose may still explain why the flag is
// absent, so only executable blocks are checked.
const hostCoupledTokens = ["--host", "hook-stdin", "project "];
// A command is only claimed as such when a db-path argument follows it, so prose
// like "spinal-plug is not installed" is not mistaken for a verb.
const commandInvocation = /\bspinal-plug (?!--)([a-z-]+) (?:"\$SPINAL_PLUG_DB_PATH"|"\$HOME\/|<db-path>|\.{3})/g;

for (const skillFile of [...findSkillFiles("skills"), ...findSkillFiles("plugins")]) {
  const source = readFileSync(resolve(repositoryRoot, skillFile), "utf8");
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!frontmatter) {
    failures.push(`${skillFile} has no YAML frontmatter block`);
  } else {
    for (const field of ["name", "description"]) {
      if (!new RegExp(`^${field}:\\s*\\S`, "m").test(frontmatter[1])) {
        failures.push(`${skillFile} frontmatter is missing ${field}`);
      }
    }
  }
  const codeBlocks = [...source.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(match => match[1]).join("\n");
  for (const match of source.matchAll(commandInvocation)) {
    if (!cliCommands.has(match[1])) {
      failures.push(`${skillFile} references unknown CLI command: spinal-plug ${match[1]}`);
    }
  }
  if (skillFile === hostAgnosticSkill) {
    for (const token of hostCoupledTokens) {
      if (codeBlocks.includes(token)) {
        failures.push(`${hostAgnosticSkill} must not depend on the host surface "${token}"`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Repository harness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Repository harness check passed for ${requiredFiles.length} entry points.`);
}
