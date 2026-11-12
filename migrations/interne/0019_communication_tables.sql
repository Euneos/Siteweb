-- Private source data is imported separately, never embedded in repository code.
CREATE TABLE communication_sheets (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL CHECK (collection IN ('suivimedias','partenariats','veille')),
  title TEXT NOT NULL,
  columns_json TEXT NOT NULL CHECK (json_valid(columns_json)),
  guide INTEGER NOT NULL DEFAULT 0 CHECK (guide IN (0,1)),
  position INTEGER NOT NULL
);
CREATE TABLE communication_rows (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES communication_sheets(id),
  cells_json TEXT NOT NULL CHECK (json_valid(cells_json)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX communication_rows_sheet ON communication_rows(sheet_id);
