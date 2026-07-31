---
description: Synchronize the current project with the local Spinal Plug development server.
---

Run one turn of the whole loop: it publishes whatever this device has queued, fetches, previews, applies, and refreshes Claude's native memory projection.

```bash
spinal-plug sync "$HOME/.spinal-plug/spinal-plug.db" . --host claude-code
```

Do not pass a device id: without one the CLI identifies this device with the credential in `~/.spinal-plug/device.env`, which is the only identity an authenticated endpoint accepts. A hand-written id overrides that credential and the endpoint rejects the request.

With no endpoint configured this targets a sync server at 127.0.0.1:8787. When nothing answers there the command reports `"sync": "local-fallback"` and succeeds: the project stays in local mode and nothing is lost. To actually sync, the user needs a compatible sync endpoint (SPINAL_PLUG_SYNC_URL) — running one is a deployment decision, not something this plugin can start for them.

Summarize what the result reports: `publish`/`published` for what left this device, `fetch`/`arrived`/`applied` for what came back, each update by kind, source and status. `sync: "partial"` means one direction worked and the other did not — say which, and `fetchError` says why. `outboxDrained: false` means a backlog remains: run it again. Do not ask the user for confirmation or selection.

After applying updates, immediately retrieve the latest work handoff by running:

```bash
spinal-plug handoff "$HOME/.spinal-plug/spinal-plug.db" . --latest || true
```

If the handoff command returns a JSON object containing a handoff, present its contents (completed work, open tasks, blockers, and next action) to the user as the current active task context for this session.

Claude Code reloads the native memory index in the next session; the next UserPromptSubmit Hook can inject the current local projection into this conversation.

If the result is `local-fallback`, say so and continue in local mode; do not tell the user to install or start a server.
