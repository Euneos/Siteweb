-- Preserve the complete original rows, including trash, before retiring the table UI.
CREATE TABLE thematic_watch_legacy (
 row_id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES thematic_watch(id),
 original_json TEXT NOT NULL CHECK(json_valid(original_json))
);
INSERT INTO thematic_watch(id,week,payload,provenance,author,protected,version,deleted_at,updated_by,updated_at)
SELECT r.id, date(r.updated_at,'weekday 0','-6 days'),
 json_object(
 'title',coalesce(nullif((SELECT value FROM json_each(r.cells_json) WHERE key=(SELECT key FROM json_each(s.columns_json) WHERE value IN ('Nom','Titre') LIMIT 1)),''),'Ressource de la veille'),
 'link',coalesce((SELECT value FROM json_each(r.cells_json) WHERE key=(SELECT key FROM json_each(s.columns_json) WHERE value='Lien')),''),
 'summary','Ressource reprise du tableau de l’équipe. Contenu à relire avant de rédiger un résumé.',
 'for_euneos',coalesce(nullif((SELECT value FROM json_each(r.cells_json) WHERE key=(SELECT key FROM json_each(s.columns_json) WHERE value='Notes')),''),'À préciser après relecture de la ressource.'),
 'source',coalesce(nullif((SELECT value FROM json_each(r.cells_json) WHERE key=(SELECT key FROM json_each(s.columns_json) WHERE value='Type')),''),'Ancienne veille de l’équipe'),
 'published_on',coalesce(nullif((SELECT value FROM json_each(r.cells_json) WHERE key=(SELECT key FROM json_each(s.columns_json) WHERE value='Date de la ressource')),''),nullif((SELECT value FROM json_each(r.cells_json) WHERE key=(SELECT key FROM json_each(s.columns_json) WHERE value='Date publication')),''),''),
 'publication_label','','connection','','source_type',CASE WHEN lower((SELECT value FROM json_each(r.cells_json) WHERE key=(SELECT key FROM json_each(s.columns_json) WHERE value='Type'))) IN ('article','podcast','film') THEN 'média' ELSE 'acteur du secteur' END,
 'themes',json(coalesce((SELECT json_group_array(t.value) FROM json_each('["santé mentale","CPS","numérique","jeunes","éducation","relations sociales","émotions"]') t WHERE
   CASE t.value
    WHEN 'éducation' THEN instr(lower(r.cells_json),'ducation')>0
    WHEN 'émotions' THEN instr(lower(r.cells_json),'motion')>0
    WHEN 'numérique' THEN instr(lower(r.cells_json),'numérique')>0
    WHEN 'CPS' THEN instr(lower(r.cells_json),'cps')>0
    WHEN 'santé mentale' THEN instr(lower(r.cells_json),'santé mentale')>0
    WHEN 'jeunes' THEN instr(lower(r.cells_json),'jeunes')>0
    WHEN 'relations sociales' THEN instr(lower(r.cells_json),'relations')>0
   END),'[]')),
 'deadline','','needs_primary',json('true'),'quotes','','relevance','Ressource conservée de la veille de l’équipe ; elle ne constitue pas une nouvelle actualité.',
 'read_note','Reprise de la saisie historique ; contenu de la source non relu lors de la fusion.',
 'usages',json('[]'),'event',null,
 'legacy',json_object('sheet',s.title,'columns',json(s.columns_json),'cells',json(r.cells_json),'updated_by',r.updated_by,'updated_at',r.updated_at)
 ),'ajout manuel','Équipe EUNEOS · ancien tableau',1,r.version,coalesce(r.deleted_at,''),r.updated_by,r.updated_at
FROM communication_rows r JOIN communication_sheets s ON s.id=r.sheet_id WHERE s.collection='veille' AND s.guide=0;
INSERT INTO thematic_watch_legacy(row_id,item_id,original_json)
SELECT r.id,r.id,json_object('sheet_id',s.id,'sheet_title',s.title,'columns',json(s.columns_json),'cells',json(r.cells_json),'version',r.version,'updated_by',r.updated_by,'updated_at',r.updated_at,'deleted_at',r.deleted_at,'deleted_by',r.deleted_by)
FROM communication_rows r JOIN communication_sheets s ON s.id=r.sheet_id WHERE s.collection='veille' AND s.guide=0;
-- Original rows stay archived in storage; the old UI/API is retired separately.
