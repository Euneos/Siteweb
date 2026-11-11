-- Point the shared study catalogue at the French PDF, never its parent folder.
-- The trainer library and CA resources both consume workspace_resources.
UPDATE workspace_resources
SET url = 'https://drive.google.com/file/d/1guC2NUHHhTqDCkq-BMIQmgci7_wP000H/view'
WHERE id = '465ae9f3-9fa2-4c02-84a8-76d5ea4caeb7'
   OR url LIKE 'https://drive.google.com/file/d/1v7g2lRDpnYJhosRC-TLvTKIYfMEaXOGW/%'
   OR url LIKE 'https://drive.google.com/drive/folders/1f8LriiI66en89twgxY7Y91znDwnZVoG0%';

UPDATE workspace_resources
SET title = 'É' || substr(title, 2)
WHERE title LIKE 'Etude%'
  AND url = 'https://drive.google.com/file/d/1guC2NUHHhTqDCkq-BMIQmgci7_wP000H/view';
