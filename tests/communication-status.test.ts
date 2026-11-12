import {test,expect} from 'bun:test'
import {Database} from 'bun:sqlite'
import {readFileSync} from 'node:fs'
import {communicationStatuses,effectiveCommunicationCells} from '../src/lib/communication'
test('waiting turns into follow-up at exactly twenty days',()=>{
 const start='2026-01-01T12:00:00Z',now=Date.parse(start),day=86400000
 expect(communicationStatuses).toHaveLength(5)
 expect(effectiveCommunicationCells(['En attente de réponse'],['Statut'],start,now+20*day-1)[0]).toBe('En attente de réponse')
 expect(effectiveCommunicationCells(['En attente de réponse'],['Statut'],start,now+20*day)[0]).toBe('À relancer')
 expect(effectiveCommunicationCells(['Accepté'],['Statut'],start,now+30*day)[0]).toBe('Accepté')
})
test('notes edits preserve status date; changing status starts a new period',()=>{
 const db=new Database(':memory:');try{
 db.exec(readFileSync('migrations/interne/0019_communication_tables.sql','utf8'));db.exec(readFileSync('migrations/interne/0020_communication_status_clock.sql','utf8'))
 db.query('INSERT INTO communication_sheets VALUES(?,?,?,?,?,?)').run('s','suivimedias','Médias','["Statut","Notes"]',0,1)
 db.query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)').run('r','s','["En attente de réponse",""]','test')
 db.exec("UPDATE communication_rows SET status_changed_at='2026-01-01T00:00:00Z'")
 db.query('UPDATE communication_rows SET cells_json=?').run('["En attente de réponse","Notes modifiées"]')
 expect(db.query('SELECT status_changed_at FROM communication_rows').get()).toEqual({status_changed_at:'2026-01-01T00:00:00Z'})
 db.query('UPDATE communication_rows SET cells_json=?').run('["Accepté","Notes modifiées"]')
 expect((db.query('SELECT status_changed_at FROM communication_rows').get() as any).status_changed_at).not.toBe('2026-01-01T00:00:00Z')
 }finally{db.close()}
})
test('partnership migration appends status without changing source fields',()=>{
 const db=new Database(':memory:');try{
 db.exec(readFileSync('migrations/interne/0019_communication_tables.sql','utf8'));db.exec(readFileSync('migrations/interne/0020_communication_status_clock.sql','utf8'))
 db.query('INSERT INTO communication_sheets VALUES(?,?,?,?,?,?)').run('s','partenariats','Partenaires','["Nom","Notes"]',0,1)
 db.query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)').run('r','s','["Partenaire","Texte source"]','test')
 const sql=readFileSync('migrations/interne/0021_partnership_status.sql','utf8');db.exec(sql);db.exec(sql)
 expect(JSON.parse((db.query('SELECT columns_json FROM communication_sheets').get() as any).columns_json)).toEqual(['Nom','Notes','Statut'])
 expect(JSON.parse((db.query('SELECT cells_json FROM communication_rows').get() as any).cells_json)).toEqual(['Partenaire','Texte source',''])
 }finally{db.close()}
})
