---
description: Save a Project Checkpoint so another linked Agent can continue this work.
---

The user wants to hand off ongoing project work. Do not convert temporary progress into a long-term memory. First form a concise JSON object containing: `title`, `completed`, `decisions`, `openTasks`, `blockers`, `nextAction`, and `artifactRefs`. Then run:

```bash
spinal-plug handoff "$HOME/.spinal-plug/spinal-plug.db" . '<checkpoint-json>'
```

Report completed work, remaining work, blockers, and the recommended next action. The next linked Agent can retrieve this Project Checkpoint through synchronization and see it in its startup context.
