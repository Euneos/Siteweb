-- Additive: existing tasks keep their owner; no historical notification is sent.
ALTER TABLE team_tasks ADD COLUMN contributors TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(contributors) AND json_type(contributors) = 'array');
ALTER TABLE team_task_notifications ADD COLUMN previous_person TEXT NOT NULL DEFAULT '';
ALTER TABLE team_task_notifications ADD COLUMN previous_state TEXT NOT NULL DEFAULT 'pending'
  CHECK(previous_state IN ('pending', 'sending', 'sent', 'unavailable', 'uncertain', 'preview'));
ALTER TABLE team_task_notifications ADD COLUMN contributors TEXT NOT NULL DEFAULT '[]';
