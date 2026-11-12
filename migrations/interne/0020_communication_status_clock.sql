-- Keep the waiting period independent from edits to notes or other fields.
ALTER TABLE communication_rows ADD COLUMN status_changed_at TEXT;
UPDATE communication_rows SET status_changed_at=updated_at;
CREATE TRIGGER communication_status_insert AFTER INSERT ON communication_rows
BEGIN
 UPDATE communication_rows SET status_changed_at=NEW.updated_at WHERE id=NEW.id;
END;
CREATE TRIGGER communication_status_change AFTER UPDATE OF cells_json ON communication_rows
WHEN EXISTS (
 SELECT 1 FROM communication_sheets s,json_each(s.columns_json) c
 WHERE s.id=NEW.sheet_id AND c.value='Statut'
 AND json_extract(OLD.cells_json,'$['||c.key||']') IS NOT json_extract(NEW.cells_json,'$['||c.key||']')
)
BEGIN
 UPDATE communication_rows SET status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
