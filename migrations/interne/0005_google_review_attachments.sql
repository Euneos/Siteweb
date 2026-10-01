-- Private audit and durable claim for manual Google-response attachment.
-- Additive: calendars, hours, comments and resources are untouched.
CREATE TABLE google_review_attachments (
  journal_id INTEGER PRIMARY KEY CHECK (journal_id > 0),
  source_key TEXT NOT NULL CHECK (length(source_key) > 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete')),
  audit_json TEXT NOT NULL,
  before_detail TEXT NOT NULL,
  after_detail TEXT NOT NULL
);
