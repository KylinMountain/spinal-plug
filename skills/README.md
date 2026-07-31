# Host-agnostic skill

`skills/spinal-plug/SKILL.md` is the Spinal Plug skill for **any** agent that can
load a skill file and run shell commands. It needs no plugin, no hook runtime,
and no native memory surface — Qoder, Gemini CLI, an in-house agent, or anything
else that meets those two conditions.

Codex and Claude Code should keep using `plugins/`: their plugins add lifecycle
hooks and a native memory projection that this skill cannot provide.

## 1. Install the client

The skill drives the `spinal-plug` CLI and never reaches into the database
itself, so the binary must be resolvable before the skill is useful. From a
tagged release, the client is a single dependency-free file on npm:

```bash
npm install -g @spinal-plug/cli
spinal-plug --help
```

From a checkout — the only option before the first tag, and what to use while
developing the client:

```bash
pnpm install
pnpm build
pnpm -C packages/cli link --global   # exposes `spinal-plug` on PATH
```

If you would rather not link globally, point the host at the built entry point
instead and the skill will use it:

```bash
export SPINAL_PLUG_BIN="$PWD/packages/cli/dist/index.js"
```

## 2. Install the skill

Copy or symlink the directory into whatever path your agent scans for skills.
A symlink keeps it current when this repository is updated:

```bash
ln -s "$PWD/skills/spinal-plug" ~/.your-agent/skills/spinal-plug
```

For an agent with no skill loader at all, paste the body of `SKILL.md` into the
place that agent reads persistent instructions from (`AGENTS.md`, a system
prompt, a custom-instructions field). The file is self-contained: it assumes
nothing beyond a shell and the CLI.

## 3. What is different without hooks

A hookless host has no lifecycle events and no memory surface to project into,
so three things move from the runtime into the agent's own behavior:

| Concern | Codex / Claude Code | Here |
| --- | --- | --- |
| Loading memory | `SessionStart` hook, plus a native projection the host reads on its own | `boot` output **is** the injection — run it at the start of work |
| Space binding | Hook offers the discovery choice on first session | `boot` reports `UNLINKED`; the agent offers the four `connect` answers |
| Durable candidates | `Stop` hook extracts up to three candidates | The agent offers `share` before the work wraps up |
| After `sync` | The refreshed native projection is read next session | Re-run `boot` — nothing else refreshes the context |

Everything else — semantic-key classification, candidate review, handoffs,
local-first sync — behaves identically, because it all lives in the CLI.

## 4. Verify the install

In a project directory, with the skill loaded:

```bash
spinal-plug status "$HOME/.spinal-plug/spinal-plug.db" .
spinal-plug boot "$HOME/.spinal-plug/spinal-plug.db" .
```

`status` prints the linked Space and memory counts; `boot` prints the boot
sequence, or the `UNLINKED` banner when this directory has no Space yet. Neither
command writes to the project directory: bindings live under
`~/.spinal-plug/projects/`.
