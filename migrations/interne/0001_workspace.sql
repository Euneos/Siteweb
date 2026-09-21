-- Separate database/binding from the public form submission registry.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspace_entries (
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
  status TEXT NOT NULL CHECK (status IN ('brouillon','a_valider','valide','publie','annule')),
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
CREATE INDEX IF NOT EXISTS workspace_entries_month ON workspace_entries(kind, starts_on, ends_on);
CREATE TABLE IF NOT EXISTS workspace_comments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES workspace_entries(id),
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS workspace_comments_entry ON workspace_comments(entry_id, created_at);
CREATE TABLE IF NOT EXISTS workspace_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
