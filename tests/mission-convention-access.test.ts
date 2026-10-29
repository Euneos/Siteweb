import { afterAll, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { PDFDocument } from 'pdf-lib'
import { GET as resourceGet, POST as resourcePost, PUT as resourcePut } from '../src/pages/api/interne/ressources'
import { POST as conventionPost } from '../src/pages/api/interne/conventions-mission'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const domain = 'mission-convention-test.cloudflareaccess.com'
const jwk = { ...(await exportJWK(publicKey)), kid: 'mission-test', alg: 'RS256', use: 'sig' }
const realFetch = globalThis.fetch
globalThis.fetch = (async (input, init) =>
  String(input) === `https://${domain}/cdn-cgi/access/certs`
    ? Response.json({ keys: [jwk] }) : String(input) === 'https://euneos.fr/fonts/OpenSans-convention.ttf'
      ? new Response(readFileSync('public/fonts/OpenSans-convention.ttf')) : realFetch(input, init)) as typeof fetch
afterAll(() => { globalThis.fetch = realFetch })

const sign = (aud: string, email: string) => new SignJWT({email})
  .setProtectedHeader({alg:'RS256',kid:'mission-test'})
  .setIssuer(`https://${domain}`).setAudience(aud).setSubject('member').setExpirationTime('5m')
  .sign(privateKey)
const payload = () => ({
  nom:'Camille Exemple', structure:'Indépendant', identification:'123', adresse:'Toulouse',
  email:'contact@example.test', telephone:'0102030405', frais:'aucun', detailsFrais:'',
  missions:[{
    etablissement:'Collège fictif', adresse:'Toulouse', direction:'Direction', referent:'Référent', contact:'référent@example.test',
    format:'presentiel', sessions:Array.from({length:4},()=>({date:'2027-01-12',duree:4,modalite:'presentiel'})),
    cas1:'non',classe:'',ateliers:'',cas2:'non',periodeCas2:'',accordCas2:'',
  }],
})
function fixture() {
  const sql = new Database(':memory:')
  sql.exec(readFileSync('migrations/interne/0001_workspace.sql','utf8'))
  sql.exec(readFileSync('migrations/interne/0009_conventions_mission.sql','utf8'))
  sql.exec(readFileSync('migrations/interne/0012_mission_convention_drafts.sql','utf8'))
  sql.exec(readFileSync('migrations/interne/0013_mission_convention_notifications.sql','utf8'))
  sql.exec(readFileSync('migrations/interne/0014_mission_convention_year2.sql','utf8'))
  sql.exec(readFileSync('migrations/interne/0015_mission_convention_revisions.sql','utf8'))
  const db = {
    batch: async (statements: {execute:()=>unknown}[]) => sql.transaction(()=>statements.map(s=>s.execute()))(),
    prepare: (query: string) => ({bind:(...args: unknown[]) => ({
      all: async () => ({results:sql.query(query).all(...args as [])}),
      first: async () => sql.query(query).get(...args as []),
      run: async () => ({meta:{changes:sql.query(query).run(...args as []).changes}}),
      execute: () => ({meta:{changes:sql.query(query).run(...args as []).changes}}),
    })}),
  }
  const env = {INTERNAL_ACCESS_DOMAIN:domain,INTERNAL_ACCESS_AUD:'team',RESOURCE_ACCESS_DOMAIN:domain,
    RESOURCE_ACCESS_AUD:'trainers',INTERNAL_ADMIN_EMAILS:'manager@example.test',TEAM_WORKSPACE:db}
  const request = async (url:string, aud:string, email:string, body?:object) => new Request(`https://euneos.fr${url}`,{
    method:body?'POST':'GET',
    headers:{'Cf-Access-Jwt-Assertion':await sign(aud,email),...(body?{'Origin':'https://euneos.fr','Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  })
  return {sql, locals:{runtime:{env}},request}
}

describe('convention et audience Ressources', () => {
  test('révision non signée : archive, même dossier, finances conservées, nouveau PDF et refus des anciennes versions', async () => {
    const {sql,locals,request}=fixture()
    const url='/api/interne/conventions-mission', trainer='formateur@example.test'
    const p={...payload(),missions:[{...payload().missions[0],cas2:'4',periodeCas2:'Janvier',accordCas2:'À confirmer'},{...payload().missions[0],etablissement:'Lycée fictif',volume:8,sessions:[{date:'2027-01-12',duree:8,modalite:'presentiel'}]}]}
    const post=async (body:object,aud='team',email='manager@example.test')=>conventionPost({request:await request(url,aud,email,body),locals} as never)
    const {id}=await (await post({action:'submit',ownerEmail:trainer,payload:p})).json()
    const current=()=>sql.query('SELECT * FROM mission_conventions WHERE id=?').get(id) as {updated_at:string,state:string,payload:string}
    const review={id,representativeName:'Responsable',representativeRole:'Direction',case2Euros:0,year2Euros:500,feesDecision:'accord',feesDetails:'Déplacements exceptionnels',feesEuros:76.56,confirmed:true}
    expect((await post({action:'approve',...review,expectedUpdatedAt:current().updated_at})).status).toBe(200)
    const before=current(), oldPdf=sql.query("SELECT sha256 FROM mission_convention_files WHERE convention_id=? AND kind='approved'").get(id)
    const body={action:'revise',id,expectedUpdatedAt:before.updated_at,unsignedConfirmed:true,note:'2 h adultes pour préparer 4 ateliers, en remplacement des 4 h',payload:{...p,missions:[{...p.missions[0],cas2:'2',accordCas2:'Formation adultes à la conduite de 4 ateliers'},p.missions[1]]}}
    expect((await post(body,'trainers',trainer)).status).toBe(403)
    expect((await post({...body,unsignedConfirmed:false})).status).toBe(400)
    expect((await post({...body,expectedUpdatedAt:'stale'})).status).toBe(409)
    expect((await post({...body,payload:{...body.payload,nom:'Autre personne'}})).status).toBe(400)
    expect((await post(body)).status).toBe(200)
    expect(current().state).toBe('submitted')
    expect(JSON.parse(current().payload).missions[0].cas2).toBe('2')
    expect(sql.query('SELECT case2_amount_pending,year2_euros,fees_euros,fees_details FROM mission_conventions WHERE id=?').get(id)).toEqual({case2_amount_pending:1,year2_euros:500,fees_euros:76.56,fees_details:'Déplacements exceptionnels'})
    expect(sql.query('SELECT sha256 FROM mission_convention_revisions WHERE convention_id=?').get(id)).toEqual(oldPdf)
    expect((await post(body)).status).toBe(409)
    expect((await resourceGet({request:await request(`/api/interne/ressources?convention=1&id=${id}&kind=approved`,'trainers',trainer),locals} as never)).status).toBe(404)
    expect((await post({action:'save-review',...review,case2Euros:null,expectedUpdatedAt:current().updated_at})).status).toBe(200)
    expect((await post({action:'approve',...review,case2Euros:null,expectedUpdatedAt:current().updated_at})).status).toBe(400)
    expect((await post({action:'approve',...review,case2Euros:125.5,expectedUpdatedAt:current().updated_at})).status).toBe(200)
    expect(sql.query("SELECT sha256 FROM mission_convention_files WHERE convention_id=? AND kind='approved'").get(id)).not.toEqual(oldPdf)
    expect(sql.query('SELECT sha256 FROM mission_convention_revisions WHERE convention_id=?').get(id)).toEqual(oldPdf)
    const signed=await PDFDocument.create(); signed.addPage(); const pdf=Uint8Array.from(await signed.save())
    const upload=async(version:string)=>resourcePut({request:new Request(`https://euneos.fr/api/interne/ressources?convention=1&id=${id}&kind=trainer_signed&version=${encodeURIComponent(version)}`,{method:'PUT',headers:{'Cf-Access-Jwt-Assertion':await sign('trainers',trainer),Origin:'https://euneos.fr','Content-Type':'application/pdf'},body:pdf}),locals} as never)
    expect((await upload(before.updated_at)).status).toBe(409)
    expect((await upload(current().updated_at)).status).toBe(200)
    expect((await post({...body,expectedUpdatedAt:current().updated_at})).status).toBe(409)
    expect(sql.query('SELECT count(*) n FROM mission_convention_revisions').get()).toEqual({n:1})
    sql.close()
  })
  test('500 euros préparés pendant les corrections, conservés seulement pour la même mission année 2', async () => {
    const {sql,locals,request}=fixture()
    const url='/api/interne/conventions-mission', trainer='formateur@example.test'
    const p={...payload(),missions:[{...payload().missions[0],volume:8,sessions:[{date:'2027-01-12',duree:8,modalite:'presentiel'}]}]}
    const post=async (body:object,email='manager@example.test') => conventionPost({request:await request(url,'team',email,body),locals} as never)
    const {id}=await (await post({action:'submit',ownerEmail:trainer,payload:p})).json()
    expect((await post({action:'changes',id,note:'Préciser les coordonnées'})).status).toBe(200)
    const updated=sql.query('SELECT updated_at FROM mission_conventions WHERE id=?').get(id) as {updated_at:string}
    const review={id,expectedUpdatedAt:updated.updated_at,representativeName:'Responsable',representativeRole:'Direction',case2Euros:0,year2Euros:500,feesDecision:'',feesDetails:''}
    expect((await post({action:'save-review',...review},'collegue@example.test')).status).toBe(403)
    expect((await post({action:'save-review',...review})).status).toBe(200)
    expect(sql.query('SELECT state,year2_euros FROM mission_conventions WHERE id=?').get(id)).toEqual({state:'changes_requested',year2_euros:500})
    expect((await post({action:'approve',...review,confirmed:true})).status).toBe(409)
    expect((await post({action:'submit',id,ownerEmail:trainer,payload:p})).status).toBe(200)
    expect(sql.query('SELECT state,year2_euros FROM mission_conventions WHERE id=?').get(id)).toEqual({state:'submitted',year2_euros:500})
    await post({action:'changes',id,note:'Changer la mission'})
    expect((await post({action:'submit',id,ownerEmail:trainer,payload:{...p,missions:[{...p.missions[0],etablissement:'Autre établissement'}]}})).status).toBe(200)
    expect(sql.query('SELECT year2_euros FROM mission_conventions WHERE id=?').get(id)).toEqual({year2_euros:null})
    sql.close()
  })
  test('vérification conservée avec centimes et total ateliers ; rattachement privé sans effacement', async () => {
    const {sql,locals,request} = fixture()
    const teamUrl='/api/interne/conventions-mission'
    const trainer='formateur@example.test'
    const p={...payload(),frais:'demande',detailsFrais:'Impressions : 39,79 euros',missions:[{...payload().missions[0],cas1:'oui',classe:'5e',ateliers:'Dates à fixer',financement:'externe',financeur:'Organisme fictif'},{...payload().missions[0],etablissement:'Second collège',cas1:'oui',classe:'5e',ateliers:'Dates à fixer',financement:'externe',financeur:'Organisme fictif'}]}
    const submitted=await conventionPost({request:await request(teamUrl,'team','manager@example.test',{action:'submit',ownerEmail:trainer,payload:p}),locals} as never)
    expect(submitted.status).toBe(200)
    const {id}=await submitted.json()
    const initial=sql.query('SELECT * FROM mission_conventions WHERE id=?').get(id) as {updated_at:string}
    const body={action:'save-review',id,expectedUpdatedAt:initial.updated_at,representativeName:'Responsable',representativeRole:'Direction',case2Euros:0,feesDecision:'accord',feesDetails:'Impressions : 39,79 euros',feesEuros:39.79}
    expect((await conventionPost({request:await request(teamUrl,'team','manager@example.test',body),locals} as never)).status).toBe(200)
    const saved=sql.query('SELECT fees_euros,fees_details,fees_decision,state FROM mission_conventions WHERE id=?').get(id)
    expect(saved).toEqual({fees_euros:39.79,fees_details:'Impressions : 39,79 euros',fees_decision:'accord',state:'submitted'})
    expect((await conventionPost({request:await request(teamUrl,'team','manager@example.test',{...body,expectedUpdatedAt:'stale'}),locals} as never)).status).toBe(409)
    expect((await conventionPost({request:await request(teamUrl,'trainers',trainer,body),locals} as never)).status).toBe(403)
    const draft=crypto.randomUUID()
    expect((await conventionPost({request:await request(teamUrl,'team','manager@example.test',{action:'save-draft',id:draft,revision:0,ownerEmail:trainer,payload:p,note:'Ancien préremplissage'}),locals} as never)).status).toBe(200)
    expect((await conventionPost({request:await request(teamUrl,'team','manager@example.test',{action:'supersede-draft',id:draft,revision:1,conventionId:id}),locals} as never)).status).toBe(200)
    expect((sql.query('SELECT submitted_id FROM mission_convention_drafts WHERE id=?').get(draft) as {submitted_id:string}).submitted_id).toBe(id)
    expect((sql.query('SELECT COUNT(*) AS n FROM mission_convention_drafts').get() as {n:number}).n).toBe(1)
    sql.close()
  })
  test('brouillons privés : création direction, refus des autres comptes et soumission incomplète', async () => {
    const {sql,locals,request} = fixture()
    const id = crypto.randomUUID()
    const url = '/api/interne/ressources?convention=1'
    const teamUrl = '/api/interne/conventions-mission'
    const body = { action:'save-draft', id, revision:0, ownerEmail:'formateur@example.test', note:'À compléter', payload:{...payload(),structure:'',missions:[{...payload().missions[0],sessions:[]}]}}
    expect((await conventionPost({request:await request(teamUrl,'team','manager@example.test',body),locals} as never)).status).toBe(200)
    const own = await (await resourceGet({request:await request(url,'trainers','formateur@example.test'),locals} as never)).json()
    expect(own.drafts[0].id).toBe(id)
    expect((await (await resourceGet({request:await request(url,'trainers','autre@example.test'),locals} as never)).json()).drafts).toEqual([])
    expect((await resourcePost({request:await request(url,'trainers','autre@example.test',{...body,revision:1}),locals} as never)).status).toBe(404)
    expect((await resourcePost({request:await request(url,'trainers','formateur@example.test',{...body,action:'submit-draft',revision:1}),locals} as never)).status).toBe(400)
    expect((await conventionPost({request:await request(teamUrl,'team','collegue@example.test',{...body,id:crypto.randomUUID()}),locals} as never)).status).toBe(403)
    sql.close()
  })
  test('un formateur voit les ressources et sa convention, mais aucune action de l’équipe', async () => {
    const {sql,locals,request} = fixture()
    const url='/api/interne/ressources?convention=1'
    const trainer='formateur@example.test'
    const catalogue = await resourceGet({request:await request('/api/interne/ressources','trainers',trainer),locals} as never)
    expect((await catalogue.json()).resources).toEqual([])
    const submitted = await resourcePost({request:await request(url,'trainers',trainer,{action:'submit',payload:payload()}),locals} as never)
    expect(submitted.status).toBe(200)
    const {id} = await submitted.json()
    expect((await (await resourceGet({request:await request(url,'trainers',trainer),locals} as never)).json()).conventions[0].id).toBe(id)
    expect((await (await resourceGet({request:await request(url,'trainers','autre@example.test'),locals} as never)).json()).conventions).toEqual([])
    expect((await resourcePost({request:await request('/api/interne/ressources','trainers',trainer,{action:'submit',payload:payload()}),locals} as never)).status).toBe(404)
    expect((await conventionPost({request:await request('/api/interne/conventions-mission','trainers',trainer,{action:'approve',id}),locals} as never)).status).toBe(403)
    expect((await resourcePost({request:await request(url,'trainers',trainer,{action:'approve',id}),locals} as never)).status).toBe(403)
    expect((await conventionPost({request:await request('/api/interne/conventions-mission','team','manager@example.test',{
      action:'approve',id,confirmed:true,representativeName:'Candice Marro',representativeRole:'',case2Euros:0,feesDecision:'aucun',feesDetails:'',
    }),locals} as never)).status).toBe(400)
    const tooSoon = new Request(`https://euneos.fr${url}&id=${id}&kind=trainer_signed`, {
      method:'PUT', headers:{'Cf-Access-Jwt-Assertion':await sign('trainers',trainer),Origin:'https://euneos.fr','Content-Type':'application/pdf'}, body:'%PDF-1.7',
    })
    expect((await resourcePut({request:tooSoon,locals} as never)).status).toBe(409)
    const document = await PDFDocument.create()
    document.addPage()
    const pdf = await document.save()
    sql.query("UPDATE mission_conventions SET state='approved' WHERE id=?").run(id)
    sql.query("INSERT INTO mission_convention_files(convention_id,kind,pdf,sha256,uploaded_by) VALUES (?,'approved',?,'fictif',?)").run(id,pdf,'manager@example.test')
    const download = await resourceGet({request:await request(`${url}&id=${id}&kind=approved`,'trainers',trainer),locals} as never)
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Type')).toBe('application/pdf')
    expect((await resourceGet({request:await request(`${url}&id=${id}&kind=approved`,'trainers','autre@example.test'),locals} as never)).status).toBe(404)
    const signedUpload = new Request(`https://euneos.fr${url}&id=${id}&kind=trainer_signed`, {
      method:'PUT',headers:{'Cf-Access-Jwt-Assertion':await sign('trainers',trainer),Origin:'https://euneos.fr','Content-Type':'application/pdf'},body:Uint8Array.from(pdf),
    })
    const signedResult = await resourcePut({request:signedUpload,locals} as never)
    expect(signedResult.status).toBe(200)
    expect((await signedResult.json()).notification).toBe('unavailable')
    expect(sql.query('SELECT kind,state FROM mission_convention_notifications WHERE convention_id=? ORDER BY id DESC LIMIT 1').get(id)).toEqual({kind:'trainer_signed',state:'unavailable'})
    expect((sql.query('SELECT COUNT(*) AS n FROM mission_conventions').get() as {n:number}).n).toBe(1)
    sql.close()
  })
})
