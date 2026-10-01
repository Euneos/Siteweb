-- Technical receipts only. Answers are kept in the private NocoDB response table.
CREATE TABLE IF NOT EXISTS public_form_receipts (
  receipt TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  answers_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'processing',
  noco_id INTEGER,
  capture_started INTEGER NOT NULL DEFAULT 0,
  target_id INTEGER,
  school_id INTEGER,
  cohort_id INTEGER,
  code TEXT NOT NULL DEFAULT 'capture_pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS public_form_rate_limits (
  bucket TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
