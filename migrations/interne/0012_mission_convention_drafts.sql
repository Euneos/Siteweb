CREATE TABLE mission_convention_drafts (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  payload TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  submitted_id TEXT REFERENCES mission_conventions(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX mission_convention_drafts_owner ON mission_convention_drafts(owner_email);
