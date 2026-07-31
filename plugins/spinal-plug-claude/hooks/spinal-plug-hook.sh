#!/usr/bin/env bash
set -euo pipefail

# The plugin does not read or write Claude Code's native auto-memory files.
# It forwards the host Hook payload to Spinal Plug's independent local runtime.
spinal_plug_bin="${SPINAL_PLUG_BIN:-spinal-plug}"
if ! command -v "$spinal_plug_bin" >/dev/null 2>&1; then
  printf '{}\n'
  exit 0
fi

payload="$(cat || true)"
if [ -z "$payload" ]; then
  payload='{}'
fi

# PostToolUse fires for every write-class tool call. Only writes inside a
# project's native memory directory are worth spawning the CLI for — every
# other payload exits here so normal editing never pays the process cost.
# The directory is derived from CLAUDE_CONFIG_DIR, which the CLI's importer
# also honours; hardcoding "/.claude/" would disable hot import entirely for
# anyone who relocated their Claude config.
# Matching the projects directory alone matches every payload: `transcript_path`
# is always <projects-dir>/<slug>/<session>.jsonl, so the guard never fired and
# each edit paid for a CLI process. Require a path that is actually a managed
# memory file — <projects-dir>/<slug>/memory/<name>.md.
claude_projects_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
memory_file_pattern="$(printf '%s' "$claude_projects_dir" | sed 's/[][\.*^$(){}?+|]/\\&/g')/[^\"]*/memory/[^\"]*\.md"
if printf '%s' "$payload" | grep -q 'PostToolUse' \
  && ! printf '%s' "$payload" | grep -qE "$memory_file_pattern"; then
  printf '{}\n'
  exit 0
fi

printf '%s' "$payload" | NODE_NO_WARNINGS=1 "$spinal_plug_bin" hook-stdin claude-code "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}"
