---
name: mind-palace
description: Use Mind Palace to boot, connect, share, synchronize, or inspect durable project memory in Codex. Trigger when the user asks to upload shared memory, download/sync memory, inspect memory status, connect a project, or continue a project on another device.
---

# Mind Palace For Codex

Mind Palace provides the same project-memory lifecycle in Codex as in Claude Code:

| User intent | Mind Palace action |
| --- | --- |
| `boot` / "加载记忆" | Show the current project Memory Core Boot Sequence. |
| `connect` / "连接项目" | Bind the current directory to a Project Space or archive. |
| `share` / "共享记忆" / "上传记忆" | 筛选本次会话中值得长期保留的项目经验，上传后更新 Codex 原生记忆投影。 |
| `sync` / "同步记忆" / "下载记忆" | Pull central memory and write it into Codex's reserved native-memory record. |
| `status` / "记忆状态" | Show linked Space, local memory, and pending synchronization. |

The local cache is an implementation detail. Never tell the user to upload a database file. Do not edit Codex SQLite files directly: `sync-codex` owns only the reserved `mind-palace:<space-id>` record and never overwrites normal Codex session memory.

Use these defaults unless the environment overrides them:

```bash
export MIND_PALACE_DB="${MIND_PALACE_DB:-$HOME/.mind-palace/mind-palace.db}"
export MIND_PALACE_SYNC_URL="${MIND_PALACE_SYNC_URL:-http://127.0.0.1:8787}"
export MIND_PALACE_DEVICE_ID="${MIND_PALACE_DEVICE_ID:-device-local}"
```

## Boot

For `boot` or "加载记忆", run:

```bash
mind-palace boot "$MIND_PALACE_DB" .
```

Report the short boot sequence. `Mind Capsule` currently means a project-scope context projection, not model weights or hidden state.

## Connect

Only when the user explicitly asks to connect, create, archive, or choose a project memory space, run:

```bash
mind-palace connect "$MIND_PALACE_DB" .
```

For a Git project, this uses the repository name as the suggested Project Space. For a non-Git folder, it keeps a stable directory binding and creates an archive named after the folder. Report the selected name and type, not implementation paths.

## Share

For `share`, "共享记忆", or "上传当前项目记忆", first inspect the current session and retain at most three facts that will remain useful after the session:

- `directive`: a persistent instruction about how work should be done.
- `decision`: a technical or product choice and its reason.
- `context`: background or constraints that cannot be cheaply re-read from the repository.
- `reference`: a pointer to an external source of truth.

Never retain raw transcripts, temporary task progress, secrets, access tokens, or code facts that must be re-verified.

If no durable learning exists, say so and do not write memory. Otherwise publish each concise fact:

```bash
mind-palace share "$MIND_PALACE_DB" . <kind> "<durable statement>" "$MIND_PALACE_SYNC_URL" "$MIND_PALACE_DEVICE_ID"
```

Then update Codex's native memory projection:

```bash
mind-palace sync-codex "$MIND_PALACE_DB" . "$MIND_PALACE_SYNC_URL" "$MIND_PALACE_DEVICE_ID"
```

Report what was shared and why it is durable. The selection step is internal behavior of **共享记忆**, not a separate user-facing command.

## Sync

For `sync`, "同步记忆", or "下载记忆", run:

```bash
mind-palace sync-codex "$MIND_PALACE_DB" . "$MIND_PALACE_SYNC_URL" "$MIND_PALACE_DEVICE_ID"
```

Report how many central memories were received and applied. The next Codex session reads the refreshed native memory projection.

## Status

For `status` or "记忆状态", run:

```bash
mind-palace status "$MIND_PALACE_DB" .
```

Report the Space type and name, durable-memory count, and pending shared events. If unlinked, offer: create an archive, use General, link an existing archive, or remain unlinked.
