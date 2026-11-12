-- Apply structural/default changes without propagating them to other source views.
DROP TRIGGER communication_partnership_sync;
-- Keep removed sheets and their source data archived; hide them from the workspace.
-- TOP 10 duplicates stay preserved. Any unique fiche is retained in Parrainage.
UPDATE communication_rows SET sheet_id=(SELECT id FROM communication_sheets WHERE collection='partenariats' AND title='Parrainage' AND guide=0 LIMIT 1)
WHERE sheet_id IN (SELECT id FROM communication_sheets WHERE collection='partenariats' AND lower(title) LIKE '%top%10%')
AND EXISTS(SELECT 1 FROM communication_sheets WHERE collection='partenariats' AND title='Parrainage' AND guide=0)
AND NOT EXISTS(SELECT 1 FROM communication_partnership_entities e JOIN communication_partnership_entities other ON other.entity_id=e.entity_id JOIN communication_rows r ON r.id=other.row_id JOIN communication_sheets sh ON sh.id=r.sheet_id WHERE e.row_id=communication_rows.id AND sh.title='Parrainage' AND r.deleted_at IS NULL);
UPDATE communication_sheets SET guide=1 WHERE collection='partenariats' AND (lower(title) LIKE '%top%10%' OR lower(title)='qui parraine quoi');
UPDATE communication_rows SET cells_json=json_insert(cells_json,'$[#]','') WHERE sheet_id IN (SELECT id FROM communication_sheets WHERE collection='partenariats' AND guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(columns_json) WHERE value='Attribution'));
UPDATE communication_sheets SET columns_json=json_insert(columns_json,'$[#]','Attribution') WHERE collection='partenariats' AND guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(columns_json) WHERE value='Attribution');
-- Every destination can preserve source-specific fields in Notes.
UPDATE communication_rows SET cells_json=json_insert(cells_json,'$[#]','') WHERE sheet_id IN (SELECT id FROM communication_sheets WHERE guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(columns_json) WHERE value='Notes'));
UPDATE communication_sheets SET columns_json=json_insert(columns_json,'$[#]','Notes') WHERE guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(columns_json) WHERE value='Notes');
-- Only fill missing statuses; never overwrite an existing status or an archived fiche.
UPDATE communication_rows SET cells_json=json_set(cells_json,'$['||(SELECT key FROM communication_sheets s,json_each(s.columns_json) c WHERE s.id=communication_rows.sheet_id AND c.value='Statut')||']','À contacter'),version=version+1
WHERE deleted_at IS NULL AND sheet_id IN (SELECT id FROM communication_sheets WHERE collection IN ('suivimedias','partenariats') AND guide=0)
AND EXISTS(SELECT 1 FROM communication_sheets s,json_each(s.columns_json) c WHERE s.id=communication_rows.sheet_id AND c.value='Statut' AND trim(COALESCE(json_extract(cells_json,'$['||c.key||']'),''))='');
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

DROP TRIGGER media_assignment_insert;
DROP TRIGGER media_assignment_update;
CREATE TRIGGER communication_assignment_insert AFTER INSERT ON communication_rows
WHEN NEW.deleted_at IS NULL AND EXISTS(SELECT 1 FROM communication_sheets s,json_each(s.columns_json) a WHERE s.id=NEW.sheet_id AND s.collection IN ('suivimedias','partenariats') AND s.guide=0 AND a.value='Attribution' AND json_extract(NEW.cells_json,'$['||a.key||']') IN ('Charlotte','Candice','Pauline') )
BEGIN
 INSERT INTO communication_media_tasks(row_id,task_id) VALUES(COALESCE((SELECT entity_id FROM communication_partnership_entities WHERE row_id=NEW.id),NEW.id),lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6)))) ON CONFLICT(row_id) DO NOTHING;
 INSERT INTO team_tasks(id,title,description,person,status,created_by,updated_by,created_at,updated_at)
 SELECT (SELECT task_id FROM communication_media_tasks WHERE row_id=COALESCE((SELECT entity_id FROM communication_partnership_entities WHERE row_id=NEW.id),NEW.id)),substr(CASE s.collection WHEN 'suivimedias' THEN 'Média : ' ELSE 'Partenariat : ' END||COALESCE(NULLIF((SELECT json_extract(NEW.cells_json,'$['||n.key||']') FROM json_each(s.columns_json) n WHERE n.value IN ('Nom média','Nom','Structure ou personne','Association') ORDER BY CAST(n.key AS INTEGER) LIMIT 1),''),'Fiche à suivre'),1,180),
 'Suivi de la fiche : https://euneos.fr/interne/communication/'||s.collection,json_extract(NEW.cells_json,'$['||a.key||']'),'en-cours',NEW.updated_by,NEW.updated_by,NEW.updated_at,NEW.updated_at
 FROM communication_sheets s,json_each(s.columns_json) a WHERE s.id=NEW.sheet_id AND a.value='Attribution'
 ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,person=excluded.person,status='en-cours',completed_at='',archived_at='',deleted_at='',contributors=(SELECT json_group_array(value) FROM json_each(team_tasks.contributors) WHERE value<>excluded.person),updated_by=excluded.updated_by,updated_at=excluded.updated_at,version=team_tasks.version+1;
