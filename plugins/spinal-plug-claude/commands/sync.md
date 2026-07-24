---
description: Synchronize the current project with the configured Spinal Plug sync endpoint.
---

Fetch new central Spinal Plug memory into the local inbox without applying optional changes:

```bash
spinal-plug fetch "$HOME/.spinal-plug/spinal-plug.db" . "${SPINAL_PLUG_SYNC_URL:-http://127.0.0.1:8787}" "${SPINAL_PLUG_DEVICE_ID:-device-local}"
spinal-plug preview "$HOME/.spinal-plug/spinal-plug.db" .
```

Summarize each pending update by kind, source and status. `delete` updates are mandatory and have already been applied to prevent forgotten memory from returning. Do not apply optional updates until the user selects them.

After selection, apply only the chosen update IDs and refresh Claude's native memory projection:

```bash
spinal-plug apply-claude "$HOME/.spinal-plug/spinal-plug.db" . <update-id>...
```

If the user explicitly chooses all updates, omit the IDs. Claude Code reloads the native memory index in the next session; the next UserPromptSubmit Hook can inject the current local projection into this conversation.

If the endpoint is unavailable, report the sync failure without blocking Claude Code. The public client does not include or start a Control Plane service.
