# SPINAL-PLUG

> **One memory core. Many capable hosts.**

Spinal Plug is a cross-device project-memory client for AI coding agents. It lets a project's durable decisions, working conventions, and essential context travel between compatible hosts such as Claude Code and Codex. It does not claim to copy model weights, hidden state, or consciousness.

```text
CLAUDE CODE / CODEX                 SPINAL PLUG                    NEXT HOST

work in a project       publish      durable memory      project     load a bounded
make a decision      ───────────►    sync endpoint    ─────────►     native projection
correct a workflow
```

中文版：[README.md](README.md)

## Why

An agent that opens a project on a second device should not need the user to restate every important decision. At the same time, injecting every old chat message creates noise, stale context, and privacy risk.

Spinal Plug keeps the boundary deliberate:

- **Load**: start with a small, relevant project memory projection.
- **Work**: each host works independently in its own session and environment.
- **Return**: publish only durable signals; other hosts preview and choose what to apply.

The goal is project continuity, not an unbounded global prompt.

## The Experience

```text
MEMORY CORE BOOT SEQUENCE

[01/05] Project Space ............ LINKED
[02/05] Incarnation Link ......... BOUND
[03/05] Mind Capsule ............. READY
[04/05] Memory Fidelity .......... AVAILABLE
[05/05] Sync Uplink .............. ONLINE
```

| Term | Meaning |
| --- | --- |
| **Spinal Plug** | The project-memory link attached to a compatible agent host. |
| **Memory Fidelity** | The durable references available to the current session, not a fabricated percentage. |
| **Mind Capsule** | A bounded boot package that can later grow into a richer role and work-state runtime. |
| **Incarnation Link** | The binding between the current host session and a Project Space. |
| **Sync Uplink** | The selected connection to a compatible sync endpoint. |

## What It Preserves

Spinal Plug is for information that is costly to rediscover and remains useful across sessions:

- A technical or product decision and its rationale.
- A durable project rule or workflow correction.
- Context that is not obvious from the repository.
- A pointer to an authoritative external reference.

It is not for secrets, complete transcripts, transient task progress, or facts that must be revalidated from source code. Use checkpoints and handoffs for current work state rather than polluting long-term memory.

## Selective Synchronization

Receiving an update and using it are separate actions:

```text
Fetch  →  Preview  →  Apply  →  Native projection
```

You can see what another agent learned before it changes the current session. Deletions and access revocations remain safety-critical exceptions.

## Supported Hosts

| Host | Current integration |
| --- | --- |
| **Claude Code** | Lifecycle-hook context loading and a managed Auto Memory projection. |
| **Codex** | Lifecycle hooks, bounded candidate extraction, and a reserved native-memory projection. |
| **Future hosts** | Extend through the adapter contract and MCP surface without changing the local memory model. |

Spinal Plug does not replace any host's native memory system. It maintains only its own managed projection and leaves user-owned memory untouched.

## Quick Start

### 1. Build the client

```bash
pnpm install
pnpm build
pnpm typecheck
```

### 2. Connect a project

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" .
spinal-plug boot "$HOME/.spinal-plug/spinal-plug.db" .
```

The local SQLite database is a private device cache and outbox. It is never uploaded as a database file; synchronization transfers versioned events with provenance.

### 3. Connect a sync endpoint

```bash
export SPINAL_PLUG_SYNC_URL="https://your-sync-endpoint.example"
export SPINAL_PLUG_DEVICE_ID="device-local"
```

The public client intentionally does **not** include a Control Plane service. Deploy or connect a compatible endpoint separately.

### 4. Use the host plugins

Marketplace manifests for Codex and Claude Code are in `plugins/`. Once installed, use:

```text
/spinal-plug:connect
/spinal-plug:share
/spinal-plug:sync
/spinal-plug:boot
```

## Project Status

The current release focuses on project-scoped durable memory, native host projections, local-first storage, and selective synchronization. `Mind Core`, `Mind Capsule`, `Incarnation`, and richer work-state handoff are modeled as extensible runtime concepts, not promises of identical behavior between models.

## Development

```bash
pnpm test
pnpm typecheck
```

---

**SPINAL-PLUG**
*Memory fidelity. Project continuity. Many capable hosts.*
