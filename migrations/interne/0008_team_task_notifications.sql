-- Record only new assignments, atomically with the task write. No historical emails.
CREATE TABLE team_task_notifications (
  task_id TEXT NOT NULL REFERENCES team_tasks(id),
  task_version INTEGER NOT NULL,
  person TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_status TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending', 'sending', 'sent', 'unavailable', 'uncertain', 'preview')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, task_version)
);
