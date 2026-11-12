// Private one-time source import through the authorized deployment workflow.
// Never log source data, SQL parameters, HTTP bodies or credentials.
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {targetConfig} from './internal-migrations.mjs'
import {checkDeploymentRevision} from './check-deployment-revision.mjs'
export const seedSpec=JSON.parse(readFileSync(new URL('./lib/communication-seed.json',import.meta.url),'utf8'))
const tables=['communication_sheets','communication_rows','communication_partnership_entities']
export function decodeSeed(encoded,spec=seedSpec){
 const raw=gunzipSync(Buffer.from(encoded,'base64'),{maxOutputLength:1024*1024})
 if(createHash('sha256').update(raw).digest('hex')!==spec.sha256)throw new Error('Source privée différente de la source validée.')
 const seed=JSON.parse(raw.toString('utf8'))
 for(const [i,t]of tables.entries())if(!Array.isArray(seed[t])||seed[t].length!==[spec.sheets,spec.rows,spec.links][i])throw new Error('Source privée incomplète.')
 return seed
}
export const importQueries={
 communication_sheets:`INSERT INTO communication_sheets(id,collection,title,columns_json,guide,position) SELECT json_extract(value,'$.id'),json_extract(value,'$.collection'),json_extract(value,'$.title'),json_extract(value,'$.columns_json'),json_extract(value,'$.guide'),json_extract(value,'$.position') FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`,
 communication_rows:`INSERT INTO communication_rows(id,sheet_id,cells_json,version,updated_by,updated_at,status_changed_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.sheet_id'),json_extract(value,'$.cells_json'),json_extract(value,'$.version'),json_extract(value,'$.updated_by'),json_extract(value,'$.updated_at'),json_extract(value,'$.status_changed_at') FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`,
 communication_partnership_entities:`INSERT INTO communication_partnership_entities(row_id,entity_id) SELECT json_extract(value,'$.row_id'),json_extract(value,'$.entity_id') FROM json_each(?) WHERE true ON CONFLICT(row_id) DO NOTHING`,
}
export async function importSeed({query,encoded,codeSha,beforeWrite=async()=>{},spec=seedSpec}){
 const receipts=await query('SELECT seed_sha256 FROM communication_import_receipts',[])
 if(receipts.some(r=>r.seed_sha256===spec.sha256))return 'already-imported'
 if(receipts.length)throw new Error('Import différent déjà présent : rapprochement requis.')
 if(!encoded)throw new Error('Source privée initiale manquante ; publication bloquée pour éviter des tableaux vides.')
 const seed=decodeSeed(encoded,spec)
 // A partial import may resume only when all existing records still match the seed.
 for(const table of tables){
  const existing=await query(`SELECT * FROM ${table}`,[]),key=table==='communication_partnership_entities'?'row_id':'id'
  const expected=new Map(seed[table].map(r=>[r[key],r]))
  for(const r of existing){const source=expected.get(r[key]);if(!source||Object.keys(source).some(k=>k!=='status_changed_at'&&r[k]!==source[k]))throw new Error('Données déjà modifiées : import arrêté sans écrasement.')}
 }
 for(const table of tables){await beforeWrite();await query(importQueries[table],[JSON.stringify(seed[table])])}
 // The insert trigger initializes the clock to updated_at; restore the reviewed clock once.
 await beforeWrite();await query(`UPDATE communication_rows SET status_changed_at=(SELECT json_extract(value,'$.status_changed_at') FROM json_each(?) WHERE json_extract(value,'$.id')=communication_rows.id) WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`,[JSON.stringify(seed.communication_rows),JSON.stringify(seed.communication_rows)])
 for(const table of tables){const result=await query(`SELECT * FROM ${table}`,[]),key=table==='communication_partnership_entities'?'row_id':'id',expected=new Map(seed[table].map(r=>[r[key],r]));if(result.length!==expected.size||result.some(r=>{const s=expected.get(r[key]);return !s||Object.keys(s).some(k=>r[k]!==s[k])}))throw new Error('Vérification de l’import incomplète ; publication arrêtée.')}
 await beforeWrite();await query('INSERT INTO communication_import_receipts(seed_sha256,code_sha) VALUES(?,?)',[spec.sha256,codeSha])
 return 'imported'
}
async function main(){
 const environment=process.argv[2]
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.GITHUB_SHA)throw new Error('Import distant réservé au workflow de déploiement.')
 const target=targetConfig(environment),policy=await checkDeploymentRevision()
 if(environment==='production'&&policy!=='production')throw new Error('Production réservée à main.')
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
 if(!account||!token)throw new Error('Accès CI absent.')
 const query=async(sql,params)=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${target.id}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})})
  const body=await response.json().catch(()=>null)
  if(!response.ok||!body?.success||!body.result?.[0]?.success)throw new Error('Import privé D1 non confirmé ; vérifier le reçu avant reprise.')
  return body.result[0].results
 }
 const result=await importSeed({query,encoded:process.env.EUNEOS_COMMUNICATION_SEED,codeSha:process.env.GITHUB_SHA,beforeWrite:()=>checkDeploymentRevision()})
 console.log(`Communication ${environment}: ${result}; source ${seedSpec.sha256}; ${seedSpec.sheets} feuilles, ${seedSpec.rows} fiches initiales.`)
}
if(import.meta.main)main().catch(error=>{console.error(error.message);process.exitCode=1})
