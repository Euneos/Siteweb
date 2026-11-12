-- Every editable partnership view exposes the same status field.
UPDATE communication_rows SET cells_json=json_insert(cells_json,'$[#]','')
WHERE sheet_id IN (SELECT s.id FROM communication_sheets s WHERE s.collection='partenariats' AND s.guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(s.columns_json) WHERE value='Statut'));
UPDATE communication_sheets SET columns_json=json_insert(columns_json,'$[#]','Statut')
WHERE collection='partenariats' AND guide=0 AND NOT EXISTS(SELECT 1 FROM json_each(columns_json) WHERE value='Statut');
