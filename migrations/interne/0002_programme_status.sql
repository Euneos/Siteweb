-- D1 applies this entire migration in one implicit transaction. SQLite callers
-- must also wrap the whole file in one transaction, with foreign_keys enabled.
-- Do not disable foreign_keys: deferred violations still fail at commit.
PRAGMA defer_foreign_keys = ON;

-- Only the status CHECK changes. Copy every stored field, including import
-- provenance, authors, versions and timestamps, without recomputing defaults.
CREATE TABLE workspace_entries_programme (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('editorial','equipe')),
  title TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  person TEXT NOT NULL,
  activity TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  attendance TEXT NOT NULL DEFAULT '' CHECK (attendance IN ('','presence','absence','conge')),
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('brouillon','a_valider','valide','programme','publie','annule')),
  hours REAL CHECK (hours >= 0 AND hours <= 744),
  notes TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source_id TEXT UNIQUE,
  source_payload TEXT,
  source_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO workspace_entries_programme (
  id, kind, title, starts_on, ends_on, person, activity, channel, attendance,
  location, status, hours, notes, content, link, created_by, updated_by, version,
  source_id, source_payload, source_fingerprint, created_at, updated_at
)
SELECT
  id, kind, title, starts_on, ends_on, person, activity, channel, attendance,
  location, status, hours, notes, content, link, created_by, updated_by, version,
  source_id, source_payload, source_fingerprint, created_at, updated_at
FROM workspace_entries;

-- Rebuild the referencing table against the replacement parent before dropping
-- either original. Dropping a referenced parent alone leaves a deferred FK
-- violation even after a replacement is renamed into its place in SQLite.
CREATE TABLE workspace_comments_programme (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES workspace_entries_programme(id),
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO workspace_comments_programme (id, entry_id, author, content, created_at)
SELECT id, entry_id, author, content, created_at FROM workspace_comments;

DROP TABLE workspace_comments;
DROP TABLE workspace_entries;
-- SQLite updates the replacement comments' FK target during this rename.
ALTER TABLE workspace_entries_programme RENAME TO workspace_entries;
ALTER TABLE workspace_comments_programme RENAME TO workspace_comments;

CREATE INDEX workspace_entries_month ON workspace_entries(kind, starts_on, ends_on);
CREATE INDEX workspace_comments_entry ON workspace_comments(entry_id, created_at);
-- workspace_resources is untouched. The transaction commit checks all FKs and
-- resets defer_foreign_keys; leave enforcement enabled through that commit.
PRAGMA foreign_key_check;
