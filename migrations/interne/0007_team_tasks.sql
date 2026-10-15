CREATE TABLE team_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 4000),
  person TEXT NOT NULL CHECK(person IN ('Candice', 'Charlotte', 'Pauline')),
  status TEXT NOT NULL CHECK(status IN ('en-cours', 'today', 'en-attente')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
