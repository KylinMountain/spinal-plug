import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const controlPlane = argumentsList.includes("--control-plane");
const portFlag = argumentsList.indexOf("--port");
const port = portFlag === -1 ? 8787 : Number(argumentsList[portFlag + 1]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Use --port with an integer between 1 and 65535.");
}
if (controlPlane && !process.env.SPINAL_PLUG_BOOTSTRAP_TOKEN) {
  throw new Error("SPINAL_PLUG_BOOTSTRAP_TOKEN is required with --control-plane.");
}

const cliEntry = resolve(repositoryRoot, "packages/cli/dist/index.js");
if (!existsSync(cliEntry)) {
  throw new Error("CLI build output is missing. Run pnpm build before starting a server.");
}

const stateDirectory = resolve(homedir(), ".spinal-plug");
mkdirSync(stateDirectory, { recursive: true });
const databasePath = resolve(stateDirectory, controlPlane ? "control-plane.db" : "sync-server.db");
const command = controlPlane ? "serve-control-plane" : "serve";

console.log(`Starting ${command} on http://127.0.0.1:${port}`);
console.log(`Using device-local database ${databasePath}`);

const child = spawn(process.execPath, [cliEntry, command, databasePath, String(port)], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", code => {
  process.exitCode = code ?? 1;
});
