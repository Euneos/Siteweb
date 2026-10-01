import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { GET as teamGet, POST as teamPost } from '../src/pages/api/interne/formulaires'
import { POST as publicPost } from '../src/pages/api/suivi/[kind]'
import { GET as legacyGet, POST as legacyPost } from '../src/pages/api/hook/google-forms'
import { issueOperationalLink, operationalHash, getOperationalPageContext } from '../src/lib/operational-links'
import { contactV2, deploymentV2, youthV2 } from './fixtures/operational-forms-v2'
import { NC } from '../src/lib/nocodb'
import { OPERATIONAL_ADULTS_TABLE } from '../src/lib/operational-data'
import { readContact, writeContact } from '../src/lib/google-form-contact'

// Real route, JWT verification, SQL and storage logic; every external transport
// is intercepted, with no network fallback. All persons and credentials fictive.
const realFetch = globalThis.fetch
const issuer = 'https://public-intake-test.cloudflareaccess.com'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'operational-review', alg: 'RS256', use: 'sig' }
let sql, db, env, parts, schools, cohorts, adults, replies, calls, hook, providerFailure
const wrap = database => ({ prepare: query => ({ bind: (...v) => ({
  run: async () => ({ meta: { changes: database.query(query).run(...v).changes } }),
  first: async () => database.query(query).get(...v),
  all: async () => ({ results: database.query(query).all(...v) }),
}) }) })
beforeEach(() => {
  sql = new Database(':memory:')
  const root = new URL('../migrations/', import.meta.url)
  for (const f of readdirSync(root).filter(f => /^\d.*\.sql$/.test(f)).sort()) sql.exec(readFileSync(new URL(f,root),'utf8'))
  db = wrap(sql); calls = []; hook = undefined; providerFailure = false
  parts = [{ Id: 7, code: 'DOS-FICTIF', etablissements_id: 1, cohortes_id: 2, fusionne_vers: null, statut: 'Engagé', notes: 'PRIVATE_NOTE_CANARY', referent_email: 'private@example.invalid' }]
  schools = [{ Id: 1, nom: 'Collège Fictif', ville: 'Ville Fictive', referent_email: 'private@example.invalid' }]
  cohorts = [{ Id: 2, nom: '2026-2027', annee_debut: 2026, annee_fin: 2027, active: true }]
  adults = []; replies = []
  env = { INTERNAL_ACCESS_DOMAIN: new URL(issuer).hostname, INTERNAL_ACCESS_AUD: 'team',
    RESOURCE_ACCESS_DOMAIN: new URL(issuer).hostname, RESOURCE_ACCESS_AUD: 'trainers', INTERNAL_ADMIN_EMAILS: 'manager@example.invalid',
    TEAM_WORKSPACE: { prepare() { throw new Error('Unexpected workspace access') } },
    PUBLIC_FORMS_TABLE: 'publicanswerstable', OPERATIONAL_YOUTH_ENABLED: 'true', OPERATIONAL_FORMS_ENABLED: 'true', FORM_SUBMISSIONS: db, NOCODB_TOKEN: 'fictive-token' }
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET'
    const call = { url: url.href, method, body: init?.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    if (url.href === issuer + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] })
    if (url.href === 'https://api.brevo.com/v3/smtp/email') {
      if (providerFailure) throw new Error('PRIVATE_PROVIDER_CANARY fictive-token')
      return new Response('', { status: 201 })
    }
    if (url.origin !== 'https://app.nocodb.com') throw new Error('UNEXPECTED_NETWORK')
    if (hook) await hook(call)
    const [, , , , table, , id] = url.pathname.split('/')
    const rows = table === NC.tables.participations ? parts : table === NC.tables.etablissements ? schools : table === NC.tables.cohortes ? cohorts : table === OPERATIONAL_ADULTS_TABLE ? adults : table === 'publicanswerstable' ? replies : null
    if (!rows) throw new Error('UNEXPECTED_TABLE')
    if (table === 'publicanswerstable') {
      if (method === 'POST') {
        const added = call.body.map((p,i) => ({...p,Id:300 + replies.length + i}))
        replies.push(...added); return Response.json(added)
      }
      if (method === 'PATCH') {
        call.body.forEach(p => Object.assign(replies.find(r => r.Id === p.Id), p))
        return Response.json(call.body)
      }
      if (id) return Response.json(replies.find(r => r.Id === Number(id)) ?? {})
      const where = url.searchParams.get('where')
      return Response.json({ list: where ? replies.filter(r => where === `(cle_reponse,eq,${r.cle_reponse})`) : replies })
    }
    if (method === 'PATCH' && table === NC.tables.participations) {
      for (const patch of call.body) Object.assign(parts.find(p => p.Id === patch.Id), patch)
      return Response.json(call.body)
    }
    if (method === 'POST' && table === OPERATIONAL_ADULTS_TABLE) {
      const added = call.body.map((p,i) => ({...p,Id:100 + adults.length + i}))
      adults.push(...added); return Response.json(added)
    }
    if (method !== 'GET') throw new Error('UNEXPECTED_MUTATION')
    if (id) return Response.json(rows.find(p => p.Id === Number(id)) ?? {}, { status: rows.some(p => p.Id === Number(id)) ? 200 : 404 })
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return Response.json({ list: rows.slice(offset, offset + 200), pageInfo: { isLastPage: offset + 200 >= rows.length } })
  }
})
afterEach(() => { globalThis.fetch = realFetch; sql.close() })
const locals = () => ({ runtime: { env } })
const jwt = (aud='team', options={}) => new SignJWT({ email:'member@example.invalid' })
  .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(options.issuer ?? issuer).setAudience(aud)
  .setSubject('fictive-member').setExpirationTime(options.exp ?? '5m').sign(privateKey)
