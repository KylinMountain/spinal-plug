---
description: Share the current Claude Code project's Auto Memory with Mind Palace.
---

Share the current project's Claude Code Auto Memory topic files with Mind Palace:

```bash
mind-palace share-claude "$HOME/.mind-palace/mind-palace.db" . http://127.0.0.1:8787 device-local
```

This imports Claude topic-memory files, not the raw transcript and not `MEMORY.md` (which is only an index). Repeated runs are idempotent: only new or changed topics are shared. The importer skips files containing likely private-key or API-key material. After a successful share, report the number of imported, updated, unchanged, and skipped files concisely.
