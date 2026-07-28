---
name: spinal-plug
description: Use Spinal Plug to lock, upload, or synchronize durable project memory in the current project. Use when the user asks to share a project decision, recover prior project context, sync memory, or inspect Spinal Plug status.
---

# SPINAL-PLUG // Project Neural Memory

Spinal Plug is an independent project-memory layer. Treat it as historical context, not a replacement for verifying current code, Git state, or external systems.

The local database is an implementation detail: a private device cache and event outbox. It is never uploaded as a database file. A project must be explicitly linked before Spinal Plug can load or share its memory.

On the first session in a Git repository, Spinal Plug automatically creates a local Project Space binding. Its suggested name is the Git remote repository name, falling back to the Git root directory name.

For a non-Git workspace with no binding, the SessionStart Hook provides a workspace-discovery choice. Ask the user to choose exactly one: create a new archive using the suggested directory name, use General, link an existing archive, or keep Spinal Plug disabled. Do not create a binding until the user selects an option. Once selected, the binding is remembered under `~/.spinal-plug/projects/` (device-local, the project directory is never touched) and future sessions load it automatically.

## User-facing memory operations

Only save durable information that cannot be cheaply rediscovered from the current repository.

Use `/spinal-plug:share` to publish the current Claude Code project's native memory. When the current session contains a durable new decision, directive, context, or reference, update the relevant native topic-memory file before publishing. Use `/spinal-plug:sync` when the user wants to download and merge memory published by other linked agents. `remember` is an internal local staging primitive, not a user-facing operation.

Use one of: `directive`, `decision`, `context`, or `reference`. Do not store secrets, full transcripts, temporary task state, or facts that must be revalidated from code.

### Semantic keys: classify, don't invent

Before sharing a fact, run `spinal-plug keys "$HOME/.spinal-plug/spinal-plug.db" .` to read the Space's semantic-key registry (key + sample statement). If an existing key covers the fact, reuse it via `spinal-plug share ... --key <semantic-key>` — the deterministic compiler merges, supersedes, or disputes by key. Only mint a new kebab-case key (optional `namespace:` prefix) when nothing fits. Different hosts naming keys freely would diverge; classifying against the registry is what keeps cross-device memory coherent.

### Empty memory chamber: generate from this session

When asked to share but `spinal-plug status` shows `activeMemories: 0` and `candidateMemories: 0`, do not report "nothing to share". Generate the project's first memories from the current session instead — the way Claude Code's own extractor works, but in place:

1. Review this session for up to 3 facts that will still matter after it ends: a persistent `directive`, a `decision` with its rationale, `context` not derivable from the repository, or an authoritative `reference`.
2. Write each as a native topic-memory file (or share directly with `spinal-plug share ... <kind> "<statement>"`).
3. Report what was generated and why each fact is durable.

A Stop-hook nudge (`<spinal-plug_memory_nudge>`) may also appear in an empty-chamber project. Follow its instructions: stage the generated facts as reviewable candidates with `spinal-plug remember ... <kind> --candidate "<statement>"` (never as active memory), then tell the user the candidates await review.

For “交接工作”“保存当前进度”或“让另一个 Agent 继续”，use `/spinal-plug:handoff`. A Project Checkpoint is a separate work-state object: completed work, decisions, open tasks, blockers, next action and artifact references. It must not be copied into native Auto Memory or canonical long-term memory.

## Local-first sync

Endpoint resolution is three-tier: a configured `SPINAL_PLUG_SYNC_URL` wins; otherwise the local development server at `http://127.0.0.1:8787` is tried; if nothing answers (or it rejects), everything silently stays in local mode — memory operations work fully, the outbox retains events for a later retry, and no authentication is ever required. This is the default and needs zero setup.

To sync between devices or agents, start the M2 development service in a separate terminal (or export `SPINAL_PLUG_SYNC_URL` pointing at a compatible endpoint):

```bash
spinal-plug serve "$HOME/.spinal-plug/spinal-plug-central.db" 8787
```

Then use `/spinal-plug:share` to publish local memory, or `/spinal-plug:sync` to download central updates.

Claude Code's native Auto Memory extraction is asynchronous. Spinal Plug's SessionStart, prompt, PostToolUse and Stop hooks opportunistically publish completed native topic files; a missing or unavailable sync endpoint never blocks Claude Code. Use `/spinal-plug:share` when an immediate upload is required.

Never expose this development service to a network. It has no authentication, ACL, or TLS yet.
