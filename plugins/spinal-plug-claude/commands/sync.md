---
description: Synchronize the current project with the local Spinal Plug development server.
---

Fetch new central Spinal Plug memory into the local inbox without applying optional changes:

```bash
spinal-plug fetch "$HOME/.spinal-plug/spinal-plug.db" . "$SPINAL_PLUG_SYNC_URL" "${SPINAL_PLUG_DEVICE_ID:-device-local}"
spinal-plug preview "$HOME/.spinal-plug/spinal-plug.db" .
```

If `SPINAL_PLUG_SYNC_URL` is not set, stop and say so: synchronization is opt-in, the default is local-only. To enable it, start the development server (`spinal-plug serve "$HOME/.spinal-plug/spinal-plug-central.db" 8787` in a separate terminal) and export `SPINAL_PLUG_SYNC_URL="http://127.0.0.1:8787"`. Do not expose the unauthenticated development service outside localhost.

Summarize each pending update by kind, source and status. `delete` updates are mandatory and have already been applied to prevent forgotten memory from returning. Do not apply optional updates until the user selects them.

After selection, apply only the chosen update IDs and refresh Claude's native memory projection:

```bash
spinal-plug apply-claude "$HOME/.spinal-plug/spinal-plug.db" . <update-id>...
```

If the user explicitly chooses all updates, omit the IDs. Claude Code reloads the native memory index in the next session; the next UserPromptSubmit Hook can inject the current local projection into this conversation.

If the fetch fails because the server is not running, state that it must be started separately with `spinal-plug serve "$HOME/.spinal-plug/spinal-plug-central.db" 8787`.
