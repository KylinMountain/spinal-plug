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
```

```bash
pnpm build:release
```

Builds the publishable client into `release/npm/`: one dependency-free bundle
plus a generated manifest. Internal `@spinal-plug/*` packages stay unpublished —
bundling resolves them, so the published package declares no runtime
dependencies.

A tag is the whole release, and nothing in the repository records a version.
Pushing `v0.2.0` makes `release.yml` build the client at 0.2.0, publish it to npm
as `spinal-plug`, and attach the bundle to the GitHub Release — no file is
edited, no pull request bumps anything, and no commit goes back to a branch. The
plugins need no publish step because this repository is their marketplace, and no
version because each host versions a plugin by the commit it fetched.
`packages/cli/package.json` keeps a `0.0.0-dev` placeholder so a local
`pnpm build:release` produces something honestly unreleasable. It also keeps the
workspace name `@spinal-plug/cli`, which the private server repository depends on
over `link:`; the published name is `spinal-plug`, set in `build-release.mjs`,
because what a user installs should be what a user types.

Publishing uses npm trusted publishing (OIDC): no stored credential, and none to
rotate. npm is retiring 2FA-bypass tokens — account management in August 2026,
direct publishing around January 2027 — so a token is the path that expires. OIDC
needs npm >= 11.5.1, which the workflow installs because Node 22 does not ship
it. The trust relationship lives in the package's npm settings and can only be
configured on a package that exists, so the first release of a new package is
published by hand with 2FA.

`pnpm verify` is the default pre-PR gate. It validates repository knowledge,
architecture boundaries, types, builds, and tests. Space bindings and server
databases are device-local state and live under `~/.spinal-plug/` — the
current worktree is never touched.

## Repository Map

| Path | Owns |
| --- | --- |
| `packages/protocol` | Shared schemas and event contracts. |
| `packages/local-node` | Local SQLite state, sync client, projections, and runtime entities. |
| `packages/adapter-sdk` | Stable host adapter contract. |
| `packages/adapter-*` | Claude Code and Codex host integration. |
| `packages/cli` | User-facing command composition and service startup. |
| `packages/mcp-server` | MCP surface over local project memory. |
| `plugins/` | Claude Code and Codex marketplace plugins (hooks, skills, commands). |
| `skills/` | Host-agnostic skill for agents without hooks or a native memory surface. |
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
- Keep `skills/spinal-plug/SKILL.md` runnable on a host with no hooks and no
  native memory surface: its commands may only use flags every agent can honor.
  When a CLI command or flag it drives changes, update it together with the
  plugin skills under `plugins/`; `pnpm check:repository` enforces the frontmatter,
  the command names, and the host-agnostic constraint.
- No version lives in a plugin manifest. The tag is the version and only npm
  needs one, which travels in the tarball the release builds; both hosts serve a
  plugin from this repository and version it by the commit they fetched. A number
  written here would pin every host to the copy it first cached.
  `pnpm check:plugins` fails if one reappears.
- Do not restore historical documentation wholesale.
- Local databases created before the first release are not migrated. The
  checkpoint→handoff rename left its predecessor table behind rather than copying
  it — `init` clears that table only when it is empty — and `checkpoint.*` events
  are not read. Never delete rows a rename orphaned: nothing reads them, so
  nothing is gained, and they are the only copy their owner has. Once a version
  is published, a schema or event-type rename needs a migration and a
  compatibility window instead.
- Reply to users in Chinese. This repository uses the KylinMountain
  GitHub account (`kose2livs@gmail.com`) for GitHub operations.

## Change Completion

Before opening a PR, run the narrowest relevant tests and `pnpm verify` when
the full suite is practical. Record any skipped validation and why. Keep PRs
small and state acceptance criteria. Track durable, shared gaps in GitHub or
the committed repository guidance, not in untracked TODOs.
