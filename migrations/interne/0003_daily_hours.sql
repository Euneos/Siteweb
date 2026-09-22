-- Preserve legacy totals; daily allocation requires explicit user input.
ALTER TABLE workspace_entries ADD COLUMN daily_hours TEXT NOT NULL DEFAULT '';
