---
name: spinal-plug
description: Use Spinal Plug to lock, upload, or synchronize durable project memory in the current project. Use when the user asks to share a project decision, recover prior project context, sync memory, or inspect Spinal Plug status.
---

# SPINAL-PLUG // Project Neural Memory

Spinal Plug is an independent project-memory layer. Treat it as historical context, not a replacement for verifying current code, Git state, or external systems.

The local database is an implementation detail: a private device cache and event outbox. It is never uploaded as a database file. A project must be explicitly linked before Spinal Plug can load or share its memory.

On the first session in a Git repository, Spinal Plug automatically creates a local Project Space binding. Its suggested name is the Git remote repository name, falling back to the Git root directory name.

For a non-Git workspace with no binding, the SessionStart Hook provides a workspace-discovery choice. Ask the user to choose exactly one: create a new archive using the suggested directory name, use General, link an existing archive, or keep Spinal Plug disabled. Do not create a binding until the user selects an option. Once selected, `.spinal-plug/space.json` remembers the binding and future sessions load it automatically.

## User-facing memory operations

Only save durable information that cannot be cheaply rediscovered from the current repository.

Use `/spinal-plug:share` to publish the current Claude Code project's native memory. When the current session contains a durable new decision, directive, context, or reference, update the relevant native topic-memory file before publishing. Use `/spinal-plug:sync` when the user wants to download and merge memory published by other linked agents. `remember` is an internal local staging primitive, not a user-facing operation.

Use one of: `directive`, `decision`, `context`, or `reference`. Do not store secrets, full transcripts, temporary task state, or facts that must be revalidated from code.

For “交接工作”“保存当前进度”或“让另一个 Agent 继续”，use `/spinal-plug:handoff`. A Project Checkpoint is a separate work-state object: completed work, decisions, open tasks, blockers, next action and artifact references. It must not be copied into native Auto Memory or canonical long-term memory.

## Local sync demonstration

The M2 development service is local-only and unauthenticated. Start it in a separate terminal:

```bash
spinal-plug serve "$HOME/.spinal-plug/spinal-plug-central.db" 8787
```

Then use `/spinal-plug:share` to publish local memory, or `/spinal-plug:sync` to download central updates.

```bash
spinal-plug sync "$HOME/.spinal-plug/spinal-plug.db" . http://127.0.0.1:8787 device-local
```

Claude Code's native Auto Memory extraction is asynchronous. Spinal Plug's SessionStart, prompt, and Stop hooks opportunistically publish completed native topic files; a missing or unavailable local development server never blocks Claude Code. Use `/spinal-plug:share` when an immediate upload is required.

Never expose this development service to a network. It has no authentication, ACL, or TLS yet.
