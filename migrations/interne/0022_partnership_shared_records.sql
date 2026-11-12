CREATE TABLE communication_partnership_entities (
 row_id TEXT PRIMARY KEY REFERENCES communication_rows(id) ON DELETE CASCADE,
 entity_id TEXT NOT NULL
);
INSERT INTO communication_partnership_entities(row_id,entity_id)
SELECT r.id, (SELECT MIN(r2.id) FROM communication_rows r2 JOIN communication_sheets s2 ON s2.id=r2.sheet_id JOIN json_each(s2.columns_json) n2 ON n2.value='Nom'
 WHERE s2.collection='partenariats' AND trim(json_extract(r2.cells_json,'$['||n2.key||']'))=trim(json_extract(r.cells_json,'$['||n.key||']')))
FROM communication_rows r JOIN communication_sheets s ON s.id=r.sheet_id JOIN json_each(s.columns_json) n ON n.value='Nom'
WHERE s.collection='partenariats' AND trim(json_extract(r.cells_json,'$['||n.key||']'))<>'';
CREATE INDEX communication_partnership_entity ON communication_partnership_entities(entity_id);
CREATE TRIGGER communication_partnership_sync AFTER UPDATE OF cells_json ON communication_rows
WHEN OLD.cells_json<>NEW.cells_json AND EXISTS(SELECT 1 FROM communication_partnership_entities WHERE row_id=NEW.id)
BEGIN
 UPDATE communication_rows SET cells_json=(
 SELECT json_group_array(CASE WHEN source.key IS NOT NULL THEN json_extract(NEW.cells_json,'$['||source.key||']') ELSE json_extract(communication_rows.cells_json,'$['||target.key||']') END)
 FROM communication_sheets ts JOIN json_each(ts.columns_json) target
 LEFT JOIN communication_sheets ss ON ss.id=NEW.sheet_id
 LEFT JOIN json_each(ss.columns_json) source ON source.value=target.value
 WHERE ts.id=communication_rows.sheet_id
 ),version=version+1,updated_by=NEW.updated_by,updated_at=NEW.updated_at
 WHERE id<>NEW.id AND id IN (SELECT row_id FROM communication_partnership_entities WHERE entity_id=(SELECT entity_id FROM communication_partnership_entities WHERE row_id=NEW.id))
 AND cells_json<>(SELECT json_group_array(CASE WHEN source.key IS NOT NULL THEN json_extract(NEW.cells_json,'$['||source.key||']') ELSE json_extract(communication_rows.cells_json,'$['||target.key||']') END)
 FROM communication_sheets ts JOIN json_each(ts.columns_json) target
 LEFT JOIN communication_sheets ss ON ss.id=NEW.sheet_id
 LEFT JOIN json_each(ss.columns_json) source ON source.value=target.value WHERE ts.id=communication_rows.sheet_id);
END;
