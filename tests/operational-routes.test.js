import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { GET as teamGet, POST as teamPost } from '../src/pages/api/interne/formulaires'
import { POST as publicPost } from '../src/pages/api/suivi/[kind]'
import { GET as legacyGet, POST as legacyPost } from '../src/pages/api/hook/google-forms'
import { issueOperationalLink, operationalHash, getOperationalPageContext } from '../src/lib/operational-links'
import { NC } from '../src/lib/nocodb'
import { OPERATIONAL_ADULTS_TABLE } from '../src/lib/operational-data'
import { readContact, writeContact } from '../src/lib/google-form-contact'

// Real route, JWT verification, SQL and storage logic; every external transport
// is intercepted, with no network fallback. All persons and credentials fictive.
const realFetch = globalThis.fetch
const issuer = 'https://operational-review-test.cloudflareaccess.com'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'operational-review', alg: 'RS256', use: 'sig' }
let sql, db, env, parts, schools, cohorts, adults, calls, hook, providerFailure
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
  adults = []
  env = { INTERNAL_ACCESS_DOMAIN: new URL(issuer).hostname, INTERNAL_ACCESS_AUD: 'team',
    RESOURCE_ACCESS_DOMAIN: new URL(issuer).hostname, RESOURCE_ACCESS_AUD: 'trainers', INTERNAL_ADMIN_EMAILS: 'manager@example.invalid',
    TEAM_WORKSPACE: { prepare() { throw new Error('Unexpected workspace access') } },
    OPERATIONAL_FORMS_ENABLED: 'true', FORM_SUBMISSIONS: db, NOCODB_TOKEN: 'fictive-token' }
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
    const rows = table === NC.tables.participations ? parts : table === NC.tables.etablissements ? schools : table === NC.tables.cohortes ? cohorts : table === OPERATIONAL_ADULTS_TABLE ? adults : null
    if (!rows) throw new Error('UNEXPECTED_TABLE')
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

