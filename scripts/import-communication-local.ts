// Local review only. Never connects to remote D1 or writes source data to Git.
// Usage: bun scripts/import-communication-local.ts /private/normalized.json /private/new.sqlite
import { Database } from 'bun:sqlite'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
const [input, output] = process.argv.slice(2)
if (!input || !output || existsSync(output)) throw new Error('Provide a private manifest and a NEW local SQLite path.')
if (resolve(output).startsWith(resolve('.')+'/') || resolve(input).startsWith(resolve('.')+'/')) throw new Error('Keep private sources and databases outside the source checkout.')
const manifest = JSON.parse(readFileSync(input,'utf8')) as { collection:string; title:string; columns:string[]; guide:boolean; rows:string[][] }[]
if (!Array.isArray(manifest) || !manifest.length) throw new Error('Empty manifest')
const { isCommunicationTable } = await import('../src/lib/communication')
for (const sheet of manifest) {
  if (!isCommunicationTable(sheet.collection) || !sheet.title || !sheet.columns.length || !sheet.columns.every(c=>typeof c==='string'&&c.length>0) || !sheet.rows.every(r=>r.length===sheet.columns.length&&r.every(c=>typeof c==='string'&&c.length<=10000))) throw new Error('Invalid manifest')
}
const db=new Database(output,{create:true})
db.exec('PRAGMA foreign_keys=ON')
for(const name of readdirSync('migrations/interne').filter(f=>/^\d+.*\.sql$/.test(f)).sort())db.transaction(()=>db.exec(readFileSync(`migrations/interne/${name}`,'utf8')))()
db.transaction(()=>{
 manifest.forEach((sheet,i)=>{
  const id=crypto.randomUUID()
  db.query('INSERT INTO communication_sheets(id,collection,title,columns_json,guide,position) VALUES(?,?,?,?,?,?)').run(id,sheet.collection,sheet.title,JSON.stringify(sheet.columns),sheet.guide?1:0,i)
  for(const cells of sheet.rows)db.query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)').run(crypto.randomUUID(),id,JSON.stringify(cells),'Import du document source')
 })
})()
console.log(JSON.stringify(manifest.map(s=>({collection:s.collection,title:s.title,rows:s.rows.length}))))
db.close()