const req = (path, body, headers={}, origin='https://euneos.fr') => new Request(origin+path, {
  method:body === undefined ? 'GET':'POST', headers:{Origin:origin,'Content-Type':'application/json',...headers},
  ...(body === undefined ? {} : {body:typeof body === 'string' ? body : JSON.stringify(body)}),
})
const payload = (kind='contact') => ({
  referrer:{name:'Référent Fictif',email:'referrer@example.invalid'},
  ...(kind === 'participants' ? {participants:[{firstName:'Adulte',lastName:'Fictif',email:'adult@example.invalid',role:'Enseignant'}]} : {
    formation:{start:'2026-10-01',end:'2027-02-01',format:'Présentiel',planning:'Cinq sessions fictives',sessions:5},
    schoolDetails:{academy:'Académie fictive',address:'Rue fictive',postalCode:'01000',type:'Collège'},
    directionEmail:'direction@example.invalid',operations:{groupedSchools:false},
    ...(kind === 'deploiement' ? {declaredTrainers:[{name:'Formatrice Fictive',email:'trainer@example.invalid'}]}:{}),
  }),
  confirmed:true, ...(kind === 'deploiement' ? {organizationConfirmed:true,changesAcknowledged:true}:{}),
})
const issue = async (kind='contact') => new URL((await issueOperationalLink({db,token:'fictive-token',participationId:7,kind,issuer:'member@example.invalid'})).url).searchParams.get('t')
const post = (token, kind='contact', data=payload(kind), customLocals=locals(), origin='https://euneos.fr') => publicPost({ request:req('/api/suivi/'+kind,{token,...data},{},origin),locals:customLocals,params:{kind} })
const noco = () => calls.filter(c => c.url.startsWith('https://app.nocodb.com/'))
const linkWrites = () => noco().filter(c => c.method === 'PATCH' && c.body?.every(p => Object.keys(p).every(k => k === 'Id' || ['lien_fiche_contact','lien_deploiement','lien_participants'].includes(k))))
const writes = () => noco().filter(c => c.method !== 'GET' && !linkWrites().includes(c))
const mails = () => calls.filter(c => c.url.startsWith('https://api.brevo.com/'))
const count = table => sql.query(`SELECT COUNT(*) n FROM ${table}`).get().n
const noMutation = () => { expect(writes()).toHaveLength(0); expect(mails()).toHaveLength(0); expect(count('operational_submissions')).toBe(0) }
const privateResponse = response => { expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(response.headers.get('X-Robots-Tag')).toContain('noindex'); expect(response.headers.get('Referrer-Policy')).toBe('no-referrer') }


const identity = { schoolName: 'Collège Fictif', city: 'Ville Fictive', schoolYear: '2026-2027' }
const publicSubmit = (extra={}, kind='contact', headers={}) => publicPost({
  request:req('/api/suivi/'+kind,{...contactV2(),access:'public',identity,...extra},headers),
  locals:locals(),params:{kind},
})
const captureWrites = () => calls.filter(c => c.method === 'POST' && c.url.includes('/publicanswerstable/'))
const dossierWrites = () => calls.filter(c => c.method === 'PATCH' && c.url.includes('/'+NC.tables.participations+'/'))

