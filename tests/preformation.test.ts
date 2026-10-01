import { afterEach, beforeEach, expect, test, setSystemTime } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { POST } from '../src/pages/api/questionnaires/pre-formation'
import { GET as teamGet } from '../src/pages/api/interne/formulaires'
import { listPublicForms } from '../src/lib/public-forms'
import {
  run as runGoogle,
  type Env as GoogleEnv,
  type PushSnapshot,
} from '../workers/google-transition/worker'
import { digest } from '../src/lib/google-form-sync'
import { parsePreformation } from '../src/lib/preformation'
import { preformationQuestions, preformationVersion } from '../src/lib/preformation-definition'

import { preformationProjectionConfig } from '../src/lib/preformation-projection'
import {
  preformationPersonConfig,
  preformationAdult,
  preformationDossier,
} from './fixtures/preformation-person'

let people: any[], dossier: any, adultWrites: any[], blockReadback: boolean
let beforeAdultWrite: (() => Promise<void>) | null
const projection = () =>
  sql.query('SELECT * FROM public_preformation_projections LIMIT 1').get() as any
const realFetch = globalThis.fetch
let sql: Database, db: any, env: any, rows: any[], calls: any[], behavior: string
const answers = () =>
  Object.fromEntries(
    preformationQuestions.map((q) => [
      q.key,
      q.key === 'name'
        ? 'Adulte Fictif'
        : q.key === 'email'
          ? 'adult@example.invalid'
          : q.key === 'year'
            ? '2026-2027'
            : q.key === 'school'
              ? 'École fictive'
              : (q.choices[0] ?? 'Réponse fictive'),
    ]),
  )
const body = () => ({ version: preformationVersion, website: '', answers: answers() })
const request = (data: unknown = body(), origin = 'https://euneos.fr', headers = {}) =>
  new Request(origin + '/api/questionnaires/pre-formation', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  })
const locals = () => ({ runtime: { env } })
const post = (data: unknown = body(), origin?: string, headers?: any) =>
  POST({ request: request(data, origin, headers), locals: locals() } as any)
