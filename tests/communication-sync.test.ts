import {test,expect} from 'bun:test'
import {Database} from 'bun:sqlite'
import {readFileSync} from 'node:fs'
test('linked partnership edits propagate fields, versions and status clocks',()=>{
 const db=new Database(':memory:');try{
 for(const migration of ['0019_communication_tables','0020_communication_status_clock','0021_partnership_status'])db.exec(readFileSync(`migrations/interne/${migration}.sql`,'utf8'))
 for(const id of ['top','main']){db.query('INSERT INTO communication_sheets VALUES(?,?,?,?,?,?)').run(id,'partenariats',id,'["Nom","Priorité","Statut","Notes"]',0,1);db.query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)').run(id,id,'["Personne","B","","Notes"]','test')}
 db.exec(readFileSync('migrations/interne/0022_partnership_shared_records.sql','utf8'));db.exec('PRAGMA recursive_triggers=ON')
 db.query('UPDATE communication_rows SET cells_json=?,version=version+1 WHERE id=?').run('["Nouveau nom","A","Accepté","Nouvelles notes"]','top')
 const result=db.query('SELECT cells_json,version FROM communication_rows ORDER BY id').all();expect(result).toEqual([{cells_json:'["Nouveau nom","A","Accepté","Nouvelles notes"]',version:2},{cells_json:'["Nouveau nom","A","Accepté","Nouvelles notes"]',version:2}])
 db.query('UPDATE communication_rows SET cells_json=? WHERE id=?').run('["Nouveau nom","C","Annulé","Dernières notes"]','main')
 expect((db.query('SELECT cells_json FROM communication_rows WHERE id=?').get('top') as any).cells_json).toContain('Annulé')
 }finally{db.close()}
})
