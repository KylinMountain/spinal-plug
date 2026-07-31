---
name: spinal-plug
description: Use Spinal Plug to lock, boot, connect, share, synchronize, or inspect durable project memory in Codex. Trigger when the user asks to upload shared memory, download/sync memory, inspect memory status, connect a project, or continue a project on another device.
---

# SPINAL-PLUG // Codex Neural Memory

Spinal Plug provides the same project-memory lifecycle in Codex as in Claude Code. Its presentation is a fictional neural-link interface only; it does not claim biological control or model-state copying.
After a Project Space is connected, its plugin Hooks run automatically:

- `SessionStart`: load the local stable project projection and refresh Codex's reserved native-memory record.
- `UserPromptSubmit`: inject a bounded, query-relevant recall projection.
- `Stop`: conservatively extract at most three durable **candidate** memories and persist only those candidates with a source digest. They remain local until the user confirms promotion; it never stores or uploads the raw turn.
- `PreCompact` / `SessionEnd`: retain local durability; the WAL/outbox makes later retry safe.

Candidates are not active memory. They remain reviewable until explicitly promoted or accepted by a policy with sufficient evidence.

| User intent | Spinal Plug action |
| --- | --- |
| `boot` / "加载记忆" | Show the current project Memory Core Boot Sequence. |
| `connect` / "连接项目" | Bind the current directory to a Project Space or archive. |
| `share` / "共享记忆" / "上传记忆" | 手动补充或审核当前会话中值得长期保留的项目经验。正常会话会在结束时自动生成候选。 |
| `sync` / "同步记忆" / "下载记忆" | Pull central memory and write it into Codex's reserved native-memory record. |
| `status` / "记忆状态" | Show linked Space, local memory, and pending synchronization. |
| "查看候选记忆" / "确认候选" | 审查自动提取候选，只有用户明确同意时才晋升为 active memory。 |
| "交接工作" / "保存进度" / "让另一个 Agent 继续" | 创建 Project Handoff，不把临时工作状态写成长期记忆。 |

The local cache is an implementation detail. Never tell the user to upload a database file. Do not edit Codex SQLite files directly: `project codex` owns only the reserved `spinal-plug:<space-id>` record and never overwrites normal Codex session memory.

Every command below inlines its own default for the local cache: each shell command runs in a fresh process, so an `export` from an earlier one would be gone and the path would expand to nothing. Do not replace those expansions with a bare variable.

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

## Boot

For `boot` or "加载记忆", run:

```bash
spinal-plug boot "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .
```

Report the short boot sequence. `Mind Capsule` currently means a project-scope context projection, not model weights or hidden state.

## Connect

Only when the user explicitly asks to connect, create, archive, or choose a project memory space, run:

```bash
spinal-plug connect "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .
```

For a Git project, this uses the repository name as the suggested Project Space. For a non-Git folder, it keeps a stable directory binding and creates an archive named after the folder. Report the selected name and type, not implementation paths.

## Share

For `share`, "共享记忆", or "上传当前项目记忆", first inspect the current session and retain at most three facts that will remain useful after the session:

- `directive`: a persistent instruction about how work should be done.
- `decision`: a technical or product choice and its reason.
- `context`: background or constraints that cannot be cheaply re-read from the repository.
- `reference`: a pointer to an external source of truth.

Never retain raw transcripts, temporary task progress, secrets, access tokens, or code facts that must be re-verified.

Before sharing, run `spinal-plug keys "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .` and classify each fact against the registry: reuse an existing key with `--key <semantic-key>` when one fits (the deterministic compiler merges and disputes by key), and only mint a new kebab-case key (optional `namespace:` prefix) when nothing does. Free-form key naming diverges across hosts; classification keeps cross-device memory coherent.

If `spinal-plug status "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .` shows `activeMemories: 0` and `candidateMemories: 0`, the memory chamber is empty: do not stop at "nothing to share" — generate the project's first memories from the current session using the same four kinds and quality bar, then share them. A Stop hook may also inject a `<spinal-plug_memory_nudge>` systemMessage in this state; follow it by staging generated facts with `spinal-plug remember "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . <kind> --candidate "<statement>"` (reviewable candidates, never active memory), then tell the user they await review.

If no durable learning exists even after review, say so and do not write memory. Otherwise publish each concise fact:

```bash
spinal-plug share "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . <kind> --url "$SPINAL_PLUG_SYNC_URL" "<durable statement>"
```

With `SPINAL_PLUG_SYNC_URL` unset the share is recorded locally only — that is the default, not an error. Then update Codex's native memory projection (purely local, no network):

```bash
spinal-plug project "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . codex
```

Report what was shared and why it is durable. The selection step is internal behavior of **共享记忆**, not a separate user-facing command.

## Sync

For `sync`, "同步记忆", or "下载记忆", run one turn of the whole loop — publish what is queued, fetch, preview, apply, and refresh Codex's native memory projection:

```bash
spinal-plug sync "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . --host codex
```

With no endpoint configured this targets the local development server at 127.0.0.1:8787, and when nothing answers there the command reports `"sync": "local-fallback"` and succeeds: that is the expected outcome in local mode, not a fault to report as one. Do not retry it, and do not offer to start an endpoint; running one is a deployment decision. A failure against an endpoint the user configured explicitly does surface, and means what it says.

Summarize what the result reports: `publish`/`published` for what left this device, `fetch`/`arrived`/`applied` for what came back, each update by kind, source and status. `sync: "partial"` means one direction worked and the other did not — say which, and `fetchError` says why. `outboxDrained: false` means a backlog remains: run it again. Do not ask the user for confirmation or selection. Required tombstones are applied during the fetch.

After applying updates, immediately retrieve the latest work handoff by running:

```bash
spinal-plug handoff "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . --latest || true
```

If the handoff command returns a JSON object containing a handoff, present its contents (completed work, open tasks, blockers, and next action) to the user as the current active task context for this session. The next Codex session reads the refreshed native memory projection.

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

When the user asks to hand off ongoing work, create a handoff with completed work, decisions, open tasks, blockers, next action, and artifact references. Do not place temporary progress into durable memory, and store a reference instead of any secret value.

Only the latest handoff reaches a boot context, so read it first and carry forward what is still open:

```bash
spinal-plug handoff "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . --latest
```

Keep its unresolved `openTasks` and `blockers`, drop what this session finished, and add what this session opened; a still-open task that is dropped disappears from every future boot. `--list` shows the full chain.

Include `title` plus a one-line `summary` — the boot context prints it directly under the title. Omit a field with no content rather than filling it with a placeholder like `"none"`, which is stored verbatim and reappears as a real blocker. Prefix artifact references with their type (`branch:`, `commit:`, `file:`, `space:`). Pass the JSON through a quoted heredoc, not an inline single-quoted string, so an apostrophe in the content cannot break the argument:

```bash
spinal-plug handoff "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" . "$(cat <<'JSON'
{"title":"…","summary":"…","completed":["…"],"openTasks":["…"],"nextAction":"…","artifactRefs":["branch:…"]}
JSON
)"
```

Use concise project facts. Confirm what will be handed off. An approved handoff is published on the next Stop lifecycle boundary; another linked Agent receives the latest handoff in its next boot context after synchronization.

## Status

For `status` or "记忆状态", run:

```bash
spinal-plug status "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}" .
```

Report the Space type and name, durable-memory count, and pending shared events. If unlinked, offer: create an archive, use General, link an existing archive, or remain unlinked.
