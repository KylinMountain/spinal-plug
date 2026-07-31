---
name: spinal-plug
description: Use Spinal Plug to lock, boot, connect, share, synchronize, or inspect durable project memory from any agent that can run shell commands. Trigger when the user asks to load project memory, upload shared memory, download/sync memory, inspect memory status, connect a project, or continue a project on another device.
---

# SPINAL-PLUG // Generic Neural Memory

Spinal Plug provides the same project-memory lifecycle here as in Claude Code and Codex. Its presentation is a fictional neural-link interface only; it does not claim biological control or model-state copying.

This host has no lifecycle hooks and no native memory projection. Everything flows through the CLI, and memory enters the conversation through command output: `boot` output **is** the memory injection. Consequences:

- At the start of work on a connected project — or whenever this skill triggers and no boot has happened in the session — run `boot` first so the durable memory is in context.
- Durable candidates are not extracted automatically at session end. When a session produced durable learnings, offer `share` before the work wraps up.
- After `sync` applies updates, run `boot` again: with no native projection to refresh, re-booting is how the newly applied memory reaches the current context.

Candidates are not active memory. They remain reviewable until explicitly promoted or accepted by a policy with sufficient evidence.

| User intent | Spinal Plug action |
| --- | --- |
| `boot` / "加载记忆" | Show the current project Memory Core Boot Sequence. |
| `connect` / "连接项目" | Bind the current directory to a Project Space or archive. |
| `share` / "共享记忆" / "上传记忆" | 提取或审核当前会话中值得长期保留的项目经验并发布。 |
| `sync` / "同步记忆" / "下载记忆" | Pull central memory, apply it, and re-boot it into context. |
| `status` / "记忆状态" | Show linked Space, local memory, and pending synchronization. |
| "查看候选记忆" / "确认候选" | 审查候选记忆，只有用户明确同意时才晋升为 active memory。 |
| "交接工作" / "保存进度" / "让另一个 Agent 继续" | 创建 Project Handoff，不把临时工作状态写成长期记忆。 |

The local cache is an implementation detail. Never tell the user to upload a database file. Do not write into another host's memory storage from here: native projections belong to that host's own adapter.

Every command below inlines its own default for the local cache, because most hosts run each shell command in a fresh process: an `export` from an earlier command would be gone, and the path would expand to nothing. Do not replace those expansions with a bare variable.

```bash
# The local cache, as each command below spells it. An environment that sets
# SPINAL_PLUG_DB_PATH wins; otherwise this is the path.
# "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}"
# Never set SPINAL_PLUG_DEVICE_ID yourself. The CLI reads this device's
# credential from ~/.spinal-plug/device.env, and a hand-written id overrides it
# with an identity an authenticated endpoint will reject.
# Optional. Unset means: try the local sync server at 127.0.0.1:8787, and if
# nothing answers there, silently stay in local mode — no authentication,
# everything works and is testable offline.
# export SPINAL_PLUG_SYNC_URL="http://127.0.0.1:8787"
```

The client must be reachable as `spinal-plug` on `PATH`. Check once per session, before the first command:

```bash
command -v "${SPINAL_PLUG_BIN:-spinal-plug}" >/dev/null || echo "spinal-plug is not installed"
```

If the host set `SPINAL_PLUG_BIN`, use that value everywhere this skill writes `spinal-plug`. If nothing is found, report that the client is not installed and stop — the fix is installing it, not guessing a path into a checkout. Every command below is safe to run repeatedly; none of them touch the project directory.

## Boot

For `boot`, "加载记忆", or at the start of work on a connected project, run:

```bash
spinal-plug boot "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .
```

Report the short boot sequence and treat its contents — including any ACTIVE PROJECT HANDOFF block — as active context for this session. `Mind Capsule` currently means a project-scope context projection, not model weights or hidden state.

If the output contains `PROJECT MEMORY CHAMBER IS UNLINKED`, this directory has no Project Space yet. Nothing on this host binds one automatically, so present the four choices from the Connect section and wait for the user to pick one. Do not connect unasked, and do not repeat the offer later in the same session if the user declined.

## Connect

Bind a directory only after the user chooses one of four answers. There is no hook-driven discovery here, so ask explicitly:

```bash
# The suggested default: a Git repository becomes a Project Space named after
# the repository; a non-Git folder becomes an archive named after the folder.
spinal-plug connect "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .

# Or one of the explicit modes.
spinal-plug connect "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . general
spinal-plug connect "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . archive "<archive name>"
spinal-plug connect "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . link <space-id> "<name>"
```

"Remain unlinked" is a valid fourth answer: run nothing and continue without project memory. The binding is remembered under `~/.spinal-plug/projects/`, device-local; the project directory is never written to. Report the selected name and type, not implementation paths.

## Share

For `share`, "共享记忆", or "上传当前项目记忆", first inspect the current session and retain at most three facts that will remain useful after the session:

- `directive`: a persistent instruction about how work should be done.
- `decision`: a technical or product choice and its reason.
- `context`: background or constraints that cannot be cheaply re-read from the repository.
- `reference`: a pointer to an external source of truth.

