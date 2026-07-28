---
description: Connect the current directory to a suggested Spinal Plug Space.
---

The user has explicitly requested to create a suggested Spinal Plug binding for this directory. For Git workspaces this creates a `project`; for non-Git workspaces it creates an `archive` named after the directory:

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" .
```

Report the Space type, name, and ID. Explain that this registers a device-local binding under `~/.spinal-plug/projects/`(the project directory is never touched) plus a private local event cache; neither the local SQLite file nor Claude Code's native memory directory is uploaded.
