-- Binary files stay in private R2. No original filename, email or image bytes here.
CREATE TABLE workspace_images (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES workspace_entries(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png','image/jpeg')),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 5242880),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','attached','retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX workspace_images_cleanup ON workspace_images(state, created_at);
CREATE TABLE workspace_entry_images (
  entry_id TEXT PRIMARY KEY REFERENCES workspace_entries(id),
  image_id TEXT UNIQUE REFERENCES workspace_images(id),
  version INTEGER NOT NULL DEFAULT 1
);
-- Pointer + retirement change atomically, even if the R2 cleanup later fails.
-- Keep the empty slot and its version after deletion to prevent stale uploads.
CREATE TRIGGER workspace_image_insert AFTER INSERT ON workspace_entry_images
BEGIN
  UPDATE workspace_images SET state='attached' WHERE id=NEW.image_id;
END;
CREATE TRIGGER workspace_image_replace AFTER UPDATE OF image_id ON workspace_entry_images
BEGIN
  UPDATE workspace_images SET state='retired' WHERE id=OLD.image_id;
  UPDATE workspace_images SET state='attached' WHERE id=NEW.image_id;
END;