END;
CREATE TRIGGER communication_assignment_update AFTER UPDATE OF cells_json,sheet_id ON communication_rows
WHEN NEW.deleted_at IS NULL AND EXISTS(SELECT 1 FROM communication_sheets s,json_each(s.columns_json) a WHERE s.id=NEW.sheet_id AND s.collection IN ('suivimedias','partenariats') AND s.guide=0 AND a.value='Attribution' AND json_extract(NEW.cells_json,'$['||a.key||']') IN ('Charlotte','Candice','Pauline') AND (OLD.sheet_id<>NEW.sheet_id OR json_extract(OLD.cells_json,'$['||a.key||']') IS NOT json_extract(NEW.cells_json,'$['||a.key||']')))
BEGIN
 INSERT INTO communication_media_tasks(row_id,task_id) VALUES(COALESCE((SELECT entity_id FROM communication_partnership_entities WHERE row_id=NEW.id),NEW.id),lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6)))) ON CONFLICT(row_id) DO NOTHING;
 INSERT INTO team_tasks(id,title,description,person,status,created_by,updated_by,created_at,updated_at)
 SELECT (SELECT task_id FROM communication_media_tasks WHERE row_id=COALESCE((SELECT entity_id FROM communication_partnership_entities WHERE row_id=NEW.id),NEW.id)),substr(CASE s.collection WHEN 'suivimedias' THEN 'Média : ' ELSE 'Partenariat : ' END||COALESCE(NULLIF((SELECT json_extract(NEW.cells_json,'$['||n.key||']') FROM json_each(s.columns_json) n WHERE n.value IN ('Nom média','Nom','Structure ou personne','Association') ORDER BY CAST(n.key AS INTEGER) LIMIT 1),''),'Fiche à suivre'),1,180),
 'Suivi de la fiche : https://euneos.fr/interne/communication/'||s.collection,json_extract(NEW.cells_json,'$['||a.key||']'),'en-cours',NEW.updated_by,NEW.updated_by,NEW.updated_at,NEW.updated_at
 FROM communication_sheets s,json_each(s.columns_json) a WHERE s.id=NEW.sheet_id AND a.value='Attribution'
 ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,person=excluded.person,status='en-cours',completed_at='',archived_at='',deleted_at='',contributors=(SELECT json_group_array(value) FROM json_each(team_tasks.contributors) WHERE value<>excluded.person),updated_by=excluded.updated_by,updated_at=excluded.updated_at,version=team_tasks.version+1;
END;
-- A moved fiche becomes independent of its former linked partnership views.
CREATE TABLE communication_row_moves (
 id INTEGER PRIMARY KEY,
 row_id TEXT NOT NULL REFERENCES communication_rows(id),
 source_sheet_id TEXT NOT NULL REFERENCES communication_sheets(id),
 target_sheet_id TEXT NOT NULL REFERENCES communication_sheets(id),
 source_cells_json TEXT NOT NULL,
 moved_by TEXT NOT NULL,
 moved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER communication_move_before BEFORE UPDATE OF sheet_id ON communication_rows WHEN OLD.sheet_id<>NEW.sheet_id
BEGIN
 INSERT INTO communication_row_moves(row_id,source_sheet_id,target_sheet_id,source_cells_json,moved_by) VALUES(OLD.id,OLD.sheet_id,NEW.sheet_id,OLD.cells_json,NEW.updated_by);
 DELETE FROM communication_partnership_entities WHERE row_id=OLD.id;
END;
CREATE TRIGGER communication_move_choices AFTER UPDATE OF sheet_id ON communication_rows WHEN OLD.sheet_id<>NEW.sheet_id
BEGIN
 INSERT OR IGNORE INTO communication_choices(id,scope,column_name,value)
 SELECT lower(hex(randomblob(16))),CASE WHEN c.value='Statut' AND s.collection<>'suivimedias' THEN 'status' ELSE s.collection END,c.value,json_extract(NEW.cells_json,'$['||c.key||']')
 FROM communication_sheets s,json_each(s.columns_json) c
 WHERE s.id=NEW.sheet_id AND c.value IN ('Type de média','Type','Statut','Priorité','Vivier','Public principal') AND trim(COALESCE(json_extract(NEW.cells_json,'$['||c.key||']'),''))<>'';
END;
-- Keep an existing task's source link usable when its standalone fiche moves.
CREATE TRIGGER communication_move_task_link AFTER UPDATE OF sheet_id ON communication_rows WHEN OLD.sheet_id<>NEW.sheet_id
BEGIN
 UPDATE team_tasks SET description='Suivi de la fiche : https://euneos.fr/interne/communication/'||(SELECT collection FROM communication_sheets WHERE id=NEW.sheet_id),updated_by=NEW.updated_by,updated_at=NEW.updated_at,version=version+1 WHERE id=(SELECT task_id FROM communication_media_tasks WHERE row_id=NEW.id);
END;
