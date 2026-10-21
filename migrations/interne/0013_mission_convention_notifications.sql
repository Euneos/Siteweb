ALTER TABLE mission_conventions ADD COLUMN fees_euros REAL CHECK(fees_euros IS NULL OR (fees_euros >= 0 AND fees_euros <= 100000));

CREATE TABLE mission_convention_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id TEXT NOT NULL REFERENCES mission_conventions(id),
  kind TEXT NOT NULL CHECK(kind IN ('submitted', 'trainer_signed')),
  trainer_name TEXT NOT NULL,
  school_names TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','unavailable','uncertain','preview')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX mission_convention_notifications_convention ON mission_convention_notifications(convention_id, id);

-- Events are committed atomically with the business write. Existing rows are not replayed.
CREATE TRIGGER mission_convention_submitted_notification
AFTER INSERT ON mission_conventions WHEN NEW.state = 'submitted'
BEGIN
  INSERT INTO mission_convention_notifications(convention_id,kind,trainer_name,school_names)
  VALUES(NEW.id,'submitted',json_extract(NEW.payload,'$.nom'),
    (SELECT group_concat(json_extract(value,'$.etablissement'),', ') FROM json_each(NEW.payload,'$.missions')));
END;

CREATE TRIGGER mission_convention_resubmitted_notification
AFTER UPDATE OF state ON mission_conventions WHEN NEW.state = 'submitted' AND OLD.state <> 'submitted'
BEGIN
  INSERT INTO mission_convention_notifications(convention_id,kind,trainer_name,school_names)
  VALUES(NEW.id,'submitted',json_extract(NEW.payload,'$.nom'),
    (SELECT group_concat(json_extract(value,'$.etablissement'),', ') FROM json_each(NEW.payload,'$.missions')));
END;

CREATE TRIGGER mission_convention_signed_notification
AFTER INSERT ON mission_convention_files WHEN NEW.kind = 'trainer_signed'
BEGIN
  INSERT INTO mission_convention_notifications(convention_id,kind,trainer_name,school_names)
  SELECT id,'trainer_signed',json_extract(payload,'$.nom'),
    (SELECT group_concat(json_extract(value,'$.etablissement'),', ') FROM json_each(payload,'$.missions'))
  FROM mission_conventions WHERE id = NEW.convention_id;
END;
