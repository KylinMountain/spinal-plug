---
description: Inspect Mind Palace project memory and local sync status.
---

Show Mind Palace status for the current project. Run:

```bash
mind-palace status "$HOME/.mind-palace/mind-palace.db" .
```

Report the Space type, name, active memories, and pending shared events concisely. Do not mention database paths, SQLite, or Outbox. If the directory is not linked, offer the four choices: create an archive, use General, link an existing archive, or remain unlinked.
