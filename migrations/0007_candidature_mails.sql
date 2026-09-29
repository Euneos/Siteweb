-- No backfill, status trigger, remote hook or email is executed by this migration.
CREATE TABLE candidature_mails (
  id TEXT PRIMARY KEY,
  participation_id INTEGER NOT NULL,
  school_id INTEGER NOT NULL,
  cohort_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('ar','accepted','refused')),
  source TEXT NOT NULL CHECK(source IN ('site_submission','interactive_decision')),
  submission_key TEXT,
  state TEXT NOT NULL CHECK(state IN ('awaiting_receipt','draft','queued','sending','accepted','rejected','uncertain','cancelled')),
  payload TEXT NOT NULL,
  preview_hash TEXT NOT NULL,
  template_version TEXT NOT NULL,
  approval_ref TEXT,
  issuer TEXT NOT NULL,
  before_status TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempt_id TEXT,
  attempt_started_at TEXT,
  message_id TEXT,
  provider_state TEXT,
  last_error TEXT,
  CHECK ((kind='ar' AND source='site_submission' AND submission_key IS NOT NULL)
    OR (kind!='ar' AND source='interactive_decision' AND submission_key IS NULL))
);
CREATE UNIQUE INDEX candidature_mails_submission ON candidature_mails(submission_key) WHERE submission_key IS NOT NULL;
-- An expired or cancelled draft is not an email. Sent/uncertain decisions cannot
-- be recreated under a different UUID to circumvent deduplication.
CREATE UNIQUE INDEX candidature_mails_dossier_kind ON candidature_mails(participation_id,kind) WHERE state!='cancelled';
CREATE UNIQUE INDEX candidature_mails_decision_pending ON candidature_mails(participation_id)
  WHERE kind!='ar' AND state IN ('draft','queued','sending','uncertain');
CREATE INDEX candidature_mails_queue ON candidature_mails(state,created_at);
CREATE TABLE candidature_mail_attempts (
  id TEXT PRIMARY KEY,
  mail_id TEXT NOT NULL REFERENCES candidature_mails(id),
  created_at TEXT NOT NULL,
  state TEXT NOT NULL,
  http_status INTEGER,
  message_id TEXT
);
CREATE TABLE candidature_mail_events (
  event_key TEXT PRIMARY KEY,
  mail_id TEXT NOT NULL REFERENCES candidature_mails(id),
  message_id TEXT NOT NULL,
  event TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
-- The same SQLite statement which completes the candidature makes its prepared
-- AR dispatchable. No historic row is scanned or created by this trigger.
CREATE TRIGGER candidature_mail_complete AFTER UPDATE OF state ON form_submissions
WHEN NEW.form_type='etablissement' AND NEW.state='complete' AND NEW.phase='saved'
 AND OLD.state='processing'
BEGIN
  UPDATE candidature_mails SET state='queued',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE submission_key=NEW.submission_key AND state='awaiting_receipt'
    AND participation_id=NEW.record_id AND school_id=NEW.parent_id AND cohort_id=NEW.cohort_id;
END;
-- An attempt record is atomic with the sending claim. A dead worker leaves
-- sending/uncertain, never a lease that another worker can resend on expiry.
CREATE TRIGGER candidature_mail_attempt AFTER UPDATE OF state ON candidature_mails
WHEN NEW.state='sending' AND OLD.state='queued'
BEGIN
 INSERT INTO candidature_mail_attempts(id,mail_id,created_at,state)
 VALUES(NEW.attempt_id,NEW.id,NEW.attempt_started_at,'sending');
END;