test('team JWT permits issuance by an ordinary member; D1 stores no identity or bearer', async () => {
  const response = await teamPost({request:req('/api/interne/formulaires',{participationId:7,kind:'contact'},{'Cf-Access-Jwt-Assertion':await jwt()}),locals:locals()})
  expect(response.status).toBe(201); privateResponse(response)
  const data = await response.json(), token = new URL(data.url).searchParams.get('t')
  const row = sql.query('SELECT * FROM operational_links').get()
  expect(row.token_hash).toBe(await operationalHash(token)); expect(row.issuer_hash).toBe(await operationalHash('member@example.invalid'))
  expect(JSON.stringify(row)).not.toContain(token); expect(JSON.stringify(row)).not.toContain('@')
  expect(linkWrites()).toHaveLength(1); noMutation()
})
test.each(['missing','email header only','trainers','other audience','expired','wrong issuer'])('team GET/POST deny %s before NocoDB/D1 reads', async scenario => {
  let headers = {}
  if (scenario === 'email header only') headers = {'Cf-Access-Authenticated-User-Email':'manager@example.invalid'}
  else if (scenario !== 'missing') headers = {'Cf-Access-Jwt-Assertion': await jwt(scenario === 'trainers' ? 'trainers' : scenario === 'other audience' ? 'foreign' : 'team', scenario === 'expired' ? {exp:'-1s'} : scenario === 'wrong issuer' ? {issuer:'https://foreign.cloudflareaccess.com'} : {})}
  env.FORM_SUBMISSIONS = {prepare(){throw new Error('AUTH_BYPASS_DB')}}
  for (const [handler,body] of [[teamGet,undefined],[teamPost,{participationId:7,kind:'contact'}]]) {
    const response = await handler({request:req('/api/interne/formulaires',body,headers),locals:locals()})
    expect(response.status).toBe(403)
  }
  expect(noco()).toHaveLength(0); expect(count('operational_links')).toBe(0)
})
test('team read returns school labels and technical journal only, never notes/referrer details', async () => {
  const bearer=await issue()
  const response = await teamGet({request:req('/api/interne/formulaires',undefined,{'Cf-Access-Jwt-Assertion':await jwt()}),locals:locals()})
  expect(response.status).toBe(200)
  const body = await response.json(); expect(body.dossiers[0]).toMatchObject({participationId:7,schoolName:'Collège Fictif',code:'DOS-FICTIF'})
  expect(new URL(body.dossiers[0].links.contact.url).searchParams.get('t')).toBe(bearer)
  expect(JSON.stringify(body)).not.toContain('PRIVATE_'); expect(JSON.stringify(body)).not.toContain('private@example.invalid')
})
test('authenticated preview disables issuance and dossier listing without touching D1/Noco', async () => {
  env.FORM_SUBMISSIONS={prepare(){throw new Error('PREVIEW_DB_ACCESS')}}
  const headers = {'Cf-Access-Jwt-Assertion':await jwt()}, origin='https://pr-3.euneos-site.pages.dev'
  const listed=await teamGet({request:req('/api/interne/formulaires',undefined,headers,origin),locals:locals()})
  expect(await listed.json()).toEqual({enabled:false,dossiers:[],submissions:[],preview:true})
  expect((await teamPost({request:req('/api/interne/formulaires',{participationId:7,kind:'contact'},headers,origin),locals:locals()})).status).toBe(409)
  expect(noco()).toHaveLength(0)
})
test.each(['contact','deploiement','participants'])('public preview %s validates answers but never touches Noco/D1/Brevo', async kind => {
  const poison=new Proxy({}, {get(){throw new Error('PREVIEW_ENV_ACCESS')}}), origin='https://pr-3.euneos-site.pages.dev'
  const response=await post('demo',kind,payload(kind),poison,origin)
  expect(response.status).toBe(200); privateResponse(response); expect(await response.json()).toMatchObject({state:'complete',preview:true})
  expect((await post('demo',kind,{...payload(kind),confirmed:false},poison,origin)).status).toBe(400)
  expect((await post('a'.repeat(64),kind,payload(kind),poison,origin)).status).toBe(403)
  expect(calls).toHaveLength(0)
})
test.each(['missing','expired','revoked','wrong kind','demo'])('public submission denies %s bearer before Noco or journal mutation', async reason => {
  let token = reason === 'missing' ? undefined : reason === 'demo' ? 'demo' : await issue()
  if (reason === 'expired') sql.exec('UPDATE operational_links SET expires_at=0')
  if (reason === 'revoked') await issue()
  calls=[]
  const kind=reason === 'wrong kind' ? 'participants':'contact'
  const response=await post(token,kind)
  expect(response.status).toBe(403); privateResponse(response)
  expect(noco()).toHaveLength(0); noMutation()
})
test.each(['reparented school','wrong cohort','closed','archive'])('submission denies changed target: %s', async reason => {
  const token=await issue()
  if(reason === 'reparented school') parts[0].etablissements_id=9
  if(reason === 'wrong cohort') parts[0].cohortes_id=9
  if(reason === 'closed') parts[0].statut='Abandonné'
  if(reason === 'archive') parts[0].fusionne_vers=8
  const response=await post(token)
  expect(response.status).toBe(409); noMutation()
})
test.each(['disabled','no token','no D1'])('production %s configuration fails closed', async reason => {
  if(reason === 'disabled') env.OPERATIONAL_FORMS_ENABLED='false'
  if(reason === 'no token') delete env.NOCODB_TOKEN
  if(reason === 'no D1') delete env.FORM_SUBMISSIONS
  const response=await post('a'.repeat(64)); expect(response.status).toBe(503); expect(noco()).toHaveLength(0); noMutation()
})
test('origin/media/stream bounds are enforced on both public and authenticated team routes', async () => {
  const auth={'Cf-Access-Jwt-Assertion':await jwt()}
  for(const [headers,body,status] of [[{Origin:''},'{}',403],[{Origin:'https://foreign.invalid'},'{}',403],[{'Sec-Fetch-Site':'cross-site'},'{}',403],[{'Content-Type':'text/plain'},'{}',415],[{},'x'.repeat(65537),413],[{},'{broken',400]]) {
    for(const [handler,path,extra] of [[publicPost,'/api/suivi/contact',{}],[teamPost,'/api/interne/formulaires',auth]]) {
      const response=await handler({request:req(path,body,{...extra,...headers}),locals:locals(),params:{kind:'contact'}})
      expect(response.status).toBe(status); privateResponse(response)
    }
  }
  expect(noco()).toHaveLength(0); noMutation()
})
test('scope escalation through body fields fails before submission journal creation', async () => {
  const token=await issue()
  for(const injected of [{participationId:99},{target:{participationId:99,schoolId:9,cohortId:9}},{schoolId:9},{kind:'deploiement'}]) {
    const response=await post(token,'contact',{...payload(),...injected}); expect(response.status).toBe(400)
  }
  noMutation()
})
test('accepted response is one-time, redacted and stable on replay; changed answers do not overwrite', async () => {
  const token=await issue(), response=await post(token)
  expect(response.status).toBe(200); privateResponse(response)
  const first=await response.json(); expect(first).toMatchObject({state:'complete',duplicate:false,code:'saved'})
  expect(writes()).toHaveLength(1)
  const second=await (await post(token)).json()
  expect(second).toMatchObject({state:'complete',duplicate:true,receipt:first.receipt})
  const changedResponse=await post(token,'contact',{...payload(),referrer:{name:'Other Fictive',email:'other@example.invalid'}})
  const changed=await changedResponse.json()
  expect(changed).toMatchObject({state:'review',code:'payload_changed'}); expect(writes()).toHaveLength(1)
  for(const body of [first,second,changed,sql.query('SELECT * FROM operational_submissions').get()]) {
    expect(JSON.stringify(body)).not.toContain('PRIVATE_'); expect(JSON.stringify(body)).not.toContain('referrer@example.invalid'); expect(JSON.stringify(body)).not.toContain(token)
  }
  const page=await getOperationalPageContext(req('/suivi/fiche-contact?t='+token),locals(),'contact')
  expect(page.state).toBe('complete')
  // A second tab may hold a different draft with the same now-consumed token.
  // The new answers are refused, not persisted for team review: keep them visible.
  expect(readContact(parts[0].notes).operationalSubmissions).toHaveLength(1)
  expect(changedResponse.status).toBeGreaterThanOrEqual(400)
})
test('concurrent copies of the same answer cause one write and one acknowledgement claim', async () => {
  const token=await issue()
  const results=await Promise.all(Array.from({length:8},()=>post(token).then(r=>r.json())))
  expect(results.filter(r=>!r.duplicate && r.state === 'complete')).toHaveLength(1)
  expect(writes()).toHaveLength(1); expect(count('operational_submissions')).toBe(1); expect(count('operational_mail_receipts')).toBe(1)
})
test('provider failure preserves completed submission and does not resend on replay', async () => {
  env.BREVO_API_KEY='fictive-provider'; env.BREVO_SENDER_EMAIL='sender@example.invalid'; providerFailure=true
  const token=await issue(), response=await post(token), first=await response.json()
  expect(response.status).toBe(200); expect(first).toMatchObject({state:'complete',acknowledgement:'uncertain'})
  const second=await (await post(token)).json(); expect(second).toMatchObject({state:'complete',duplicate:true})
  expect(mails()).toHaveLength(1); expect(sql.query('SELECT state FROM operational_mail_receipts').get().state).toBe('uncertain')
  expect(JSON.stringify(first)).not.toContain('PRIVATE_')
})
test('pre-auth backend failures expose no raw provider message, bearer or submitted person', async () => {
  const token=await issue(); hook=()=>{throw new Error('PRIVATE_TRANSPORT_CANARY referrer@example.invalid fictive-token')}
  const response=await post(token), body=await response.text()
  expect(response.status).toBe(503); privateResponse(response)
  for(const secret of ['PRIVATE_','fictive-token','referrer@example.invalid',token]) expect(body).not.toContain(secret)
  noMutation()
})
test('a prewrite read outage must not acknowledge data that was never saved', async () => {
  const token=await issue()
  hook=c=>{if(c.url.includes(OPERATIONAL_ADULTS_TABLE)) throw new Error('simulated read outage')}
  const response=await post(token)
  expect(writes()).toHaveLength(0)
  expect(sql.query('SELECT state,mutation_started FROM operational_submissions').get()).toEqual({state:'retryable',mutation_started:0})
  // Non-2xx keeps the caller\'s form/saisie visible. A 200/review hides it although
  // neither NocoDB nor the journal contains the answers, and no worker will resume.
  expect(response.status).toBeGreaterThanOrEqual(400)
  hook=undefined
  const retry=await post(token)
  expect(retry.status).toBe(200); expect((await retry.json()).state).toBe('complete')
  expect(writes()).toHaveLength(1); expect(count('operational_submissions')).toBe(1)
  expect(readContact(parts[0].notes).operationalSubmissions).toHaveLength(1)
})
test('a distinct link blocked by a target lock must not acknowledge or hide unsaved answers', async () => {
  const contact=await issue(), participants=await issue('participants')
  let unlock, signal
  const held=new Promise(resolve=>{signal=resolve}), release=new Promise(resolve=>{unlock=resolve})
  let paused=false
  hook=async c=>{if(c.method === 'PATCH' && !paused){paused=true;signal();await release}}
  const first=post(contact)
  await held
  let response
  try { response=await post(participants,'participants') } finally { unlock(); await first }
  const row=sql.query('SELECT state,code,mutation_started FROM operational_submissions WHERE kind=?').get('participants')
  expect(row).toEqual({state:'retryable',code:'target_busy',mutation_started:0})
  expect(adults).toHaveLength(0)
  // There is no durable payload/queue to honor a 202. The public UI treats every
  // processing response as terminal, so this must explicitly remain retryable.
  expect(response.status).toBeGreaterThanOrEqual(400)
  const retry=await post(participants,'participants')
  expect(retry.status).toBe(200); expect((await retry.json()).state).toBe('complete')
  expect(adults).toHaveLength(1)
  expect(readContact(parts[0].notes).operationalSubmissions).toHaveLength(2)
})
test('uncertain renewal blocks both reissuance and old-link submission without exposing its orphan URL', async () => {
  const previous=await issue(), beforeNotes=parts[0].notes
  hook=c=>{if(c.method === 'PATCH' && c.body?.[0]?.lien_fiche_contact) throw new Error('PRIVATE_URL_WRITE_UNCERTAIN')}
  const auth={'Cf-Access-Jwt-Assertion':await jwt()}
  const failure=await teamPost({request:req('/api/interne/formulaires',{participationId:7,kind:'contact'},auth),locals:locals()})
  expect(failure.status).toBe(503)
  const text=await failure.text(); expect(text).not.toContain('PRIVATE_'); expect(text).not.toContain('?t=')
  expect(count('operational_submission_locks')).toBe(1)
  hook=undefined
  const submitted=await post(previous)
  expect(submitted.status).toBeGreaterThanOrEqual(400)
  const renewed=await teamPost({request:req('/api/interne/formulaires',{participationId:7,kind:'contact'},auth),locals:locals()})
  expect(renewed.status).toBe(409)
  expect(writes()).toHaveLength(0); expect(mails()).toHaveLength(0); expect(parts[0].notes).toBe(beforeNotes)
})
test('renewal before the first write prevents the older in-flight bearer from committing', async () => {
  const token=await issue()
  let unlock, signal
  const held=new Promise(resolve=>{signal=resolve}), release=new Promise(resolve=>{unlock=resolve})
  let paused=false
  hook=async c=>{if(c.method === 'GET' && c.url.endsWith(`/tables/${NC.tables.participations}/records/7`) && !paused){paused=true;signal();await release}}
  // Suspend after bearer resolution but before route target read and before the
  // store has claimed a target lock or sent any mutation.
  const inFlight=post(token); await held
  let renewed, renewalError, result
  try { try { renewed=await issue() } catch(e) { renewalError=e } }
  finally { unlock(); result=await inFlight }
  if(renewalError) expect(renewalError.status).toBe(409)
  else {
    expect(renewed).not.toBe(token)
    expect(writes()).toHaveLength(0)
    expect(result.status).toBeGreaterThanOrEqual(400)
  }
})
test('same-kind renewal cannot replace the only receipt link while its target write is locked', async () => {
  const token=await issue()
  let unlock, signal
  const held=new Promise(resolve=>{signal=resolve}), release=new Promise(resolve=>{unlock=resolve})
  let paused=false
  hook=async c=>{if(c.method === 'PATCH' && !paused){paused=true;signal();await release}}
  const inFlight=post(token); await held
  expect(count('operational_submission_locks')).toBe(1)
  let outcome
  try { outcome=await issue().then(value=>({value}),error=>({error})) }
  finally { unlock(); await inFlight }
  expect(outcome.error).toMatchObject({status:409})
  expect((await getOperationalPageContext(req('/suivi/fiche-contact?t='+token),locals(),'contact')).state).toBe('complete')
})
test('expiration reached after route resolution is checked again under the mutation lock', async () => {
  const token=await issue(); let delayed=false
  hook=c=>{
    if(!delayed && c.method === 'GET' && c.url.endsWith(`/tables/${NC.tables.participations}/records/7`)) {
      delayed=true
      // Models crossing the expiry boundary between auth and lock acquisition.
      sql.exec('UPDATE operational_links SET expires_at=0')
    }
  }
  const response=await post(token)
  expect(writes()).toHaveLength(0)
  expect(response.status).toBeGreaterThanOrEqual(400)
})
test.each(['school','closed','archived status'])('store revalidates changed %s after route authorization and before mutation', async what => {
  const token=await issue(); let participationReads=0
  hook=c=>{
    if(c.method === 'GET' && c.url.endsWith(`/tables/${NC.tables.participations}/records/7`) && ++participationReads === 2) {
      if(what === 'school') parts[0].etablissements_id=9
      else parts[0].statut=what === 'closed' ? 'Abandonné':'Archivé'
    }
  }
  const response=await post(token)
  expect(writes()).toHaveLength(0); expect(mails()).toHaveLength(0)
  expect(response.status).toBeGreaterThanOrEqual(400)
})
test('ambiguous dates are durably retained for review without overwriting business dates or creating adults', async () => {
  parts[0].date_debut_formation='2026-11-01'; parts[0].date_fin_formation='2027-02-01'
  const token=await issue(), data={...payload(),participants:payload('participants').participants}
  const response=await post(token,'contact',data), result=await response.json()
  expect(response.status).toBe(200); expect(result).toMatchObject({state:'review',code:'dates_conflict'})
  expect(parts[0].date_debut_formation).toBe('2026-11-01'); expect(adults).toHaveLength(0)
  const projection=readContact(parts[0].notes)
  expect(projection.operationalSubmissions[0].data.participants[0].firstName).toBe('Adulte')
  expect(projection.operationalSubmissions[0].data.formation.start).toBe('2026-10-01')
  expect(writes()).toHaveLength(1); expect(count('operational_submission_locks')).toBe(0)
})
test.each(['2025-10-01','2028-10-01'])('out-of-cohort date %s remains a flagged declaration, not a training date', async date => {
  const token=await issue(), data={...payload(),formation:{...payload().formation,start:date,end:date}}
  const result=await (await post(token,'contact',data)).json()
  expect(result).toMatchObject({state:'review',code:'dates_outside_cohort'})
  expect(parts[0].date_debut_formation).toBeUndefined(); expect(mails()).toHaveLength(0)
  expect(readContact(parts[0].notes).operationalSubmissions[0].data.formation.start).toBe(date)
})
test('new participant declarations preserve historical provenance, qualifications, dates and already formed people', async () => {
  const original={version:1,source:{spreadsheetId:'fictional-sheet',rows:[2,5],readAt:'2026-09-22T12:00:00+02:00'},receivedAt:'2026-09-22',
    formation:{start:'2026-10-01',end:'2027-02-01',kind:'deploiement',format:'Existant',planning:'Existant',issues:[]},declaredTrainers:[{name:'Formatrice Fictive'}],
    participants:{declared:'Ancienne déclaration',unresolved:['Nom à qualifier'],importedCount:1,qualification:'qualification humaine',structured:[{firstName:'Adulte',lastName:'Antérieur',qualification:'Validé'}]}}
  parts[0].notes=writeContact('Note humaine',original)+'\nAutre note humaine'; parts[0].statut_formation='Programmée'
  adults=[{Id:99,adulte_id:'EXISTANT',prenom:'Adulte',nom:'Antérieur',email:'prior@example.invalid',fonction:'Existant',statut:'Formé',participations_id:7}]
  const token=await issue('participants'), response=await post(token,'participants')
  expect((await response.json()).state).toBe('complete'); expect(adults).toHaveLength(2)
  expect(adults[0].statut).toBe('Formé'); expect(adults[1].statut).toBe('Inscrit'); expect(adults[1].participations_id).toBe(7)
  const after=readContact(parts[0].notes)
  expect(after.source).toEqual(original.source); expect(after.receivedAt).toEqual(original.receivedAt); expect(after.formation).toEqual(original.formation)
  expect(after.participants.unresolved).toEqual(original.participants.unresolved); expect(after.participants.qualification).toBe(original.participants.qualification)
  expect(after.participants.structured[0]).toEqual(original.participants.structured[0]); expect(after.participants.structured).toHaveLength(2)
  expect(parts[0].notes.startsWith('Note humaine')).toBe(true); expect(parts[0].notes.endsWith('Autre note humaine')).toBe(true)
  expect(parts[0].statut_formation).toBe('Programmée')
  expect(writes().every(c=>c.url.includes(OPERATIONAL_ADULTS_TABLE)||c.url.includes(NC.tables.participations))).toBe(true)
})
test('deployment without optional dates preserves previously recorded dates', async () => {
  parts[0].date_debut_formation='2026-10-01'; parts[0].date_fin_formation='2027-02-01'
  const token=await issue('deploiement'), data=payload('deploiement')
  delete data.formation.start; delete data.formation.end
  const response=await post(token,'deploiement',data), result=await response.json()
  expect(response.status).toBe(200); expect(result.state).toBe('complete')
  expect(parts[0].date_debut_formation).toBe('2026-10-01'); expect(parts[0].date_fin_formation).toBe('2027-02-01')
  expect(readContact(parts[0].notes).operationalSubmissions[0].data.formation.start).toBe('')
})
test('retired Google endpoints cannot access locals, credentials or a legacy payload', async () => {
  for(const handler of [legacyGet,legacyPost]) {
    const response=await handler(new Proxy({}, {get(){throw new Error('Legacy access')}}))
    expect(response.status).toBe(410); expect(await response.json()).toEqual({code:'legacy_retired'})
  }
  expect(calls).toHaveLength(0)
})
test('actual middleware protects bearer documents and APIs, including error responses', async () => {
  const source=readFileSync(new URL('../src/middleware.ts',import.meta.url),'utf8')
  // Only the Astro framework identity wrapper is substituted, in memory. No
  // production module/file changes or global module mocks are needed.
  const executable=new Bun.Transpiler({loader:'ts'}).transformSync(source.replace("import { defineMiddleware } from 'astro:middleware'",'const defineMiddleware = (handler) => handler').replace('export const onRequest','const onRequest'))
  const middleware=new Function(executable+'\nreturn onRequest')()
  for(const path of ['/suivi/fiche-contact?t=secret','/suivi/participants?t=secret','/api/suivi/deploiement']) {
    const response=await middleware({request:req(path)},async()=>new Response('not available',{status:403}))
    expect(response.status).toBe(403); privateResponse(response)
  }
})
