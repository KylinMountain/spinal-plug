<p align="center">
  <img src="./assets/spinal-plug-masthead.svg" alt="SPINAL-PLUG — Neural Memory Link" width="100%" />
</p>

<p align="center">
  <strong>Let different devices and different agents continue with the same project continuity.</strong><br />
  <sub>Not a copied consciousness. Not a dump of old chats. A governed way to return durable experience and load it into the next session.</sub>
</p>

<p align="center">
  <a href="#boot-sequence">Boot Sequence</a> · <a href="#memory-boundary">Memory Boundary</a> · <a href="#host-links">Host Links</a> · <a href="#quick-arm">Quick Arm</a> · <a href="README.md">中文</a>
</p>

---

## An Agent Should Not Start Blank

You make a migration decision in Codex, investigate a failure in Claude Code, then continue from another device.

**Spinal Plug** turns the project experience worth keeping into traceable, selectively synchronized signals that can be projected into a host's native memory. The next session does not need to begin with “what is this project?”

```text
   make a decision             choose to publish              continue work

  Claude / Codex  ──►  SPINAL-PLUG  ──►  Claude / Codex
  isolated sessions       governed memory link       bounded native projection
```

> **Hard boundary**: it shares governed project experience, not model weights, hidden state, full transcripts, or an unbounded context window.

## Inspiration: Loading Is Not a Background Action

Spinal Plug draws narrative energy from the visible ritual before entering a system in *Neon Genesis Evangelion*: **connect, calibrate, confirm, then act**. It borrows that product rhythm and control-room tension only; it does not use characters, machines, logos, quotes, or original footage.

All images are original Spinal Plug assets. This project is not affiliated with, authorized by, or endorsed by *Neon Genesis Evangelion* or its rights holders.

<p align="center">
  <img src="./assets/memory-core-boot.jpg" alt="An abstract memory core entering a Spinal Plug dock" width="100%" />
</p>

## Boot Sequence

```text
M E M O R Y   C O R E   B O O T   S E Q U E N C E

[01/05]  PROJECT SPACE        LINKED      this directory resolves to a shared project space
[02/05]  INCARNATION LINK     BOUND       the current host session is attached
[03/05]  MIND CAPSULE         READY       a bounded boot context is available
[04/05]  MEMORY FIDELITY      LIVE        durable references are in the current projection
[05/05]  SYNC UPLINK          ARMED       updates from other hosts can be discovered
```

| Term | What it actually means |
| --- | --- |
| **Spinal Plug** | The project-memory link attached to a compatible agent host. |
| **Memory Fidelity** | Durable references actually available to this session, not a fabricated percentage. |
| **Mind Capsule** | A token-bounded boot package that can later grow into a role and work-state runtime. |
| **Incarnation Link** | The binding between the current host session and a Project Space. |
| **Sync Uplink** | A controlled connection to a compatible sync endpoint. |

## Memory Boundary

### Return these signals

```text
+ Technical or product decisions, with their rationale
+ Durable project rules and workflow corrections
+ Critical context that cannot be inferred from the repository
+ Pointers to authoritative dashboards, tickets, or specifications
```

### Do not return these signals

```text
- Secrets, tokens, and credentials
- Full transcripts, raw tool output, or chain-of-thought
- Temporary status such as "tests are running"
- Facts that must be verified from code, Git, or external systems
```

Current work should not pollute long-term memory. Keep it in a separate **handoff**: completed work, open work, next action, and blockers.

## Not Forced Sync. Controlled Loading.

```text
FETCH                 PREVIEW                 APPLY                 PROJECT
discover updates  ──► see the impact first ─► select this session ─► native host projection
```

You can see what another incarnation learned without immediately changing the current context. Deletions and access revocations are safety-critical exceptions.

<p align="center">
  <img src="./assets/selective-sync.jpg" alt="An abstract selective-sync console for observe, review, and apply" width="100%" />
</p>

## Host Links

| Host | Link state | Embodiment |
| --- | --- | --- |
| **Claude Code** | `ONLINE` | Lifecycle hooks plus a managed Auto Memory projection. |
| **Codex** | `ONLINE` | Lifecycle hooks, bounded candidate extraction, and a reserved native-memory projection. |
| **Any other agent** | `ONLINE` | Host-agnostic skill: no hooks, no native projection, memory arrives through `boot` output. |
| **Future Hosts** | `STANDBY` | Extend through the Adapter Contract and MCP Surface. |

Spinal Plug does not replace host memory or overwrite user-owned content. It only maintains its own managed projection blocks.

<p align="center">
  <img src="./assets/incarnation-link.jpg" alt="Two independent hosts connected through one memory core" width="100%" />
</p>

## Quick Arm

### 01 / Install the client

From a tagged release the client is a single dependency-free file:

```bash
npm install -g @spinal-plug/cli
```

From source — the only option before the first tag, and what to use while
developing the client:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm -C packages/cli link --global   # exposes `spinal-plug` on PATH
```

### 02 / Lock the current project

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" .
spinal-plug boot "$HOME/.spinal-plug/spinal-plug.db" .
```

Local SQLite is a device cache and outbox. The database file is never uploaded; cross-device synchronization carries versioned events with provenance and deletion semantics.

### 03 / Attach a sync endpoint

With no endpoint configured, publication first tries the local development server at `127.0.0.1:8787` and silently stays in local mode when nothing answers — local-first is the default, no authentication, testable out of the box. Configure an endpoint only when you need cross-device or cross-agent sync:

```bash
export SPINAL_PLUG_SYNC_URL="https://your-sync-endpoint.example"
```

The endpoint is the only thing to configure. This device's identity comes from `~/.spinal-plug/device.env`, which an authenticated endpoint issues; setting `SPINAL_PLUG_DEVICE_ID` by hand overrides that credential and the endpoint rejects the request.

The public client does **not** include a Control Plane service. Connect or deploy a compatible endpoint separately.

### 04 / Use it in a host

Marketplace manifests for Codex and Claude Code are under `plugins/`. After installation, use:

```text
/spinal-plug:connect
/spinal-plug:status
/spinal-plug:share
/spinal-plug:sync
/spinal-plug:handoff
/spinal-plug:boot
```

### 05 / Use it in an agent without a plugin

Any other agent that can load a SKILL.md and run shell commands (Qoder, Gemini CLI, an in-house agent) needs no plugin — point it at [`skills/spinal-plug/`](./skills/spinal-plug/SKILL.md):

```bash
ln -s "$PWD/skills/spinal-plug" ~/.your-agent/skills/spinal-plug
```

Such a host has no lifecycle hooks and no native memory surface to write into, so memory enters the context through `boot` output: re-boot after a sync, and the agent offers `share` before the work wraps up. Installation, verification, and the full list of differences are in [`skills/README.md`](./skills/README.md).

## Project Status

The current release focuses on project-scoped durable memory, native host projections, local-first storage, and selective synchronization. `Mind Core`, `Mind Capsule`, `Incarnation`, and richer work-state handoff are modeled as extensible runtime concepts, not promises of identical behavior between models.

## Engineering

- [Architecture](ARCHITECTURE.md)
- [Agent guide](AGENTS.md)
- `pnpm verify` runs repository checks, type checks, builds, and tests.

## Development

```bash
pnpm test
pnpm typecheck
```

## License

Apache License 2.0. See [LICENSE](./LICENSE).

---

<p align="center">
  <strong>SPINAL-PLUG</strong><br />
  <sub>MEMORY FIDELITY · PROJECT CONTINUITY · MANY CAPABLE HOSTS</sub>
</p>
