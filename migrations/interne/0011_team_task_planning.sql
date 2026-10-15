-- Completion is separate from the legacy three-state column so no task or receipt is rebuilt.
ALTER TABLE team_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK(priority IN (0, 1));
ALTER TABLE team_tasks ADD COLUMN due_on TEXT NOT NULL DEFAULT '';
ALTER TABLE team_tasks ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0, 1));
ALTER TABLE team_tasks ADD COLUMN blocker TEXT NOT NULL DEFAULT '';
ALTER TABLE team_tasks ADD COLUMN completed_at TEXT NOT NULL DEFAULT '';
ALTER TABLE team_tasks ADD COLUMN archived_at TEXT NOT NULL DEFAULT '' CHECK(archived_at = '' OR completed_at <> '');
