-- Existing tasks remain active. Deletion is retained for 30 days before cleanup.
ALTER TABLE team_tasks ADD COLUMN deleted_at TEXT NOT NULL DEFAULT '';
CREATE INDEX team_tasks_deleted_at ON team_tasks(deleted_at);
-- Purging one expired task and its notification records is a single atomic statement.
CREATE TRIGGER team_tasks_delete_notifications BEFORE DELETE ON team_tasks
BEGIN
  DELETE FROM team_task_notifications WHERE task_id = OLD.id;
END;
