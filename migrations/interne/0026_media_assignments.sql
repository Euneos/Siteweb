-- Additive media ownership; existing cells and tasks are preserved.
UPDATE communication_rows SET cells_json=json_insert(cells_json,'$[#]','')
WHERE sheet_id IN (SELECT id FROM communication_sheets WHERE collection='suivimedias' AND guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(columns_json) WHERE value='Attribution'));
UPDATE communication_sheets SET columns_json=json_insert(columns_json,'$[#]','Attribution')
WHERE collection='suivimedias' AND guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(columns_json) WHERE value='Attribution');
INSERT INTO communication_choices(id,scope,column_name,value,role)
SELECT 'media-status-'||key,'suivimedias','Statut',value,'' FROM json_each('["À contacter","Contacté","En discussion","Partenariat","En attente","Refus"]');
-- Preserve any custom status labels, aliases and retired choices in the media menu.
INSERT OR IGNORE INTO communication_choices(id,scope,column_name,value,role,version,deleted_at)
SELECT 'media-custom-'||id,'suivimedias','Statut',value,role,version,deleted_at FROM communication_choices
WHERE scope='status' AND column_name='Statut' AND role NOT IN ('contact','waiting','followup','cancelled','accepted');
INSERT OR IGNORE INTO communication_choice_aliases(scope,column_name,value,choice_id)
SELECT 'suivimedias','Statut',a.value,CASE c.role WHEN 'contact' THEN 'media-status-0' WHEN 'waiting' THEN 'media-status-1' WHEN 'followup' THEN 'media-status-4' WHEN 'cancelled' THEN 'media-status-5' WHEN 'accepted' THEN 'media-status-3' ELSE (SELECT id FROM communication_choices WHERE scope='suivimedias' AND column_name='Statut' AND value=c.value) END
FROM communication_choice_aliases a JOIN communication_choices c ON c.id=a.choice_id WHERE a.scope='status' AND a.column_name='Statut';
CREATE TABLE communication_media_tasks (
 row_id TEXT PRIMARY KEY REFERENCES communication_rows(id),
 task_id TEXT NOT NULL UNIQUE
);
CREATE TRIGGER media_assignment_insert AFTER INSERT ON communication_rows
WHEN NEW.deleted_at IS NULL AND EXISTS (
 SELECT 1 FROM communication_sheets s,json_each(s.columns_json) a
 WHERE s.id=NEW.sheet_id AND s.collection='suivimedias' AND s.guide=0 AND a.value='Attribution'
 AND json_extract(NEW.cells_json,'$['||a.key||']') IN ('Candice','Charlotte','Pauline') AND 1
)
BEGIN
 INSERT INTO communication_media_tasks(row_id,task_id) VALUES(NEW.id,
 lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6)))) ON CONFLICT(row_id) DO NOTHING;
 INSERT INTO team_tasks(id,title,description,person,status,created_by,updated_by,created_at,updated_at)
 SELECT (SELECT task_id FROM communication_media_tasks WHERE row_id=NEW.id),substr('Média : '||COALESCE(NULLIF(json_extract(NEW.cells_json,'$['||n.key||']'),''),'Suivi média'),1,180),
 'Suivi du média : https://euneos.fr/interne/communication/suivimedias',json_extract(NEW.cells_json,'$['||a.key||']'),'en-cours',NEW.updated_by,NEW.updated_by,NEW.updated_at,NEW.updated_at
 FROM communication_sheets s,json_each(s.columns_json) a LEFT JOIN json_each(s.columns_json) n ON n.value='Nom média'
 WHERE s.id=NEW.sheet_id AND a.value='Attribution'
 ON CONFLICT(id) DO UPDATE SET person=excluded.person,status='en-cours',completed_at='',archived_at='',deleted_at='',
 contributors=(SELECT json_group_array(value) FROM json_each(team_tasks.contributors) WHERE value<>excluded.person),
 updated_by=excluded.updated_by,updated_at=excluded.updated_at,version=team_tasks.version+1;
END;
CREATE TRIGGER media_assignment_update AFTER UPDATE OF cells_json ON communication_rows
WHEN NEW.deleted_at IS NULL AND EXISTS (
 SELECT 1 FROM communication_sheets s,json_each(s.columns_json) a
 WHERE s.id=NEW.sheet_id AND s.collection='suivimedias' AND s.guide=0 AND a.value='Attribution'
 AND json_extract(NEW.cells_json,'$['||a.key||']') IN ('Candice','Charlotte','Pauline') AND json_extract(OLD.cells_json,'$['||a.key||']') IS NOT json_extract(NEW.cells_json,'$['||a.key||']')
)
BEGIN
 INSERT INTO communication_media_tasks(row_id,task_id) VALUES(NEW.id,
 lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(2)))||'-'||lower(hex(randomblob(6)))) ON CONFLICT(row_id) DO NOTHING;
 INSERT INTO team_tasks(id,title,description,person,status,created_by,updated_by,created_at,updated_at)
 SELECT (SELECT task_id FROM communication_media_tasks WHERE row_id=NEW.id),substr('Média : '||COALESCE(NULLIF(json_extract(NEW.cells_json,'$['||n.key||']'),''),'Suivi média'),1,180),
 'Suivi du média : https://euneos.fr/interne/communication/suivimedias',json_extract(NEW.cells_json,'$['||a.key||']'),'en-cours',NEW.updated_by,NEW.updated_by,NEW.updated_at,NEW.updated_at
 FROM communication_sheets s,json_each(s.columns_json) a LEFT JOIN json_each(s.columns_json) n ON n.value='Nom média'
 WHERE s.id=NEW.sheet_id AND a.value='Attribution'
 ON CONFLICT(id) DO UPDATE SET person=excluded.person,status='en-cours',completed_at='',archived_at='',deleted_at='',
 contributors=(SELECT json_group_array(value) FROM json_each(team_tasks.contributors) WHERE value<>excluded.person),
 updated_by=excluded.updated_by,updated_at=excluded.updated_at,version=team_tasks.version+1;
END;