beforeEach(() => {
  setSystemTime(new Date('2026-10-01T22:30:00Z'))
  people = [preformationAdult()]
  dossier = preformationDossier()
  adultWrites = []
  blockReadback = false
  beforeAdultWrite = null
  sql = new Database(':memory:')
  const root = new URL('../migrations/', import.meta.url)
  for (const f of readdirSync(root)
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort())
    sql.exec(readFileSync(new URL(f, root), 'utf8'))
  sql.exec(
    readFileSync(new URL('../workers/google-transition/schema.sql', import.meta.url), 'utf8'),
  )
  db = {
    prepare: (query: string) => ({
      bind: (...values: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
        first: async () => sql.query(query).get(...values),
        all: async () => ({ results: sql.query(query).all(...values) }),
      }),
    }),
  }
  env = {
    FORM_SUBMISSIONS: db,
    NOCODB_TOKEN: 'fictive-only',
    OPERATIONAL_FORMS_ENABLED: 'true',
    PUBLIC_FORMS_TABLE: 'publicanswerstable',
    PRE_FORMATION_PERSON_PROJECTION: JSON.stringify(preformationPersonConfig),
  }
  rows = []
  calls = []
  behavior = ''
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input)),
      method = init?.method ?? 'GET'
    calls.push({ method, url: url.href })
    // No mail, directory or production network fallback is permitted.
    if (
      url.origin !== 'https://app.nocodb.com' ||
      ![
        'publicanswerstable',
        preformationPersonConfig.tables.people,
        preformationPersonConfig.tables.records,
      ].some((t) => url.pathname.startsWith('/api/v2/tables/' + t + '/records'))
    )
      throw new Error('Unexpected transport')
    const table = url.pathname.split('/')[4]
    // Site sends NocoDB batches, the real Worker sends individual records.
    const payload = init?.body ? JSON.parse(init.body) : null
    const records = payload ? (Array.isArray(payload) ? payload : [payload]) : []
    if (table !== 'publicanswerstable') {
      if (behavior === 'adult-read-failure' || blockReadback)
        throw new Error('PRIVATE_ADULT_READ_ERROR')
      if (table === preformationPersonConfig.tables.records) {
        if (method !== 'GET') throw new Error('Unexpected dossier mutation')
        return Response.json(dossier)
      }
      if (method !== 'GET') {
        adultWrites.push({ method, body: payload })
        await beforeAdultWrite?.()
        if (behavior === 'adult-lost-before-save') throw new Error('PRIVATE_ADULT_WRITE_ERROR')
        for (const patch of records) {
          if (method === 'POST') people.push({ ...patch, Id: 100 + people.length })
          else
            Object.assign(
              people.find((p) => p.Id === patch.Id),
              patch,
            )
        }
        if (behavior === 'adult-readback-lost') blockReadback = true
        if (behavior === 'adult-lost-after-save') throw new Error('PRIVATE_ADULT_WRITE_ERROR')
        return Response.json(JSON.parse(init.body))
      }
      const personId = /records\/(\d+)$/.exec(url.pathname)?.[1]
      if (personId) return Response.json(people.find((p) => p.Id === Number(personId)) ?? {})
      const where = url.searchParams.get('where') ?? ''
      const matches = people.filter((p) =>
        where.includes('(participations_id,eq,')
          ? where === `(participations_id,eq,${p.participations_id})`
          : where.includes(`(email,eq,${p.email})`) ||
            (p.email_2 && where.includes(`(email_2,eq,${p.email_2})`)) ||
            (p.adulte_id && where.includes(`(adulte_id,eq,${p.adulte_id})`)),
      )
      return Response.json({
        list: matches,
        pageInfo: { isLastPage: behavior !== 'truncated-adults' },
      })
    }
    if (method === 'PATCH') {
      for (const patch of records)
        Object.assign(
          rows.find((r) => r.Id === patch.Id),
          patch,
        )
      return Response.json(JSON.parse(init.body))
    }
    if (behavior === 'lookup-failure') throw new Error('PRIVATE_PROVIDER_ERROR fictive-only')
    if (method === 'POST') {
      if (behavior === 'lost-before-save') throw new Error('PRIVATE_PROVIDER_ERROR')
      const added = records.map((row: any) => ({ ...row, Id: rows.length + 1 }))
      rows.push(...added)
      if (behavior === 'lost-after-save') throw new Error('PRIVATE_PROVIDER_ERROR')
      return Response.json(Array.isArray(payload) ? added : added[0])
    }
    if (method !== 'GET') throw new Error('Unexpected mutation')
    const id = /records\/(\d+)$/.exec(url.pathname)?.[1]
    if (id)
      return Response.json(
        behavior === 'bad-readback'
          ? { ...rows[0], reponses: 'mismatch' }
          : rows.find((row) => row.Id === Number(id)),
      )
    const where = url.searchParams.get('where')
    const matches = where
      ? rows.filter((row) => where === `(cle_reponse,eq,${row.cle_reponse})`)
      : rows
    return Response.json({
      list: behavior === 'duplicate-source' ? [...matches, ...matches] : matches,
      pageInfo: { isLastPage: true },
    })
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  sql.close()
  setSystemTime()
})

