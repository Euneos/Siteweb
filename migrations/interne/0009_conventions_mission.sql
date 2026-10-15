-- Conventions distinctes du catalogue de ressources et des dossiers NocoDB.
-- Les PDF sont privés et limités à 750 Ko par version (limite contrôlée côté serveur).
CREATE TABLE mission_conventions (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('submitted','changes_requested','approved','trainer_signed','complete')),
  payload TEXT NOT NULL,
  case2_euros INTEGER NOT NULL DEFAULT 0 CHECK (case2_euros >= 0),
  fees_decision TEXT NOT NULL DEFAULT '' CHECK (fees_decision IN ('','aucun','accord')),
  fees_details TEXT NOT NULL DEFAULT '',
  representative TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX mission_conventions_owner ON mission_conventions(owner_email, created_at);
CREATE TABLE mission_convention_files (
  convention_id TEXT NOT NULL REFERENCES mission_conventions(id),
  kind TEXT NOT NULL CHECK (kind IN ('approved','trainer_signed','complete')),
  pdf BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (convention_id, kind)
);
