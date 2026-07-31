---
description: Save a Project Handoff so another linked Agent can continue this work.
---

The user wants to hand off ongoing project work. Do not convert temporary progress into a long-term memory, and store a reference instead of any secret value.

Only the latest handoff reaches a boot context, so read the current one first and carry its unresolved work forward — a still-open task that is dropped here disappears from every future boot:

```bash
spinal-plug handoff "$HOME/.spinal-plug/spinal-plug.db" . --latest
```

Then form a concise JSON object containing `title`, a one-line `summary` (the boot context prints it directly under the title), `completed`, `decisions`, `openTasks`, `blockers`, `nextAction`, and `artifactRefs` prefixed by type (`branch:`, `commit:`, `file:`, `space:`). Omit a field with no content instead of filling it with a placeholder like `"none"`, which is stored verbatim and reappears as a real blocker. Pass the JSON through a quoted heredoc so an apostrophe in the content cannot break the argument:

```bash
spinal-plug handoff "$HOME/.spinal-plug/spinal-plug.db" . "$(cat <<'JSON'
{"title":"…","summary":"…","completed":["…"],"openTasks":["…"],"nextAction":"…","artifactRefs":["branch:…"]}
JSON
)"
```

Report completed work, remaining work, blockers, and the recommended next action. The next linked Agent can retrieve this Project Handoff through synchronization and see it in its startup context.
