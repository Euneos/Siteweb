-- Preserve legacy totals; daily allocation requires explicit user input.
-- Apply after 0003_editorial_statuses.sql, which rebuilds workspace_entries.
-- Never replay 0003 after this migration: its old schema omits daily_hours.
ALTER TABLE workspace_entries ADD COLUMN daily_hours TEXT NOT NULL DEFAULT '';
