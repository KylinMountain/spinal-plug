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
  semantic_key TEXT,
  origin TEXT,
  confidence REAL,
  source_event_ids_json TEXT NOT NULL DEFAULT '[]',
  superseded_by_memory_id TEXT,
  dispute_id TEXT,
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

CREATE TABLE IF NOT EXISTS sync_inbox (
  update_id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  update_kind TEXT NOT NULL,
  required INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  applied_at TEXT
);

-- Stores only extracted candidate drafts and a one-way source digest. The raw
-- prompt and model response never enter the Mind Palace database.
CREATE TABLE IF NOT EXISTS candidate_extraction_jobs (
  job_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  space_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
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

CREATE INDEX IF NOT EXISTS idx_sync_inbox_space_status
  ON sync_inbox(space_id, status, fetched_at);

CREATE INDEX IF NOT EXISTS idx_candidate_extraction_jobs_ready
  ON candidate_extraction_jobs(status, lease_expires_at, created_at);
`;
