---
description: Synchronize the current project with the local Mind Palace development server.
---

Fetch new central Mind Palace memory into the local inbox without applying optional changes:

```bash
mind-palace fetch "$HOME/.mind-palace/mind-palace.db" . "${MIND_PALACE_SYNC_URL:-http://127.0.0.1:8787}" "${MIND_PALACE_DEVICE_ID:-device-local}"
mind-palace preview "$HOME/.mind-palace/mind-palace.db" .
```

Summarize each pending update by kind, source and status. `delete` updates are mandatory and have already been applied to prevent forgotten memory from returning. Do not apply optional updates until the user selects them.

After selection, apply only the chosen update IDs and refresh Claude's native memory projection:

```bash
mind-palace apply-claude "$HOME/.mind-palace/mind-palace.db" . <update-id>...
```

If the user explicitly chooses all updates, omit the IDs. Claude Code reloads the native memory index in the next session; the next UserPromptSubmit Hook can inject the current local projection into this conversation.

If the server is not running, state that it must be started separately with `mind-palace serve "$HOME/.mind-palace/mind-palace-central.db" 8787`. Do not expose the unauthenticated development service outside localhost.
