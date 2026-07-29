---
description: Bind the current directory to a Spinal Plug Space.
---

The user has explicitly requested a Spinal Plug binding for this directory. Binding is one decision with four answers — pick the mode from what the user asked for, and do not bind until they have chosen one.

**Suggested binding** (no mode). For Git workspaces this creates a `project`; for non-Git workspaces it creates an `archive` named after the directory:

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" .
```

**General Space** — the user wants this directory to use their cross-project General memory:

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" . general
```

**Named archive** — a non-Git workspace the user wants to name themselves. Use the name they provide; otherwise use the directory name:

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" . archive "<archive-name>"
```

**Existing Space** — the user selected an archive that already exists. Use the provided Space ID and optional display name:

```bash
spinal-plug connect "$HOME/.spinal-plug/spinal-plug.db" . link <space-id> "<display-name>"
```

Report the Space type, name, and ID. Explain that this registers a device-local binding under `~/.spinal-plug/projects/` (the project directory is never touched) plus a private local event cache; neither the local SQLite file nor Claude Code's native memory directory is uploaded.

A directory that is already bound keeps its original Space: rerunning with a different mode reports the existing binding instead of re-pointing it.
