ALTER TABLE mission_conventions ADD COLUMN case2_amount_pending INTEGER NOT NULL DEFAULT 0 CHECK(case2_amount_pending IN (0,1));

CREATE TABLE mission_convention_revisions (
  id TEXT PRIMARY KEY,
  convention_id TEXT NOT NULL REFERENCES mission_conventions(id),
  previous_updated_at TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  pdf BLOB NOT NULL,
  sha256 TEXT NOT NULL,
  reason TEXT NOT NULL,
  revised_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(convention_id, previous_updated_at)
);

-- An administrative revision is not a new trainer submission.
DROP TRIGGER mission_convention_resubmitted_notification;
CREATE TRIGGER mission_convention_resubmitted_notification
AFTER UPDATE OF state ON mission_conventions WHEN NEW.state = 'submitted' AND OLD.state = 'changes_requested'
BEGIN
  INSERT INTO mission_convention_notifications(convention_id,kind,trainer_name,school_names)
  VALUES(NEW.id,'submitted',json_extract(NEW.payload,'$.nom'),
    (SELECT group_concat(json_extract(value,'$.etablissement'),', ') FROM json_each(NEW.payload,'$.missions')));
END;