test('public form keeps unknown identities in NocoDB, reveals no record and sends no email', async () => {
  const response = await publicSubmit()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({state:'complete',code:'received',duplicate:false})
  expect(replies).toHaveLength(1)
  expect(JSON.parse(replies[0].reponses).identity).toEqual(identity)
  expect(replies[0].statut_reprise).toBe('À vérifier')
  expect(dossierWrites()).toHaveLength(0); expect(mails()).toHaveLength(0)
})
test('double and concurrent submissions capture only one source', async () => {
  await Promise.all([publicSubmit(),publicSubmit()])
  await publicSubmit()
  expect(captureWrites()).toHaveLength(1); expect(replies).toHaveLength(1)
})
test('known contact and exact dossier project through the existing engine without replacing a personal link', async () => {
  schools[0].referent_email = 'referrer@example.invalid'
  const personal = await issue()
  const response = await publicSubmit()
  expect(response.status).toBe(200)
  expect(replies).toHaveLength(1)
  expect(parts[0].fiche_contact_recue).toBe(true)
  expect(replies[0].statut_reprise).toBe('Reportée dans le dossier')
  expect(new URL(parts[0].lien_fiche_contact).searchParams.get('t')).toBe(personal)
  expect(mails()).toHaveLength(0)
  const again = await publicSubmit()
  expect((await again.json()).duplicate).toBe(true)
})
test('changed answer is retained separately and never overwrites its previous source', async () => {
  await publicSubmit()
  await publicSubmit({schoolDetails:{...contactV2().schoolDetails,address:'Nouvelle adresse fictive'}})
  expect(replies).toHaveLength(2)
  expect(JSON.parse(replies[0].reponses).answers.schoolDetails.address).toBe('Rue fictive')
})
test.each(['referrer@example.invalid','wrong@example.invalid'])('public receipt cannot enumerate known or unknown contacts (%s)', async email => {
  schools[0].referent_email = 'referrer@example.invalid'
  const result = await publicSubmit({referrer:{name:'Référent Exemple',email}})
  expect(await result.json()).toEqual({state:'complete',code:'received',duplicate:false})
})
test('closed or duplicate dossiers never receive a guessed update', async () => {
  schools[0].referent_email = 'referrer@example.invalid'
  parts.push({...parts[0],Id:8})
  await publicSubmit()
  expect(dossierWrites()).toHaveLength(0)
  parts.pop(); parts[0].statut='Refus'
  await publicSubmit({referrer:{name:'Autre',email:'referrer@example.invalid'}})
  expect(dossierWrites()).toHaveLength(0)
})
test('lost NocoDB POST is reconciled without a second POST', async () => {
  let first=true
  hook = async call => {
    if (call.method==='POST' && call.url.includes('/publicanswerstable/') && first) {
      first=false; replies.push({...call.body[0],Id:300}); throw new Error('lost response')
    }
  }
  expect((await publicSubmit()).status).toBe(503)
  expect((await publicSubmit()).status).toBe(200)
  expect(captureWrites()).toHaveLength(1)
})
test('failed read before sending can be retried without losing the response', async () => {
  let first=true
  hook = async call => { if (first && call.url.includes('/publicanswerstable/')) {first=false; throw new Error('offline')} }
  expect((await publicSubmit()).status).toBe(503)
  expect((await publicSubmit()).status).toBe(200)
  expect(replies).toHaveLength(1)
})
test('uncertain POST with no visible record is never repeated automatically', async () => {
  hook = async call => { if (call.method==='POST' && call.url.includes('/publicanswerstable/')) throw new Error('unknown commit') }
  expect((await publicSubmit()).status).toBe(503)
  const retry=await publicSubmit()
  expect(retry.status).toBe(202)
  expect((await retry.json()).state).toBe('processing')
  expect(captureWrites()).toHaveLength(1)
})
test.each([
  {identity:{...identity,participationId:7}}, {identity:{...identity,schoolYear:'2026-2030'}},
  {website:'spam'}, {access:'admin'}, {participationId:7},
])('invalid public input is rejected before any network write', async extra => {
  expect((await publicSubmit(extra)).status).toBe(400)
  expect(writes()).toHaveLength(0)
})
test('public replies are readable only after team authentication', async () => {
  await publicSubmit()
  expect((await teamGet({request:req('/api/interne/formulaires'),locals:locals()})).status).not.toBe(200)
  const response = await teamGet({request:req('/api/interne/formulaires',undefined,{'Cf-Access-Jwt-Assertion':await jwt()}),locals:locals()})
  const result = await response.json()
  expect(result.publicResponses).toHaveLength(1)
  expect(result.publicResponses[0].details[0][1]).toContain('referrer@example.invalid')
})
test('public submissions are limited server-side', async () => {
  for(let i=0;i<20;i++) expect((await publicSubmit()).status).toBe(200)
  expect((await publicSubmit()).status).toBe(429)
  expect(replies).toHaveLength(1)
})
test.each(['deploiement','activites-jeunes','participants'])('public %s uses the same validated questions', async kind => {
  const data=kind==='deploiement'?deploymentV2():kind==='activites-jeunes'?youthV2():payload('participants')
  const response=await publicPost({request:req('/api/suivi/'+kind,{...data,access:'public',identity}),locals:locals(),params:{kind}})
  expect(response.status).toBe(200)
  expect(replies).toHaveLength(1)
})