Never retain raw transcripts, temporary task progress, secrets, access tokens, or code facts that must be re-verified.

Before sharing, run `spinal-plug keys "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .` and classify each fact against the registry: reuse an existing key with `--key <semantic-key>` when one fits (the deterministic compiler merges and disputes by key), and only mint a new kebab-case key (optional `namespace:` prefix) when nothing does. Free-form key naming diverges across hosts; classification keeps cross-device memory coherent.

If `spinal-plug status "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .` shows `activeMemories: 0` and `candidateMemories: 0`, the memory chamber is empty: do not stop at "nothing to share" — generate the project's first memories from the current session using the same four kinds and quality bar. Stage uncertain facts with `spinal-plug remember "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . <kind> --candidate "<statement>"` (reviewable candidates, never active memory), then tell the user they await review.

If no durable learning exists even after review, say so and do not write memory. Otherwise publish each concise fact:

```bash
spinal-plug share "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . <kind> --url "$SPINAL_PLUG_SYNC_URL" "<durable statement>"
```

With `SPINAL_PLUG_SYNC_URL` unset the share is recorded locally only — that is the default, not an error. Report what was shared and why it is durable. The selection step is internal behavior of **共享记忆**, not a separate user-facing command.

## Sync

For `sync`, "同步记忆", or "下载记忆", run one turn of the whole loop. It publishes whatever is queued locally, fetches, previews and applies — no `--host` here, since this host has no native projection to refresh:

```bash
spinal-plug sync "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .
```

With no endpoint configured this targets the local development server at 127.0.0.1:8787, and when nothing answers there the command reports `"sync": "local-fallback"` and succeeds: that is the expected outcome in local mode, not a fault to report as one. Do not retry it, and do not offer to start an endpoint; running one is a deployment decision. An endpoint the user configured explicitly is different — a failure there surfaces, and it means what it says.

Summarize what the result reports: `publish`/`published` for what left this device, `fetch`/`arrived`/`applied` for what came back, each update by kind, source and status. `sync: "partial"` means one direction worked and the other did not — say which, and `fetchError` says why. `outboxDrained: false` means a backlog remains: run it again. Do not ask the user for confirmation or selection. Required tombstones are applied during the fetch.

After applying updates, immediately retrieve the latest work handoff by running:

```bash
spinal-plug handoff "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . --latest || true
```

If the handoff command returns a JSON object containing a handoff, present its contents (completed work, open tasks, blockers, and next action) to the user as the current active task context for this session. Then run `spinal-plug boot "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .` so the applied memory is loaded into the current context.

## Review candidates

For "查看候选记忆", run:

```bash
spinal-plug list "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . --candidates
```

Show concise statements and source provenance. Do not promote automatically. If the user explicitly accepts a candidate, run:

```bash
spinal-plug promote "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . <memory-id>
```

## Project handoff

A handoff is work state — what is done, what is left, what to do next — and never durable memory. Do not paste credentials into one: the CLI refuses to store material that looks like a secret, so store a reference instead of the value.

Only the **latest** handoff reaches a boot context. A new one therefore replaces the previous one there, so read it first and carry forward what is still open:

```bash
spinal-plug handoff "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . --latest
```

Keep its unresolved `openTasks` and `blockers`, drop what this session finished, and add what this session opened. Dropping a task that is still open removes it from every future boot. The parent link is recorded automatically; `--list` shows the full chain when the history matters.

Then write the JSON:

- `title` — one line naming the work.
- `summary` — one line of orientation. The boot context prints it directly under the title; omitting it wastes that slot.
- `completed`, `decisions`, `openTasks`, `blockers`, `artifactRefs` — arrays of concise, self-contained statements.
- `nextAction` — the single next step for whoever continues.

Omit a field that has no content. Never fill one with a placeholder like `"none"` or `"无"`: it is stored verbatim and reappears as a real blocker in every future boot. Prefix each artifact reference with its type — `branch:`, `commit:`, `file:`, `space:` — so another agent can resolve it.

Pass the JSON through a quoted heredoc. Do not inline it in single quotes: one apostrophe in the content, as in `the agent's context`, breaks the argument and can swallow the rest of the command line.

```bash
spinal-plug handoff "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . "$(cat <<'JSON'
{"title":"…","summary":"…","completed":["…"],"openTasks":["…"],"nextAction":"…","artifactRefs":["branch:…"]}
JSON
)"
```

Confirm what was handed off. A handoff is work-state context, never durable memory, but it still has to reach the shared endpoint before another device can fetch it: the command reports `pendingOutboxEvents`, meaning the handoff is durable here and queued. Nothing publishes on its own here — `sync` is what sends the queue, so run it when the user expects another device to pick the work up. In local mode there is no endpoint at all, so say plainly that the handoff stays on this device rather than implying it already travelled.

## Status

For `status` or "记忆状态", run:

```bash
spinal-plug status "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .
```

Report the Space type and name, durable-memory count, and pending shared events. If unlinked, offer: create an archive, use General, link an existing archive, or remain unlinked.