test('all 17 exact questions are journaled, reread and visible with verified adult receipt', async () => {
  const response = await post()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ state: 'complete', code: 'received', duplicate: false })
  expect(rows).toHaveLength(1)
  expect(rows[0].statut_reprise).toBe('Réception adulte vérifiée')
  expect(people[0].date_pre_recu).toBe('2026-10-02')
  expect(people[0].statut).toBe('Inchangé')
  const source = JSON.parse(rows[0].reponses)
  expect(source.answers).toHaveLength(17)
  expect(source.answers.map((a: any) => a.label)).toEqual(preformationQuestions.map((q) => q.label))
  const read = await listPublicForms(locals())
  expect(read[0].details).toHaveLength(18)
  expect(read[0].participationId).toBe(7)
  expect(read[0].state).toContain('vérifiée sur l’adulte')
  expect(sql.query('SELECT state,target_id FROM public_form_receipts').get()).toEqual({
    state: 'complete',
    target_id: 7,
  })
  expect(adultWrites).toHaveLength(1)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.get('x-robots-tag')).toContain('noindex')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
})
test('identical retries and concurrent requests create one response', async () => {
  const responses = await Promise.all([post(), post(), post()])
  expect(responses.every((r) => r.status === 200 || r.status === 202)).toBe(true)
  expect(rows).toHaveLength(1)
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  expect((await (await post()).json()).duplicate).toBe(true)
})
test('changed answers are distinct preserved responses, not overwrites', async () => {
  await post()
  const changed = body()
  changed.answers.expectations = 'Une autre réponse fictive'
  await post(changed)
  expect(rows).toHaveLength(2)
  expect(rows[0].reponses).not.toBe(rows[1].reponses)
  expect(adultWrites).toHaveLength(1)
})
test('lost POST response is reconciled by read without a second write', async () => {
  behavior = 'lost-after-save'
  const failed = await post()
  expect(failed.status).toBe(503)
  expect(await failed.text()).not.toMatch(/PRIVATE|fictive-only|Adulte/)
  behavior = ''
  expect((await post()).status).toBe(200)
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})
test('uncertain POST with no source stays pending and cannot duplicate on retry', async () => {
  behavior = 'lost-before-save'
  expect((await post()).status).toBe(503)
  behavior = ''
  const retry = await post()
  expect(retry.status).toBe(202)
  expect((await retry.json()).state).toBe('processing')
  expect(rows).toHaveLength(0)
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})
test('lookup failure can retry before any write was attempted', async () => {
  behavior = 'lookup-failure'
  expect((await post()).status).toBe(503)
  behavior = ''
  expect((await post()).status).toBe(200)
  expect(rows).toHaveLength(1)
})
test('bad readback and ambiguous source never return success', async () => {
  behavior = 'bad-readback'
  expect((await post()).status).toBe(503)
  behavior = 'duplicate-source'
  expect((await post()).status).toBe(503)
  expect(rows).toHaveLength(1)
})
for (const scenario of [
  'choice',
  'missing',
  'unknown',
  'too-long',
  'email',
  'year',
  'target',
  'version',
  'bot',
  'null',
  'newline',
])
  test(`rejects ${scenario} before storage`, async () => {
    const data: any = body()
    if (scenario === 'choice') data.answers.role = 'Un choix inventé'
    if (scenario === 'missing') delete data.answers.action
    if (scenario === 'unknown') data.answers.extra = 'secret'
    if (scenario === 'too-long') data.answers.problems = 'a'.repeat(5001)
    if (scenario === 'email') data.answers.email = 'invalide'
    if (scenario === 'year') data.answers.year = '2026-2028'
    if (scenario === 'target') data.participationId = 17
    if (scenario === 'version') data.version = 'future'
    if (scenario === 'bot') data.website = 'https://example.invalid'
    if (scenario === 'null') data.answers = null
    if (scenario === 'newline') data.answers.name = 'Un\nautre'
    expect((await post(data)).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
test('normalization preserves free text and all declared school years without guessing', () => {
  const data = answers()
  data.email = ' ADULT@EXAMPLE.INVALID '
  data.year = '2006–2007'
  data.problems = 'Une ligne\r\nUne autre ligne'
  const parsed = parsePreformation(data)
  expect(parsed.email).toBe('adult@example.invalid')
  expect(parsed.year).toBe('2006-2007')
  expect(parsed.problems).toBe('Une ligne\nUne autre ligne')
})
test('preview validates but never writes even when credentials are supplied', async () => {
  const response = await post(body(), 'http://localhost')
  expect((await response.json()).preview).toBe(true)
  expect(calls).toHaveLength(0)
})
test('origin, content type and streamed size are enforced', async () => {
  expect((await post(body(), undefined, { Origin: 'https://other.invalid' })).status).toBe(403)
  expect((await post(body(), undefined, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
  expect((await post(body(), undefined, { 'Content-Type': 'text/plain' })).status).toBe(415)
  expect((await post({ large: 'x'.repeat(65536) })).status).toBe(413)
  expect(calls).toHaveLength(0)
})
test('configuration is required; no public directory or answer reads are exposed', async () => {
  env.PUBLIC_FORMS_TABLE = ''
  expect((await post()).status).toBe(503)
  env.INTERNAL_ACCESS_DOMAIN = 'preformation-test.cloudflareaccess.com'
  env.INTERNAL_ACCESS_AUD = 'team'
  const response = await teamGet({
    request: new Request('https://euneos.fr/api/interne/formulaires'),
    locals: locals(),
  } as any)
  expect(response.status).toBe(403)
  expect(calls).toHaveLength(0)
})
test('shared public-form limiter rejects request 21 without another NocoDB call', async () => {
  for (let n = 0; n < 20; n++) expect((await post()).status).toBe(200)
  const count = calls.length
  expect((await post()).status).toBe(429)
  expect(calls).toHaveLength(count)
})

test('no projection secret or missing migration refuses capture before any source write', async () => {
  delete env.PRE_FORMATION_PERSON_PROJECTION
  expect((await post()).status).toBe(503)
  expect(rows).toHaveLength(0)
  env.PRE_FORMATION_PERSON_PROJECTION = JSON.stringify(preformationPersonConfig)
  sql.exec('DROP TABLE public_preformation_person_claims')
  expect((await post()).status).toBe(503)
  expect(rows).toHaveLength(0)
})
test('reuses one audited preformation config in contiguous shared source secrets', async () => {
  delete env.PRE_FORMATION_PERSON_PROJECTION
  env.SOURCES = JSON.stringify([{ label: 'Autre source fictive' }])
  env.SOURCES_2 = JSON.stringify([{ personProjection: preformationPersonConfig }])
  const config = await preformationProjectionConfig(locals())
  expect(config.tables).toEqual(preformationPersonConfig.tables)
  expect(config.cohorts).toEqual(preformationPersonConfig.cohorts)
  expect(config.mapping.timestamp).toBe('receivedAt')
  expect((await post()).status).toBe(200)
  expect(people[0].date_pre_recu).toBe('2026-10-02')
})
for (const scenario of ['gap', 'duplicate', 'wrong-family', 'invalid-json', 'invalid-relations'])
  test(`projection config ${scenario} fails closed`, async () => {
    delete env.PRE_FORMATION_PERSON_PROJECTION
    env.SOURCES = JSON.stringify([{ personProjection: preformationPersonConfig }])
    if (scenario === 'gap') env.SOURCES_3 = '[]'
    if (scenario === 'duplicate') env.SOURCES_2 = env.SOURCES
    if (scenario === 'wrong-family')
      env.PRE_FORMATION_PERSON_PROJECTION = JSON.stringify({
        ...preformationPersonConfig,
        family: 'postformation_b',
        createMissingAdults: undefined,
      })
    if (scenario === 'invalid-json') env.PRE_FORMATION_PERSON_PROJECTION = '{'
    if (scenario === 'invalid-relations')
      env.PRE_FORMATION_PERSON_PROJECTION = JSON.stringify({
        ...preformationPersonConfig,
        cohorts: [{ id: 2, answer: '2026-2027' }],
      })
    expect((await post()).status).toBe(503)
    expect(calls).toHaveLength(0)
  })
for (const [scenario, code] of [
  ['unknown-school', 'establishment_unresolved'],
  ['unknown-year', 'cohort_unresolved'],
  ['wrong-name', 'identity_conflict'],
  ['duplicate-email', 'identity_not_unique'],
  ['merged-dossier', 'cohort_conflict'],
  ['wrong-dossier', 'cohort_conflict'],
  ['date-conflict', 'existing_value_conflict'],
  ['incomplete-inventory', 'identity_not_unique'],
  ['creation-disabled', 'identity_unresolved'],
  ['name-collision', 'identity_conflict'],
])
  test(`${scenario}: durable explicit pending, preserved source and no person mutation`, async () => {
    const data = body()
    if (scenario === 'unknown-school') data.answers.school = 'Homonyme non confirmé'
    if (scenario === 'unknown-year') data.answers.year = '2006-2007'
    if (scenario === 'wrong-name') data.answers.name = 'Autre nom'
    if (scenario === 'duplicate-email') people.push({ ...people[0], Id: 51 })
    if (scenario === 'merged-dossier') dossier.fusionne_vers = 8
    if (scenario === 'wrong-dossier') people[0].participations_id = 8
    if (scenario === 'date-conflict') people[0].date_pre_recu = '2026-09-30'
    if (scenario === 'incomplete-inventory') behavior = 'truncated-adults'
    if (scenario === 'creation-disabled') {
      people = []
      env.PRE_FORMATION_PERSON_PROJECTION = JSON.stringify({
        ...preformationPersonConfig,
        createMissingAdults: false,
      })
    }
    if (scenario === 'name-collision') people[0].email = 'different@example.invalid'
    const before = JSON.stringify(people)
    const response = await post(data)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'complete', code: 'received', duplicate: false })
    expect(projection().state).toBe('review')
    expect(projection().code).toBe(code)
    expect(rows[0].statut_reprise).toBe('À vérifier')
    expect(JSON.parse(rows[0].reponses).answers).toHaveLength(17)
    expect(JSON.stringify(people)).toBe(before)
    expect(adultWrites).toHaveLength(0)
    const result = (await listPublicForms(locals()))[0]
    expect(result.state).toContain('en attente')
    expect(result.participationId).toBeNull()
    expect(result.details.at(-1)?.[1]).not.toBe('')
  })
test('explicit policy creates one missing adult, keeps full declared name and records receipt, never trained status', async () => {
  people = []
  const data = body()
  data.answers.name = 'Nom Complet Sans Découpage'
  expect((await post(data)).status).toBe(200)
  expect(people).toHaveLength(1)
  expect(people[0]).toMatchObject({
    nom: 'Nom Complet Sans Découpage',
    prenom: '',
    email: 'adult@example.invalid',
    participations_id: 7,
    date_pre_recu: '2026-10-02',
  })
  expect(people[0].statut).toBeUndefined()
  expect(projection().adult_id).toBe(people[0].Id)
  expect(projection().participation_id).toBe(7)
  expect(projection().state).toBe('complete')
  expect((await post(data)).status).toBe(200)
  expect(adultWrites).toHaveLength(1)
})
test('different concurrent answers for the same missing adult never cause two creations', async () => {
  people = []
  const other = body()
  other.answers.expectations = 'Une autre réponse'
  await Promise.all([post(), post(other)])
  expect(rows).toHaveLength(2)
  expect(people).toHaveLength(1)
  expect(adultWrites).toHaveLength(1)
  const states = sql.query('SELECT state FROM public_preformation_projections').all() as any[]
  expect(states.every((row) => ['complete', 'review'].includes(row.state))).toBe(true)
})
for (const create of [false, true])
  test(`lost business write response (${create ? 'creation' : 'update'}) is read back without replay`, async () => {
    if (create) people = []
    behavior = 'adult-lost-after-save'
    expect((await post()).status).toBe(200)
    expect(projection().state).toBe('complete')
    expect(people[0].date_pre_recu).toBe('2026-10-02')
    behavior = ''
    await post()
    expect(adultWrites).toHaveLength(1)
  })
test('write and readback interrupted: next request resumes persisted plan and only reads', async () => {
  people = []
  behavior = 'adult-readback-lost'
  expect((await post()).status).toBe(202)
  expect(projection().state).toBe('writing')
  expect(projection().plan).not.toBeNull()
  expect(adultWrites).toHaveLength(1)
  blockReadback = false
  behavior = ''
  setSystemTime(new Date('2026-10-04T10:00:00Z'))
  expect((await post()).status).toBe(200)
  expect(projection().state).toBe('complete')
  expect(projection().date_pre).toBe('2026-10-02')
  expect(JSON.parse(rows[0].reponses).receivedAt).toBe('2026-10-01T22:30:00.000Z')
  expect(adultWrites).toHaveLength(1)
})
test('uncertain absent business write remains reviewable, never retried as a creation', async () => {
  people = []
  behavior = 'adult-lost-before-save'
  expect((await post()).status).toBe(200)
  expect(projection().state).toBe('review')
  expect(projection().code).toBe('business_write_uncertain')
  behavior = ''
  await post()
  expect(people).toHaveLength(0)
  expect(adultWrites).toHaveLength(1)
})
test('read failure retries from durable source with original date, without a second journal response', async () => {
  behavior = 'adult-read-failure'
  expect((await post()).status).toBe(202)
  expect(projection().state).toBe('retryable')
  const source = rows[0].reponses
  behavior = ''
  setSystemTime(new Date('2026-10-04T10:00:00Z'))
  expect((await post()).status).toBe(200)
  expect(people[0].date_pre_recu).toBe('2026-10-02')
  expect(rows).toHaveLength(1)
  expect(rows[0].reponses).toBe(source)
})
test('changed private configuration after capture is explicit pending, no new target inferred', async () => {
  behavior = 'adult-read-failure'
  await post()
  behavior = ''
  env.PRE_FORMATION_PERSON_PROJECTION = JSON.stringify({
    ...preformationPersonConfig,
    createMissingAdults: false,
  })
  expect((await post()).status).toBe(200)
  expect(projection().code).toBe('projection_configuration_changed')
  expect(adultWrites).toHaveLength(0)
})
test('an expired planning owner resumes, but a persisted writing marker can never authorize a new write', async () => {
  behavior = 'adult-read-failure'
  await post()
  behavior = ''
  sql.exec("UPDATE public_preformation_projections SET state='planning',owner='old',lease_until=1")
  expect((await post()).status).toBe(200)
  const frozen = projection().plan
  people[0].date_pre_recu = null
  sql.exec("UPDATE public_preformation_projections SET state='writing',lease_until=1")
  expect((await post()).status).toBe(200)
  expect(projection().code).toBe('business_write_uncertain')
  expect(projection().plan).toBe(frozen)
  expect(adultWrites).toHaveLength(1)
})

test('missing shared Google creation registry refuses the site before capturing answers', async () => {
  sql.exec('DROP TABLE google_transition_person_claims')
  expect((await post()).status).toBe(503)
  expect(calls).toHaveLength(0)
  expect(rows).toHaveLength(0)
})

// Exercise BOTH production runners against the same real SQL registry. Hold the
// winning NocoDB POST before persistence so every competing lookup still sees no
// adult: only the shared claim can prevent a duplicate across the two channels.
for (const winner of ['google', 'site'] as const)
  test(`${winner} creation claim prevents the other channel from POSTing while the adult is still absent`, async () => {
    people = []
    const headers = Object.values(preformationPersonConfig.mapping) as string[]
    const source = {
      label: 'Préformation fictive',
      spreadsheetId: 'fictional_sheet_id_00001',
      sheetId: 0,
      firstRow: 2,
      projectionFirstRow: 2,
      personProjection: {
        ...preformationPersonConfig,
        headerDigest: await digest(JSON.stringify(headers)),
      },
    }
    const googleEnv: GoogleEnv = {
      STATE: db,
      NOCODB_TOKEN: 'fictive-only',
      JOURNAL_TABLE: 'publicanswerstable',
      ENABLED: 'true',
      PROJECTION_ENABLED: 'true',
      INPUT_MODE: 'push',
      RUN_SECRET: 'fictional-run-secret-over-32-characters',
      PROJECTION_START_AT: '2026-09-29T06:00:00Z',
      SOURCES: JSON.stringify([source]),
    }
    const snapshot: PushSnapshot = {
      version: 1,
      source: { spreadsheetId: source.spreadsheetId, sheetId: 0 },
      headers,
      rows: [
        [
          '02/10/2026 00:30:00',
          'ADULT@EXAMPLE.INVALID',
          'Adulte Fictif',
          '2026-2027',
          'École fictive',
        ],
      ],
    }
    const poll = async () => {
      let clock = Date.now()
      for (let i = 0; i < 4; i++) {
        await runGoogle(
          googleEnv,
          {
            now: () => clock,
            sleep: async (ms) => {
              clock += ms
            },
            fetch: globalThis.fetch,
          },
          snapshot,
        )
        clock += 120000
      }
    }
    let reached!: () => void, release!: () => void
    const atPost = new Promise<void>((resolve) => {
      reached = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    beforeAdultWrite = async () => {
      reached()
      await gate
    }
    const winningRequest = Promise.resolve(winner === 'google' ? poll() : post())
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        atPost,
        winningRequest.then(() => {
          throw new Error('Winner did not attempt creation')
        }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Creation barrier timed out')), 3000)
        }),
      ])
      const identityKey = await digest('7:adult@example.invalid')
      const claim = sql.query('SELECT * FROM google_transition_person_claims').get() as any
      expect(claim.identity_key).toBe(identityKey)
      expect(claim.identity_key).toHaveLength(64)
      expect(claim.created_at).toBeTruthy()
      const siteReceipt = () => projection()?.receipt
      const googleReceipt = () => sql.query('SELECT * FROM google_transition_poller').get() as any
      expect(claim.response_key).toBe(
        winner === 'google' ? googleReceipt().response_key : `site-preformation:${siteReceipt()}`,
      )
      expect(people).toHaveLength(0)
      if (winner === 'google') {
        expect((await post()).status).toBe(200)
        expect(projection()).toMatchObject({
          state: 'review',
          code: 'person_creation_already_claimed',
        })
      } else {
        await poll()
        expect(JSON.parse(googleReceipt().projection_outcome)).toMatchObject({
          state: 'review',
          code: 'person_creation_already_claimed',
        })
      }
      expect(people).toHaveLength(0)
      expect(adultWrites).toHaveLength(1)
      expect(sql.query('SELECT * FROM google_transition_person_claims').all()).toEqual([claim])
      release()
      await winningRequest
      beforeAdultWrite = null
      expect(people).toHaveLength(1)
      expect(people[0].date_pre_recu).toBe('2026-10-02')
      expect(rows).toHaveLength(2)
      // Retry both channels: no claim replacement/release or second POST.
      await post()
      await poll()
      expect(adultWrites).toHaveLength(1)
      expect(sql.query('SELECT * FROM google_transition_person_claims').all()).toEqual([claim])
    } finally {
      clearTimeout(timeout)
      release()
      await winningRequest
      beforeAdultWrite = null
    }
  })
