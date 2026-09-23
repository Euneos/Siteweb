import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import {
  getOperationalPageContext, issueOperationalLink, operationalError, operationalHash,
  operationalTarget, readOperationalBody, resolveOperationalLink, savedOperationalLinks,
  operationalLinkColumns,
} from '../src/lib/operational-links'
import { NC } from '../src/lib/nocodb'

// Independent security fixtures. SQL is real, transport is fully isolated.
// No real identity, link, credential, database, filesystem DB, or network fallback.
const realFetch = globalThis.fetch
const DAY = 86400000
let sql, db, parts, schools, cohorts, calls, failReads, nocoFault
const wrap = database => ({ prepare: query => ({ bind: (...values) => ({
  run: async () => ({ meta: { changes: database.query(query).run(...values).changes } }),
  first: async () => database.query(query).get(...values),
  all: async () => ({ results: database.query(query).all(...values) }),
}) }) })
beforeEach(() => {
  sql = new Database(':memory:')
  const root = new URL('../migrations/', import.meta.url)
  for (const file of readdirSync(root).filter(x => /^\d.*\.sql$/.test(x)).sort())
    sql.exec(readFileSync(new URL(file, root), 'utf8'))
  db = wrap(sql); calls = []; failReads = false; nocoFault = ''
  parts = [{ Id: 7, etablissements_id: 1, cohortes_id: 2, fusionne_vers: null, statut: 'Engage', notes: 'PRIVATE_NOTE_CANARY', referent_email: 'private@example.invalid' }]
  schools = [{ Id: 1, nom: 'Collège Fictif', ville: 'Ville Fictive', cp: '01000', referent_email: 'private@example.invalid', referent_nom: 'PRIVATE_NAME_CANARY', referent_telephone: 'PRIVATE_PHONE_CANARY' }]
  cohorts = [{ Id: 2, nom: '2026-2027', annee_debut: 2026, annee_fin: 2027, active: true }]
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url: url.href, method, body })
    if (failReads) throw new Error('PRIVATE_TRANSPORT_CANARY fake-token private@example.invalid')
    if (url.origin !== 'https://app.nocodb.com') throw new Error('UNEXPECTED_TRANSPORT')
    const [, , , , table, , id] = url.pathname.split('/')
    const rows = table === NC.tables.participations ? parts : table === NC.tables.etablissements ? schools : table === NC.tables.cohortes ? cohorts : null
    if (!rows) throw new Error('UNEXPECTED_TABLE')
    if (method === 'PATCH' && table === NC.tables.participations) {
      if(nocoFault === 'reject-status') return new Response('PRIVATE_API_CANARY',{status:500})
      if(nocoFault === 'throw-before') throw new Error('PRIVATE_API_CANARY')
      if(nocoFault !== 'drop') for(const patch of body) Object.assign(parts.find(r=>r.Id === patch.Id),patch)
      if(nocoFault === 'throw-after') throw new Error('PRIVATE_API_CANARY')
      if(nocoFault === 'reparent-after') parts[0].etablissements_id=9
      if(nocoFault === 'bad-readback') parts[0].lien_fiche_contact='https://foreign.invalid/'
      return Response.json(body)
    }
    if(method !== 'GET') throw new Error('UNEXPECTED_MUTATION')
    if (id) return Response.json(rows.find(x => x.Id === Number(id)) ?? {}, { status: rows.some(x => x.Id === Number(id)) ? 200 : 404 })
    const offset = Number(url.searchParams.get('offset') ?? 0)
    return Response.json({ list: rows.slice(offset, offset + 1), pageInfo: { isLastPage: offset + 1 >= rows.length } })
  }
})
afterEach(() => { globalThis.fetch = realFetch; sql.close() })
const locals = () => ({ runtime: { env: { OPERATIONAL_FORMS_ENABLED: 'true', FORM_SUBMISSIONS: db, NOCODB_TOKEN: 'fake-token' } } })
const issue = (kind = 'contact', overrides = {}) => issueOperationalLink({ db, token: 'fake-token', participationId: 7, kind, issuer: 'member@example.invalid', ...overrides })
const secretOf = result => new URL(result.url).searchParams.get('t')
const page = (result, kind = 'contact', env = locals()) => getOperationalPageContext(new Request(result.url), env, kind)
const count = table => sql.query(`SELECT COUNT(*) n FROM ${table}`).get().n

