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
    ? Response.json({ keys: [jwk] }) : realFetch(input, init)) as typeof fetch
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
  const db = {
    prepare: (query: string) => ({bind:(...args: unknown[]) => ({
      all: async () => ({results:sql.query(query).all(...args as [])}),
      first: async () => sql.query(query).get(...args as []),
      run: async () => ({meta:{changes:sql.query(query).run(...args as []).changes}}),
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
    expect((sql.query('SELECT COUNT(*) AS n FROM mission_conventions').get() as {n:number}).n).toBe(1)
    sql.close()
  })
})
