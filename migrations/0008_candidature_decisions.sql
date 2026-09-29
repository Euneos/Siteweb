-- Prospective decisions only. No backfill; no NocoDB/status/email trigger.
CREATE TABLE candidature_decisions (
 id TEXT PRIMARY KEY REFERENCES candidature_mails(id),
 participation_id INTEGER NOT NULL,
 actor TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('accepted','refused')),
 state TEXT NOT NULL CHECK(state IN ('draft','writing','saved','review','cancelled')),
 snapshot TEXT NOT NULL,
 preview_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 write_started INTEGER NOT NULL DEFAULT 0 CHECK(write_started IN (0,1)),
 with_email INTEGER CHECK(with_email IN (0,1)),
 saved_status TEXT,
 saved_at TEXT,
 error_code TEXT
);
CREATE UNIQUE INDEX candidature_decisions_pending ON candidature_decisions(participation_id)
 WHERE state IN ('draft','writing','review');
