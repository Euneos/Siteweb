import {test,expect} from 'bun:test'
import {Database} from 'bun:sqlite'
import {readFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {importSeed} from '../scripts/import-communication-ci.mjs'
function fixture(){
 const db=new Database(':memory:');for(const m of ['0019_communication_tables','0020_communication_status_clock','0021_partnership_status','0022_partnership_shared_records','0023_communication_import_receipt'])db.exec(readFileSync('migrations/interne/'+m+'.sql','utf8'))
 const seed={communication_sheets:[{id:'s',collection:'veille',title:'Veille',columns_json:'["Nom"]',guide:0,position:0}],communication_rows:[{id:'r',sheet_id:'s',cells_json:'["Source fictive"]',version:1,updated_by:'fixture',updated_at:'2026-01-01T00:00:00Z',status_changed_at:'2025-12-01T00:00:00Z'}],communication_partnership_entities:[]}
 const raw=JSON.stringify(seed),encoded=gzipSync(raw).toString('base64'),spec={sha256:createHash('sha256').update(raw).digest('hex'),sheets:1,rows:1,links:0},query=async(sql:string,params:any[])=>db.query<Record<string,unknown>,any[]>(sql).all(...params)
 return {db,encoded,spec,query,codeSha:'test-sha'}
}
test('private import verifies all records and clocks, resumes without overwriting edits',async()=>{
 const f=fixture();try{expect(await importSeed(f)).toBe('imported');expect((await f.query('SELECT status_changed_at FROM communication_rows',[]))[0].status_changed_at).toBe('2025-12-01T00:00:00Z');f.db.query('UPDATE communication_rows SET cells_json=?').run('["Édition après import"]');expect(await importSeed({...f,encoded:undefined})).toBe('already-imported');expect((await f.query('SELECT cells_json FROM communication_rows',[]))[0].cells_json).toBe('["Édition après import"]')}finally{f.db.close()}
})
test('initial import requires the authorized source and refuses different existing data',async()=>{
 const f=fixture();try{await expect(importSeed({...f,encoded:undefined})).rejects.toThrow('manquante');f.db.query('INSERT INTO communication_sheets VALUES(?,?,?,?,?,?)').run('s','veille','Autre titre','["Nom"]',0,0);await expect(importSeed(f)).rejects.toThrow('sans écrasement');expect((await f.query('SELECT count(*) n FROM communication_rows',[]))[0].n).toBe(0)}finally{f.db.close()}
})
