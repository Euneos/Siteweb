-- Private, bounded source evidence for the temporary Google bridge.
-- Includes unmapped answers and conflicting contents of the same revision.
-- No tokens. Never expose this table through the public site or logs.
CREATE TABLE IF NOT EXISTS google_form_transition_captures (
  capture_key TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_key, payload_hash)
);
CREATE INDEX IF NOT EXISTS google_form_transition_capture_review
  ON google_form_transition_captures(code, created_at);

CREATE INDEX IF NOT EXISTS google_form_events_revision
  ON google_form_events(source_key, source_revision);
