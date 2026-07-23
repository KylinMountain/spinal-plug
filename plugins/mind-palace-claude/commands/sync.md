---
description: Synchronize the current project with the local Mind Palace development server.
---

Download and merge new central Mind Palace memory into the current project, then materialize the resulting projection into Claude Code's native Auto Memory directory:

```bash
mind-palace sync-claude "$HOME/.mind-palace/mind-palace.db" . http://127.0.0.1:8787 device-local
```

The materializer owns only `mind-palace-synced.md` and a marked index block in Claude's `MEMORY.md`; it never changes user-owned memory text. It excludes topics already sourced from this same device's Claude Auto Memory, preventing duplicate local copies. The current conversation receives synchronized context from the next UserPromptSubmit Hook. Claude Code's native memory loader will see the generated index on the next session; Claude Code has no plugin-callable in-session native-memory reload API.

If the server is not running, state that it must be started separately with `mind-palace serve "$HOME/.mind-palace/mind-palace-central.db" 8787`. Do not expose the unauthenticated development service outside localhost.
