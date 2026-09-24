-- Private source history. Payload/before/patch may contain personal data.
-- Never publish/export these tables or log their content.
CREATE TABLE IF NOT EXISTS google_form_events (
  event_key TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK(source_revision > 0),
  payload_hash TEXT NOT NULL,
  source_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('contact','deploiement')),
  cohort_id INTEGER NOT NULL CHECK(cohort_id = 2),
  state TEXT NOT NULL CHECK(state IN ('processing','complete','review','retryable')),
  code TEXT NOT NULL,
  target_id INTEGER,
  payload TEXT NOT NULL,
  before_json TEXT,
  patch_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS google_form_events_source ON google_form_events(source_key, source_at);
CREATE INDEX IF NOT EXISTS google_form_events_review ON google_form_events(state, updated_at);
CREATE TABLE IF NOT EXISTS google_form_locks (
  target_id INTEGER PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
