-- Technical receipt only; source contact data is imported privately by CI.
CREATE TABLE communication_import_receipts (
 seed_sha256 TEXT PRIMARY KEY,
 code_sha TEXT NOT NULL,
 imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
