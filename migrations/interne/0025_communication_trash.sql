ALTER TABLE communication_rows ADD COLUMN deleted_at TEXT;
ALTER TABLE communication_rows ADD COLUMN deleted_by TEXT;
CREATE INDEX communication_rows_trash ON communication_rows(sheet_id,deleted_at);
