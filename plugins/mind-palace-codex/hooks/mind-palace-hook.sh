#!/usr/bin/env bash
# Keep host hooks non-fatal. Spinal Plug has its own WAL/outbox, so a local
# service outage must never interrupt a Codex turn.
set -uo pipefail

event_name="${1:?expected a hook event name}"
db_path="${MIND_PALACE_DB:-$HOME/.mind-palace/mind-palace.db}"
mind_palace_bin="${SPINAL_PLUG_BIN:-spinal-plug}"
if ! command -v "$mind_palace_bin" >/dev/null 2>&1; then mind_palace_bin="${MIND_PALACE_BIN:-mind-palace}"; fi

if ! command -v "$mind_palace_bin" >/dev/null 2>&1; then
  printf '{}\n'
  exit 0
fi

payload="$(cat || true)"
if [ -z "$payload" ]; then
  payload='{}'
fi

# Codex hook payloads carry their own event name. Add the configured event as
# a fallback so this plugin remains compatible with older runtimes.
printf '%s' "$payload" | node -e '
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { raw += chunk; });
  process.stdin.on("end", () => {
    try {
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      parsed.hook_event_name ??= process.argv[1];
      process.stdout.write(JSON.stringify(parsed));
    } catch {
      process.stdout.write(JSON.stringify({ hook_event_name: process.argv[1] }));
    }
  });
' "$event_name" | "$mind_palace_bin" hook-stdin codex "$db_path" 2>/dev/null || printf '{}\n'

exit 0
