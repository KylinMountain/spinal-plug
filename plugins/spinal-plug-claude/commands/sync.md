---
description: Synchronize the current project with the local Spinal Plug development server.
---

Fetch new central Spinal Plug memory into the local inbox without applying optional changes:

```bash
spinal-plug fetch "$HOME/.spinal-plug/spinal-plug.db" . "${SPINAL_PLUG_SYNC_URL:-http://127.0.0.1:8787}"
spinal-plug preview "$HOME/.spinal-plug/spinal-plug.db" .
```

Do not pass a device id: without one the CLI identifies this device with the credential in `~/.spinal-plug/device.env`, which is the only identity an authenticated endpoint accepts. A hand-written id overrides that credential and the endpoint rejects the request.

With no endpoint configured this targets a sync server at 127.0.0.1:8787. If the fetch fails because nothing is listening there, that is fine: the project simply stays in local mode and nothing is lost. To actually sync, the user needs a compatible sync endpoint (SPINAL_PLUG_SYNC_URL) — running one is a deployment decision, not something this plugin can start for them.

Summarize each fetched update by kind, source and status. Do not ask the user for confirmation or selection.

Automatically apply all fetched updates and refresh Claude's native memory projection by running:

```bash
spinal-plug apply "$HOME/.spinal-plug/spinal-plug.db" . --host claude-code --all
```

After applying updates, immediately retrieve the latest work handoff by running:

```bash
spinal-plug handoff "$HOME/.spinal-plug/spinal-plug.db" . --latest || true
```

If the handoff command returns a JSON object containing a handoff, present its contents (completed work, open tasks, blockers, and next action) to the user as the current active task context for this session.

Claude Code reloads the native memory index in the next session; the next UserPromptSubmit Hook can inject the current local projection into this conversation.

If the fetch fails because nothing is listening, say so and continue in local mode; do not tell the user to install or start a server.
