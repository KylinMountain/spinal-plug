# Architecture

## Purpose

Spinal Plug carries durable project memory between compatible Agent hosts. The
event ledger is authoritative; local and central SQLite stores are materialized
views that can be rebuilt from events.

## Package Boundaries

```text
protocol
  |-- local-node (owns the deterministic sync kernel)
  |-- adapter-sdk
  |-- adapter-claude-code <- local-node + adapter-sdk
  |-- adapter-codex       <- local-node + adapter-sdk
  |-- mcp-server          <- local-node
  `-- cli                <- composition root for all runtime packages
```

`packages/protocol` owns only shared types and schemas. It must never import a
runtime package. `packages/cli` is the only composition root; host adapters and
services must not import the CLI. `scripts/check-architecture.mjs` enforces the
allowed internal imports and declared workspace dependencies.

| Package | Allowed internal dependencies |
| --- | --- |
| `protocol` | None |
| `adapter-sdk` | `protocol` |
| `local-node` | `protocol` |
| `adapter-claude-code`, `adapter-codex` | `protocol`, `local-node`, `adapter-sdk` |
| `mcp-server` | `protocol`, `local-node` |
| `cli` | All runtime packages; it composes the application. |

## Core Flows

1. A host adapter sends a normalized observation to the CLI or local node.
2. `local-node` writes an immutable event and local projection in one SQLite
   transaction, then places the event in the outbox.
3. The sync server (private `mind-palace` repository) accepts idempotent events, compiles canonical memory state,
   and exposes authenticated Control Plane APIs.
4. A client fetches canonical updates and applies them locally: host sync
   commands apply everything fetched and report the result, while the CLI
   also supports previewing and applying a selected subset. Tombstones are
   mandatory updates.
5. `/console` and `/palace` visualize authorized Control Plane data; they do
   not read a user's local SQLite cache.

## Contracts That Need Care

- `EventEnvelope` and protocol schemas are compatibility contracts.
- Memory deletion is a tombstone event, never history erasure.
- Host-native memory is a managed projection, not the source of truth.
- The public Control Plane requires device credentials and Space ACL checks.
- `/palace` assets are public static files; data remains token-authenticated.

## Verification

- `pnpm check:architecture` validates workspace dependency directions.
- `pnpm check:repository` validates the committed harness entry points.
- `pnpm verify` runs both checks, type checks, builds, and tests.

Local `docs/` notes are intentionally Git-ignored and are not a CI dependency.
