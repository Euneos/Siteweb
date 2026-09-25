-- Extend accepted editorial statuses without rewriting any stored value.
-- Run atomically, with foreign key enforcement enabled, as migration 0002.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE workspace_entries_editorial (
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
  status TEXT NOT NULL CHECK (status IN ('brouillon','a_valider','valide','programme','publie','annule','en_cours','a_creer','a_modifier')),
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
INSERT INTO workspace_entries_editorial SELECT * FROM workspace_entries;
CREATE TABLE workspace_comments_editorial (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES workspace_entries_editorial(id),
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO workspace_comments_editorial SELECT * FROM workspace_comments;
DROP TABLE workspace_comments;
DROP TABLE workspace_entries;
ALTER TABLE workspace_entries_editorial RENAME TO workspace_entries;
ALTER TABLE workspace_comments_editorial RENAME TO workspace_comments;
CREATE INDEX workspace_entries_month ON workspace_entries(kind, starts_on, ends_on);
CREATE INDEX workspace_comments_entry ON workspace_comments(entry_id, created_at);
PRAGMA foreign_key_check;
