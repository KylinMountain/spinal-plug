#!/usr/bin/env bash
# Keep host hooks non-fatal, as the Codex hook already is: Spinal Plug has its
# own WAL/outbox, so a local failure must surface as "nothing to add" rather than
# as a hook error on the user's turn. `-e` would have propagated any CLI exit.
set -uo pipefail

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

# Capture, then print once. Streaming the CLI's stdout straight through and
# appending `{}` on failure would hand the host `<partial>{}` if the CLI died
# mid-write — invalid JSON is worse than no answer.
if ! output="$(printf '%s' "$payload" | NODE_NO_WARNINGS=1 "$spinal_plug_bin" hook-stdin claude-code "${SPINAL_PLUG_DB_PATH:-$HOME/.spinal-plug/spinal-plug.db}")"; then
  output='{}'
fi
printf '%s\n' "${output:-\{\}}"

exit 0
