-- Additive: historical communication rows remain untouched.
CREATE TABLE thematic_watch (
 id TEXT PRIMARY KEY,
 week TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(json_valid(payload)),
 provenance TEXT NOT NULL CHECK(provenance IN ('LinkedIn','newsletter reçue','recherche web','ajout manuel')),
 author TEXT NOT NULL,
 protected INTEGER NOT NULL DEFAULT 0 CHECK(protected IN (0,1)),
 mutation_id TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1,
 deleted_at TEXT NOT NULL DEFAULT '',
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX thematic_watch_week ON thematic_watch(week,deleted_at);
-- Aliases survive edits and deletion: an old URL or title cannot be re-imported.
CREATE TABLE thematic_watch_keys (
 key TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES thematic_watch(id)
);
CREATE TABLE thematic_watch_runs (
 id TEXT PRIMARY KEY,
 week TEXT NOT NULL,
 coverage TEXT NOT NULL,
 checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
