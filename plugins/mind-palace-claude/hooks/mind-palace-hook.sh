#!/usr/bin/env bash
set -euo pipefail

# The plugin does not read or write Claude Code's native auto-memory files.
# It forwards the host Hook payload to Mind Palace's independent local runtime.
NODE_NO_WARNINGS=1 mind-palace hook-stdin claude-code "${MIND_PALACE_DB_PATH:-$HOME/.mind-palace/mind-palace.db}"
