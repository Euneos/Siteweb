import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { isCommunicationTable, validateCommunicationRow } from '../src/lib/communication'
test('private communication inputs reject malformed, oversized and empty records',()=>{
 expect(isCommunicationTable('__proto__')).toBe(false)
 expect(isCommunicationTable('suivimedias')).toBe(true)
 expect(validateCommunicationRow({version:0,cells:[' Nom ','']},['Nom','Notes'])).toEqual(['Nom',''])
 for(const body of [{version:0,cells:['']},{version:-1,cells:['nom']},{version:1,cells:[42]},{version:0,cells:['x'.repeat(10001)]},{version:0,cells:['nom','extra']}])expect(()=>validateCommunicationRow(body,['Nom'])).toThrow()
})
test('communication migration preserves workspace records, versions guard concurrent edits',()=>{
 const db=new Database(':memory:');db.exec('PRAGMA foreign_keys=ON')
 db.exec(readFileSync('migrations/interne/0001_workspace.sql','utf8'))
 const before=db.query('SELECT count(*) AS n FROM workspace_entries').get()
 db.exec(readFileSync('migrations/interne/0019_communication_tables.sql','utf8'))
 expect(db.query('SELECT count(*) AS n FROM workspace_entries').get()).toEqual(before)
 db.query('INSERT INTO communication_sheets VALUES(?,?,?,?,?,?)').run('s','veille','Veille','["Nom"]',0,0)
 db.query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)').run('r','s','["Source"]','a')
 const update=db.query('UPDATE communication_rows SET cells_json=?,version=version+1 WHERE id=? AND version=?')
 expect(update.run('["Première modification"]','r',1).changes).toBe(1)
 expect(update.run('["Modification concurrente"]','r',1).changes).toBe(0)
 expect(db.query('SELECT cells_json FROM communication_rows').get()).toEqual({cells_json:'["Première modification"]'})
 expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
 db.close()
})
