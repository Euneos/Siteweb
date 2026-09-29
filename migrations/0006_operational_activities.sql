-- Extend only the allowed form kind; retain every existing token, receipt and lock.
-- 0005 belongs to the independent Google transition capture. This migration
-- depends only on 0003/0004 and is applied transactionally by the D1 migration runner.

CREATE TABLE operational_links_v2 (
  token_hash TEXT PRIMARY KEY,
  target_id INTEGER NOT NULL,
  school_id INTEGER NOT NULL,
  cohort_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('contact','deploiement','participants','activites-jeunes')),
  issuer_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO operational_links_v2 SELECT * FROM operational_links;
DROP TABLE operational_links;
ALTER TABLE operational_links_v2 RENAME TO operational_links;
CREATE TABLE operational_link_slots_v2 (
  target_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('contact','deploiement','participants','activites-jeunes')),
  token_hash TEXT NOT NULL,
  PRIMARY KEY(target_id,kind)
);
INSERT INTO operational_link_slots_v2 SELECT * FROM operational_link_slots;
DROP TABLE operational_link_slots;
ALTER TABLE operational_link_slots_v2 RENAME TO operational_link_slots;
CREATE TABLE operational_submissions_v2 (
  link_hash TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  school_id INTEGER NOT NULL,
  cohort_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('contact','deploiement','participants','activites-jeunes')),
  receipt TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('processing','retryable','review','complete')),
  code TEXT NOT NULL,
  mutation_started INTEGER NOT NULL DEFAULT 0 CHECK (mutation_started IN (0,1)),
  adult_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO operational_submissions_v2 SELECT * FROM operational_submissions;
DROP TABLE operational_submissions;
ALTER TABLE operational_submissions_v2 RENAME TO operational_submissions;
CREATE INDEX operational_submissions_recent ON operational_submissions(created_at DESC);
