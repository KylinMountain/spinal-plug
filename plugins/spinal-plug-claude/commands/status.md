---
description: Inspect Spinal Plug project memory and local sync status.
---

Show Spinal Plug status for the current project. Run:

```bash
spinal-plug status "$HOME/.spinal-plug/spinal-plug.db" .
```

Report the Space type, name, active memories, and pending shared events concisely. Do not mention database paths, SQLite, or Outbox. If the directory is not linked, offer the four choices: create an archive, use General, link an existing archive, or remain unlinked.
