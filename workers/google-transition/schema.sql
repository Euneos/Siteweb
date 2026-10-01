-- New, separate worker state. Apply locally for tests; deployment is a separate operation.
-- Raw payloads are private evidence. Do not reset receipts or revision counters.
CREATE TABLE IF NOT EXISTS google_transition_poller (
  response_key TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  raw_payload TEXT NOT NULL,
  capture_state TEXT NOT NULL DEFAULT 'pending',
  noco_id INTEGER,
  projection_eligible INTEGER NOT NULL DEFAULT 0,
  projection_payload TEXT,
  projection_outcome TEXT,
  projection_complete INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(source_key, source_row, revision)
);
CREATE INDEX IF NOT EXISTS google_transition_pending
  ON google_transition_poller(next_attempt_at, updated_at);
CREATE TABLE IF NOT EXISTS google_transition_runs (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  next_source INTEGER NOT NULL DEFAULT 0,
  last_result TEXT
);
CREATE TABLE IF NOT EXISTS google_transition_sources (
  source_key TEXT PRIMARY KEY,
  next_row INTEGER NOT NULL
);

-- Additive migration: durable cross-response guard, never expire/reset after
-- an uncertain create. This is separate from the short-lived polling lease.
CREATE TABLE IF NOT EXISTS google_transition_person_claims (
  identity_key TEXT PRIMARY KEY,
  response_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
