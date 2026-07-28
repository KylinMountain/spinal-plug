# Agent Guide

## Start Here

Spinal Plug is a TypeScript pnpm workspace for durable, project-scoped memory
across Codex and Claude Code. Read these files before making non-trivial
changes:

1. `README.md` for product intent and the supported user flow.
2. `ARCHITECTURE.md` for package ownership and allowed dependency directions.
3. Local `docs/` notes, when present. They are intentionally ignored by Git and
   must not be required to understand or validate a code change.

This file is a table of contents, not an encyclopedia. Keep the committed
harness small enough that a clean clone remains self-describing.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
pnpm test
pnpm verify
pnpm dev:server -- --port 8787
```

`pnpm verify` is the default pre-PR gate. It validates repository knowledge,
architecture boundaries, types, builds, and tests. Space bindings and server
databases are device-local state and live under `~/.spinal-plug/` — the
current worktree is never touched.

## Repository Map

| Path | Owns |
| --- | --- |
| `packages/protocol` | Shared schemas and event contracts. |
| `packages/sync-server` | Sync semantics, persistence, Control Plane, and `/palace`. |
| `packages/local-node` | Local SQLite state, sync client, projections, and runtime entities. |
| `packages/adapter-sdk` | Stable host adapter contract. |
| `packages/adapter-*` | Claude Code and Codex host integration. |
| `packages/cli` | User-facing command composition and service startup. |
| `packages/mcp-server` | MCP surface over local project memory. |
| `plugins/` | Claude Code and Codex marketplace plugins (hooks, skills, commands). |
| `docs/` | Optional local notes. They are never required by CI. |
| `scripts/` | Mechanical repository checks and local developer utilities. |

## Working Rules

- Preserve the dependency directions in `ARCHITECTURE.md`; run `pnpm check` if
  package imports or workspace dependencies change.
- Treat event envelopes and protocol schemas as compatibility boundaries. Add
  tests for behavior changes at the narrowest affected package.
- Keep real secrets, raw transcripts, and ephemeral task progress out of
  durable memory and test fixtures. Synthetic secret-shaped fixtures used to
  test the detector are allowed and encouraged.
- Update `README.md` or `ARCHITECTURE.md` when a committed contract or package
  boundary changes. Local `docs/` notes may be updated for personal context but
  must not be added to commits.
- Do not restore historical documentation wholesale.
- Reply to users in Chinese. This repository uses the KylinMountain
  GitHub account (`kose2livs@gmail.com`) for GitHub operations.

## Change Completion

Before opening a PR, run the narrowest relevant tests and `pnpm verify` when
the full suite is practical. Record any skipped validation and why. Keep PRs
small and state acceptance criteria. Track durable, shared gaps in GitHub or
the committed repository guidance, not in untracked TODOs.