test('opaque link has 256 random bits, only token/issuer hashes enter D1, and exactly 90 days of validity', async () => {
  const now = Date.now(), result = await issue('contact', { now }), raw = secretOf(result)
  expect(raw).toMatch(/^[a-f0-9]{64}$/)
  expect(new URL(result.url).origin).toBe('https://euneos.fr')
  expect(new Date(result.expiresAt).getTime() - now).toBe(90 * DAY)
  const rows = sql.query('SELECT * FROM operational_links').all()
  expect(rows).toHaveLength(1); expect(rows[0].token_hash).toBe(await operationalHash(raw))
  expect(JSON.stringify(rows)).not.toContain(raw)
  expect(JSON.stringify(rows)).not.toContain('member@example.invalid')
  expect(rows[0].issuer_hash).toBe(await operationalHash('member@example.invalid'))
  expect((await resolveOperationalLink(db, raw, 'contact', now + 90 * DAY - 1)).target).toEqual({ participationId: 7, schoolId: 1, cohortId: 2 })
  await expect(resolveOperationalLink(db, raw, 'contact', now + 90 * DAY)).rejects.toMatchObject({ status: 403, code: 'lien_invalide' })
})
test('renewal invalidates previous link only in its dossier/kind slot', async () => {
  const first = await issue(), anotherKind = await issue('participants'), second = await issue()
  expect(secretOf(first)).not.toBe(secretOf(second))
  await expect(resolveOperationalLink(db, secretOf(first), 'contact')).rejects.toMatchObject({ status: 403 })
  await resolveOperationalLink(db, secretOf(second), 'contact')
  await resolveOperationalLink(db, secretOf(anotherKind), 'participants')
  expect(count('operational_link_slots')).toBe(2)
  await expect(resolveOperationalLink(db, secretOf(second), 'participants')).rejects.toMatchObject({ status: 403 })
})
test('parallel issuance leaves exactly one usable link, concurrent losers return a controlled conflict', async () => {
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => issue()))
  const successes = results.filter(x => x.status === 'fulfilled').map(x => x.value)
  expect(successes.length).toBeGreaterThan(0)
  for (const r of results.filter(x => x.status === 'rejected')) expect(r.reason).toMatchObject({ status: 409, code: 'dossier_occupe' })
  let valid = 0
  for (const r of successes) { try { await resolveOperationalLink(db, secretOf(r), 'contact'); valid++ } catch (e) { expect(e.status).toBe(403) } }
  expect(valid).toBe(1); expect(count('operational_link_slots')).toBe(1)
})
test('activation failure preserves previous slot and retains lock around the unpublished Noco URL', async () => {
  const previous = await issue()
  const broken = { prepare: query => query.startsWith('INSERT INTO operational_link_slots')
    ? { bind: () => ({ run: async () => { throw new Error('simulated D1 outage') } }) } : db.prepare(query) }
  await expect(issue('contact', { db: broken })).rejects.toThrow()
  await resolveOperationalLink(db, secretOf(previous), 'contact')
  expect(count('operational_links')).toBe(2); expect(count('operational_link_slots')).toBe(1)
  expect(count('operational_submission_locks')).toBe(1)
  expect(await savedOperationalLinks(db,parts[0])).toEqual({})
})
test.each(['contact','participants','deploiement'])('issuance writes only exact target Id plus the %s URL before distribution',async kind=>{
  const before=structuredClone(parts[0]), result=await issue(kind), patches=calls.filter(c=>c.method === 'PATCH')
  expect(patches).toHaveLength(1)
  expect(patches[0].body).toEqual([{Id:7,[operationalLinkColumns[kind]]:result.url}])
  expect(parts[0]).toEqual({...before,[operationalLinkColumns[kind]]:result.url})
  expect(await savedOperationalLinks(db,parts[0])).toEqual({[kind]:result})
  expect(count('operational_submission_locks')).toBe(0)
})
test.each(['reject-status','throw-before','throw-after','drop','bad-readback','reparent-after'])('uncertain URL persistence %s retains lock, old slot, and never advertises the orphan',async fault=>{
  const previous=await issue(); nocoFault=fault
  await expect(issue()).rejects.toThrow()
  expect(count('operational_submission_locks')).toBe(1)
  expect(count('operational_links')).toBe(2)
  const previousHash=await operationalHash(secretOf(previous))
  expect(sql.query('SELECT token_hash FROM operational_link_slots').get().token_hash).toBe(previousHash)
  const links=await savedOperationalLinks(db,parts[0])
  if(links.contact) expect(links.contact.url).toBe(previous.url)
  const patchCount=calls.filter(c=>c.method === 'PATCH').length
  nocoFault=''
  await expect(issue()).rejects.toThrow()
  expect(calls.filter(c=>c.method === 'PATCH')).toHaveLength(patchCount)
})
test('D1 failure before URL mutation releases lock and preserves the distributed previous URL',async()=>{
  const previous=await issue(), patchCount=calls.filter(c=>c.method === 'PATCH').length
  const broken={prepare:query=>query.startsWith('INSERT INTO operational_links ')
    ? {bind:()=>({run:async()=>{throw new Error('simulated journal outage')}})}:db.prepare(query)}
  await expect(issue('contact',{db:broken})).rejects.toThrow()
  expect(count('operational_submission_locks')).toBe(0)
  expect(calls.filter(c=>c.method === 'PATCH')).toHaveLength(patchCount)
  expect(await savedOperationalLinks(db,parts[0])).toEqual({contact:previous})
})
test('stored URLs reject obsolete, expired, foreign, redirected and incorrectly scoped values',async()=>{
  const issued=await issue(), original=structuredClone(parts[0]), url=issued.url
  for(const bad of ['javascript:alert(1)',url.replace('euneos.fr','foreign.invalid'),url.replace('https://','https://user@'),url+'&extra=1',url+'&t=another',url+'#fragment',url.replace('/fiche-contact','/participants')]) {
    expect(await savedOperationalLinks(db,{...original,lien_fiche_contact:bad})).toEqual({})
  }
  for(const override of [{Id:8},{etablissements_id:8},{cohortes_id:8}]) expect(await savedOperationalLinks(db,{...original,...override})).toEqual({})
  await issue(); expect(await savedOperationalLinks(db,original)).toEqual({})
  sql.exec('UPDATE operational_links SET expires_at=0'); expect(await savedOperationalLinks(db,parts[0])).toEqual({})
})
test.each([undefined, '', 'demo', 'a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64), '0'.repeat(64), 7])('invalid bearer %s exposes no target or private data', async raw => {
  let response
  try { await resolveOperationalLink(db, raw, 'contact'); throw new Error('accepted invalid token') } catch (e) { response = operationalError(e) }
  expect(response.status).toBe(403)
  const text = await response.text(); expect(text).not.toContain('PRIVATE_'); expect(text).not.toContain('schoolId')
  expect(calls).toHaveLength(0)
})
test.each(['Abandonné', 'Annulé', 'Refusé', 'Archivé'])('closed dossier %s cannot issue a link', async state => {
  parts[0].statut = state
  await expect(issue()).rejects.toMatchObject({ status: 409 })
  expect(count('operational_links')).toBe(0)
})
test.each(['other cohort','inactive cohort','multiple active cohorts','archive','missing school relation'])('invalid target cannot issue: %s', async reason => {
  if (reason === 'other cohort') parts[0].cohortes_id = 1
  if (reason === 'inactive cohort') cohorts[0].active = false
  if (reason === 'multiple active cohorts') cohorts.push({ ...cohorts[0], Id: 3 })
  if (reason === 'archive') parts[0].fusionne_vers = 8
  if (reason === 'missing school relation') parts[0].etablissements_id = null
  await expect(issue()).rejects.toMatchObject({ status: 409 })
  expect(count('operational_links')).toBe(0)
})
test.each(['reparented school','reparented cohort','closed','archived'])('a valid bearer does not authorize a changed dossier: %s', async change => {
  const result = await issue()
  if (change === 'reparented school') parts[0].etablissements_id = 2
  if (change === 'reparented cohort') parts[0].cohortes_id = 3
  if (change === 'closed') parts[0].statut = 'Abandonné'
  if (change === 'archived') parts[0].fusionne_vers = 8
  const response = await page(result)
  expect(response).toBeInstanceOf(Response); expect(response.status).toBe(409)
  expect(await response.text()).not.toContain('PRIVATE_')
})
test('public page context reveals only school/city/cohort, no existing answer or contact prefill', async () => {
  const result = await issue(), context = await page(result)
  expect(context).not.toBeInstanceOf(Response)
  expect(context.state).toBe('ready'); expect(context.preview).toBe(false)
  expect(context.context).toEqual({ schoolName: 'Collège Fictif', city: 'Ville Fictive', cohortLabel: '2026-2027' })
  expect(JSON.stringify(context)).not.toContain('PRIVATE_'); expect(JSON.stringify(context)).not.toContain('private@example.invalid')
})
test('previews use only demo context, never touch NocoDB or a D1 binding even if enabled', async () => {
  const poison = { runtime: { env: { OPERATIONAL_FORMS_ENABLED: 'true', NOCODB_TOKEN: 'fake', FORM_SUBMISSIONS: { prepare() { throw new Error('PREVIEW_DB_ACCESS') } } } } }
  const demo = await getOperationalPageContext(new Request('https://pr-1.euneos-site.pages.dev/suivi/fiche-contact?t=demo'), poison, 'contact')
  expect(demo.preview).toBe(true); expect(demo.context.schoolName).toBe('Collège Exemple')
  const live = await getOperationalPageContext(new Request('https://pr-1.euneos-site.pages.dev/suivi/fiche-contact?t=' + 'a'.repeat(64)), poison, 'contact')
  expect(live.status).toBe(404); expect(calls).toHaveLength(0)
})
test('disabled production and real production demo fail closed without database access', async () => {
  const missing = await getOperationalPageContext(new Request('https://euneos.fr/suivi/fiche-contact?t=demo'), {}, 'contact')
  expect(missing.status).toBe(503)
  const demo = await getOperationalPageContext(new Request('https://euneos.fr/suivi/fiche-contact?t=demo'), locals(), 'contact')
  expect(demo.status).toBe(403); expect(calls).toHaveLength(0)
})
test('unexpected backend errors are private 503s without URLs, bearer, input or raw error', async () => {
  const result = await issue(); failReads = true
  const response = await page(result)
  expect(response.status).toBe(503)
  for (const [name, value] of [['Referrer-Policy','no-referrer'],['X-Robots-Tag','noindex']]) expect(response.headers.get(name)).toContain(value)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const text = await response.text()
  for (const secret of ['PRIVATE_', 'fake-token', 'private@example.invalid', secretOf(result), 'app.nocodb.com']) expect(text).not.toContain(secret)
})
const requestBody = (body, overrides = {}) => new Request('https://euneos.fr/api/suivi/contact', { method: 'POST', headers: { Origin: 'https://euneos.fr', 'Content-Type': 'application/json', ...overrides }, body })
test.each([null,'https://evil.invalid','null'])('write body rejects absent/cross origin %s before parsing', async origin => {
  const req = requestBody('{}'); if (origin === null) req.headers.delete('origin'); else req.headers.set('origin', origin)
  await expect(readOperationalBody(req)).rejects.toMatchObject({ status: 403 })
})
test('body parser rejects cross-site fetch, non JSON and array/null/malformed JSON', async () => {
  await expect(readOperationalBody(requestBody('{}', { 'Sec-Fetch-Site': 'cross-site' }))).rejects.toMatchObject({ status: 403 })
  await expect(readOperationalBody(requestBody('{}', { 'Content-Type': 'text/plain' }))).rejects.toMatchObject({ status: 415 })
  for (const bad of ['null','[]','"text"','{broken']) await expect(readOperationalBody(requestBody(bad))).rejects.toMatchObject({ status: 400 })
  expect(await readOperationalBody(requestBody('{"token":"fake"}'))).toEqual({ token: 'fake' })
})
test('actual streamed bytes are bounded despite missing or false Content-Length; malformed UTF8 rejected', async () => {
  const bytes = new TextEncoder().encode('x'.repeat(65537)); let sent = false, cancelled = false
  const body = new ReadableStream({ pull(controller) { if (!sent) { sent = true; controller.enqueue(bytes) } }, cancel() { cancelled = true } })
  await expect(readOperationalBody(requestBody(body, { 'Content-Length': '2' }))).rejects.toMatchObject({ status: 413 })
  expect(cancelled).toBe(true)
  await expect(readOperationalBody(requestBody(new Uint8Array([0xff, 0xfe])))).rejects.toMatchObject({ status: 400 })
})
