export const sqliteSchema = `
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  memory_id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  why_text TEXT,
  how_to_apply TEXT,
  references_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_from_event_id TEXT NOT NULL,
  last_updated_from_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  event_id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  cursor_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  last_event_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_space_created_at
  ON events(space_id, created_at);

CREATE INDEX IF NOT EXISTS idx_memories_space_status
  ON memories(space_id, status);

CREATE INDEX IF NOT EXISTS idx_memories_space_updated_at
  ON memories(space_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbox_status_available_at
  ON outbox(status, available_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_cursors_unique_scope
  ON sync_cursors(scope, owner_id, space_id);
`;
