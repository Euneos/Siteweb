-- Technical journal only: NO form payload, name, email, source text or API token.
CREATE TABLE IF NOT EXISTS operational_submissions (
  link_hash TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  school_id INTEGER NOT NULL,
  cohort_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('contact','deploiement','participants')),
  receipt TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('processing','retryable','review','complete')),
  code TEXT NOT NULL,
  mutation_started INTEGER NOT NULL DEFAULT 0 CHECK (mutation_started IN (0,1)),
  adult_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operational_submissions_recent ON operational_submissions(created_at DESC);
-- No TTL: an uncertain write holds the target until an operator reconciles it.
CREATE TABLE IF NOT EXISTS operational_submission_locks (
  target_id INTEGER PRIMARY KEY,
  link_hash TEXT NOT NULL UNIQUE,
  acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
