---
description: Share the current Claude Code project's Auto Memory with Spinal Plug.
---

Share the current project's Claude Code Auto Memory topic files with Spinal Plug:

```bash
spinal-plug share-claude "$HOME/.spinal-plug/spinal-plug.db" . "${SPINAL_PLUG_SYNC_URL:-}" "${SPINAL_PLUG_DEVICE_ID:-device-local}"
```

With no `SPINAL_PLUG_SYNC_URL` configured the import stays local-only — that is the default and needs no authentication. Set `SPINAL_PLUG_SYNC_URL` to publish to a sync endpoint.

If `spinal-plug status "$HOME/.spinal-plug/spinal-plug.db" .` shows `activeMemories: 0` and `candidateMemories: 0`, the project has no memory yet: generate up to 3 durable facts from the current session (directive / decision / context / reference; never secrets, transcripts, or temporary state) and share each with `spinal-plug share ... <kind> "<statement>"`, then report what was generated.

This imports Claude topic-memory files, not the raw transcript and not `MEMORY.md` (which is only an index). Repeated runs are idempotent: only new or changed topics are shared. The importer skips files containing likely private-key or API-key material. After a successful share, report the number of imported, updated, unchanged, and skipped files concisely.
