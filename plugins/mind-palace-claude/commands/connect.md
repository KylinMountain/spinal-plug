---
description: Connect the current directory to a suggested Mind Palace Space.
---

The user has explicitly requested to create a suggested Mind Palace binding for this directory. For Git workspaces this creates a `project`; for non-Git workspaces it creates an `archive` named after the directory:

```bash
mind-palace connect "$HOME/.mind-palace/mind-palace.db" .
```

Report the Space type, name, and ID. Explain that this creates a small `.mind-palace/space.json` directory binding and a private local event cache; neither the local SQLite file nor Claude Code's native memory directory is uploaded.
