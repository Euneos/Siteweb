-- Manual corrections are separate from attachment-only audits. Raw Google sources remain immutable.
CREATE TABLE google_review_corrections (
 id TEXT PRIMARY KEY,
 journal_id INTEGER NOT NULL CHECK(journal_id > 0),
 source_key TEXT NOT NULL,
 source_version TEXT NOT NULL,
 target_key TEXT NOT NULL,
 actor TEXT NOT NULL,
 plan_hash TEXT NOT NULL,
 plan_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('prepared','writing','uncertain','complete','conflict')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 verified_at TEXT,
 result_json TEXT
);
CREATE INDEX google_review_corrections_source ON google_review_corrections(journal_id,created_at);
CREATE UNIQUE INDEX google_review_corrections_source_busy ON google_review_corrections(source_key)
 WHERE state IN ('writing','uncertain');
CREATE UNIQUE INDEX google_review_corrections_target_busy ON google_review_corrections(target_key)
 WHERE state IN ('writing','uncertain');
