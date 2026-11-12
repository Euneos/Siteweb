-- Stable identities preserve color and follow-up semantics when labels change.
CREATE TABLE communication_choices (
 id TEXT PRIMARY KEY,
 scope TEXT NOT NULL,
 column_name TEXT NOT NULL,
 value TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1,
 deleted_at TEXT,
 UNIQUE(scope,column_name,value)
);
CREATE TABLE communication_choice_aliases (
 scope TEXT NOT NULL,
 column_name TEXT NOT NULL,
 value TEXT NOT NULL,
 choice_id TEXT NOT NULL REFERENCES communication_choices(id),
 PRIMARY KEY(scope,column_name,value)
);
INSERT INTO communication_choices(id,scope,column_name,value,role) VALUES
 ('status-contact','status','Statut','À contacter','contact'),
 ('status-waiting','status','Statut','En attente de réponse','waiting'),
 ('status-followup','status','Statut','À relancer','followup'),
 ('status-cancelled','status','Statut','Annulé','cancelled'),
 ('status-accepted','status','Statut','Accepté','accepted');
INSERT INTO communication_choices(id,scope,column_name,value,role)
SELECT lower(hex(randomblob(16))),collection,'Priorité',value,value
FROM (SELECT 'suivimedias' collection UNION ALL SELECT 'partenariats' UNION ALL SELECT 'veille'),json_each('["A","B","C"]');
INSERT INTO communication_choices(id,scope,column_name,value,role)
SELECT lower(hex(randomblob(16))),'veille','Type',value,lower(value) FROM json_each('["Podcast","Article","Newsletter","Film"]');
INSERT OR IGNORE INTO communication_choices(id,scope,column_name,value)
SELECT lower(hex(randomblob(16))),CASE WHEN c.value='Statut' THEN 'status' ELSE s.collection END,c.value,trim(json_extract(r.cells_json,'$['||c.key||']'))
FROM communication_rows r JOIN communication_sheets s ON s.id=r.sheet_id JOIN json_each(s.columns_json) c
WHERE s.guide=0 AND c.value IN ('Type de média','Type','Statut','Priorité','Vivier','Public principal') AND trim(json_extract(r.cells_json,'$['||c.key||']'))<>'';
INSERT OR IGNORE INTO communication_choices(id,scope,column_name,value)
WITH RECURSIVE tags(scope,rest,tag) AS (
 SELECT s.collection,replace(replace(json_extract(r.cells_json,'$['||c.key||']'),';',','),char(10),',')||',',''
 FROM communication_rows r JOIN communication_sheets s ON s.id=r.sheet_id JOIN json_each(s.columns_json) c ON c.value='Tags' WHERE s.guide=0
 UNION ALL SELECT scope,substr(rest,instr(rest,',')+1),trim(substr(rest,1,instr(rest,',')-1)) FROM tags WHERE instr(rest,',')>0
)
SELECT lower(hex(randomblob(16))),scope,'Tags',tag FROM tags WHERE tag<>'';
INSERT INTO communication_choice_aliases SELECT scope,column_name,value,id FROM communication_choices;
CREATE TRIGGER communication_choice_insert AFTER INSERT ON communication_choices
BEGIN
 INSERT INTO communication_choice_aliases(scope,column_name,value,choice_id) VALUES(NEW.scope,NEW.column_name,NEW.value,NEW.id);
END;
CREATE TRIGGER communication_choice_rename AFTER UPDATE OF value ON communication_choices
WHEN OLD.value<>NEW.value
BEGIN
 INSERT INTO communication_choice_aliases(scope,column_name,value,choice_id) VALUES(NEW.scope,NEW.column_name,NEW.value,NEW.id) ON CONFLICT(scope,column_name,value) DO NOTHING;
END;
DROP TRIGGER communication_status_change;
CREATE TRIGGER communication_status_change AFTER UPDATE OF cells_json ON communication_rows
WHEN EXISTS (
 SELECT 1 FROM communication_sheets s,json_each(s.columns_json) c
 WHERE s.id=NEW.sheet_id AND c.value='Statut'
 AND COALESCE((SELECT choice_id FROM communication_choice_aliases WHERE scope='status' AND column_name='Statut' AND value=json_extract(OLD.cells_json,'$['||c.key||']')),json_extract(OLD.cells_json,'$['||c.key||']'))
 IS NOT COALESCE((SELECT choice_id FROM communication_choice_aliases WHERE scope='status' AND column_name='Statut' AND value=json_extract(NEW.cells_json,'$['||c.key||']')),json_extract(NEW.cells_json,'$['||c.key||']'))
)
BEGIN
 UPDATE communication_rows SET status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
END;
