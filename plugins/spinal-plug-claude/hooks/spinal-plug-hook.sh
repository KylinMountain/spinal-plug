#!/usr/bin/env bash
set -euo pipefail

# The plugin does not read or write Claude Code's native auto-memory files.
# It forwards the host Hook payload to Spinal Plug's independent local runtime.
spinal_plug_bin="${SPINAL_PLUG_BIN:-spinal-plug}"
if ! command -v "$spinal_plug_bin" >/dev/null 2>&1; then
  printf '{}\n'
  exit 0
fi
NODE_NO_WARNINGS=1 "$spinal_plug_bin" hook-stdin claude-code "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}"
