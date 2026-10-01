import { beforeEach, afterEach, test, expect, setSystemTime } from 'bun:test'
import { POST } from '../src/pages/api/questionnaires/accord-formateur'
import { GET } from '../src/pages/api/interne/accords-formateurs'
import { accordFixture, accordBody, accordConfig } from './fixtures/accord-formateur'
import { accordProjectionConfig } from '../src/lib/accord-formateur-projection'
import { accordQuestions, accordTerms, accordVersion } from '../src/lib/accord-formateur-definition'
const realFetch = globalThis.fetch
let f: ReturnType<typeof accordFixture>
const request = (body: any = accordBody(), origin = 'https://euneos.fr', headers: any = {}) =>
  new Request(origin + '/api/questionnaires/accord-formateur', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
const post = (body: any = accordBody(), origin?: string, headers?: any) =>
  POST({ request: request(body, origin, headers), locals: { runtime: { env: f.env } } } as any)
const patches = () => f.calls.filter((c) => c.method === 'PATCH')
const sourcePosts = () => f.calls.filter((c) => c.method === 'POST')
beforeEach(() => {
  setSystemTime(new Date('2026-10-01T12:00:00Z'))
  f = accordFixture()
  globalThis.fetch = f.fetch as any
})
afterEach(() => {
  globalThis.fetch = realFetch
  f.sql.close()
  setSystemTime()
})
test('six exact required questions and all eight full clauses', () => {
  expect(accordQuestions).toHaveLength(6)
  expect(accordQuestions.every((q) => q.required)).toBe(true)
  expect(accordTerms).toHaveLength(8)
  expect(accordTerms.reduce((n, s) => n + s.blocks.length, 0)).toBe(34)
  expect(JSON.stringify(accordTerms)).toContain('1000 euros')
  expect(JSON.stringify(accordTerms)).toContain('50% du forfait global')
})
test('source first, exact NULL journey, only agreement + date; full contract retained', async () => {
  const before = structuredClone(f.journeys[0])
  expect((await post()).status).toBe(200)
  expect(f.proof()).toMatchObject({
    state: 'complete',
    code: 'agreement_verified',
    trainer_id: 12,
    journey_id: 21,
    agreement_date: '2026-10-01',
  })
  expect(f.journeys[0]).toEqual({ ...before, accord_signe: true, date_accord: '2026-10-01' })
  expect(sourcePosts()).toHaveLength(1)
  expect(patches()).toHaveLength(1)
  expect(JSON.parse(f.sources[0].reponses).contract.sections).toEqual(accordTerms)
  expect(JSON.parse(f.proof().payload).schema).toBe(accordVersion)
  expect(f.sources[0].annee_scolaire).toBeUndefined()
  expect(f.sources[0].statut_reprise).toBeUndefined()
  expect(f.calls.findIndex((c) => c.method === 'POST')).toBeLessThan(
    f.calls.findIndex((c) => c.method === 'PATCH'),
  )
})
test('replay and concurrent identical answers do not duplicate source or patch', async () => {
  await Promise.all([post(), post(), post()])
  await post()
  expect(sourcePosts()).toHaveLength(1)
  expect(patches()).toHaveLength(1)
  expect(f.proof().state).toBe('complete')
})
for (const [label, mutate, code] of [
  ['no consent', (b: any) => (b.answers.agreement = 'Non'), 'agreement_not_confirmed'],
  [
    'different signature',
    (b: any) => (b.answers.signature = 'Une autre personne'),
    'signature_identity_conflict',
  ],
  ['future date', (b: any) => (b.answers.agreementDate = '2026-10-02'), 'date_invalid'],
] as const)
  test(label + ' is captured without signing', async () => {
    const b = accordBody()
    mutate(b)
    expect((await post(b)).status).toBe(200)
    expect(f.proof()).toMatchObject({ state: 'review', code })
    expect(patches()).toHaveLength(0)
    expect(f.sources).toHaveLength(1)
  })
for (const [label, setup] of [
  ['missing identity', () => (f.people = [])],
  ['different name', () => (f.people[0].nom = 'Différent')],
  ['duplicate person', () => f.people.push({ ...f.people[0], Id: 13 })],
  ['two journeys', () => f.journeys.push({ ...f.journeys[0], Id: 22 })],
  ['nonnull cohort', () => (f.journeys[0].cohortes_id = 1)],
  ['merged journey', () => (f.journeys[0].fusionne_vers = 22)],
  ['existing earlier date', () => (f.journeys[0].date_accord = '2026-09-30')],
  ['existing later date', () => (f.journeys[0].date_accord = '2026-10-05')],
  ['truncated directory', () => (f.behavior = 'truncated')],
  ['new journey during plan', () => (f.behavior = 'concurrent-journey')],
] as const)
  test(label + ' remains review, preserves business fields', async () => {
    setup()
    const before = structuredClone(f.journeys[0])
    await post()
    expect(f.proof().state).toBe('review')
    expect(patches()).toHaveLength(0)
    expect(f.journeys[0]).toEqual(before)
  })
test('same agreement and date yields verified readback without rewrite', async () => {
  Object.assign(f.journeys[0], { accord_signe: true, date_accord: '2026-10-01' })
  await post()
  expect(patches()).toHaveLength(0)
  expect(f.proof().state).toBe('complete')
})
test('existing equal date is excluded from PATCH', async () => {
  f.journeys[0].date_accord = '2026-10-01'
  await post()
  expect(patches()[0].body).toEqual([{ Id: 21, accord_signe: true }])
})
for (const field of ['email', 'lastName', 'firstName', 'agreement', 'signature', 'agreementDate'])
  test('missing ' + field + ' is rejected before all writes', async () => {
    const b: any = accordBody()
    delete b.answers[field]
    expect((await post(b)).status).toBe(400)
    expect(f.calls).toHaveLength(0)
  })
for (const change of [
  (b: any) => (b.answers.agreement = 'yes'),
  (b: any) => (b.answers.agreementDate = '2026-02-30'),
  (b: any) => (b.answers.statut = 'Validé'),
  (b: any) => (b.answers.email = 'bad'),
  (b: any) => (b.answers.signature = 'a'.repeat(301)),
  (b: any) => (b.answers.lastName = 'x\ny'),
  (b: any) => (b.version = 'old'),
  (b: any) => (b.website = 'bot'),
  (b: any) => (b.contract = 'fake'),
])
  test('strict shape and no hidden/automatic contract fields', async () => {
    const b = accordBody()
    change(b)
    expect((await post(b)).status).toBe(400)
    expect(f.calls).toHaveLength(0)
  })
test('origin/content-type guards', async () => {
  expect((await post(undefined, undefined, { Origin: 'https://evil.invalid' })).status).toBe(403)
  expect((await post(undefined, undefined, { 'Content-Type': 'text/plain' })).status).toBe(415)
  expect(f.calls).toHaveLength(0)
})
test('preview never writes or needs production configuration', async () => {
  f.env = {}
  const result = await post(undefined, 'https://preview.invalid')
  expect(await result.json()).toMatchObject({ preview: true })
  expect(f.calls).toHaveLength(0)
})
test('configuration absent or migration absent: fail closed before capture', async () => {
  delete f.env.ACCORD_FORMATEUR_PERSON_PROJECTION
  expect((await post()).status).toBe(503)
  expect(f.calls).toHaveLength(0)
  f.env.ACCORD_FORMATEUR_PERSON_PROJECTION = JSON.stringify(accordConfig)
  f.sql.exec('DROP TABLE public_accord_claims')
  expect((await post()).status).toBe(503)
  expect(f.calls).toHaveLength(0)
})
test('private config refuses inferred cohort or dangerous projection extensions', async () => {
  for (const config of [
    { ...accordConfig, fixedCohort: 1, cohorts: [{ id: 1 }] },
    { ...accordConfig, agreementAnswer: 'Non' },
    { ...accordConfig, family: 'bilan_formateur' },
  ]) {
    f.env.ACCORD_FORMATEUR_PERSON_PROJECTION = JSON.stringify(config)
    expect((await post()).status).toBe(503)
  }
  expect(f.calls).toHaveLength(0)
})
test('SOURCES fallback must be unique and contiguous', async () => {
  delete f.env.ACCORD_FORMATEUR_PERSON_PROJECTION
  f.env.SOURCES = JSON.stringify([{ personProjection: accordConfig }])
  expect((await accordProjectionConfig({ runtime: { env: f.env } })).fixedCohort).toBeNull()
  f.env.SOURCES_3 = '[]'
  expect((await post()).status).toBe(503)
  delete f.env.SOURCES_3
  f.env.SOURCES_2 = f.env.SOURCES
  expect((await post()).status).toBe(503)
})
for (const behavior of ['source-lost-after', 'source-lost-before', 'source-corrupted'])
  test(behavior + ' never blindly retries source', async () => {
    f.behavior = behavior
    expect((await post()).status).toBe(503)
    expect(patches()).toHaveLength(0)
    f.behavior = ''
    await post()
    expect(sourcePosts()).toHaveLength(1)
    expect(f.proof().state).toBe(behavior === 'source-lost-before' ? 'queued' : 'complete')
  })
test('business response lost after saving: readback verifies once', async () => {
  f.behavior = 'business-lost-after'
  await post()
  await post()
  expect(f.proof().state).toBe('complete')
  expect(patches()).toHaveLength(1)
})
test('business response lost before saving: never replay, source retained', async () => {
  f.behavior = 'business-lost-before'
  await post()
  f.behavior = ''
  await post()
  expect(f.proof()).toMatchObject({ state: 'review', code: 'business_write_uncertain' })
  expect(patches()).toHaveLength(1)
})
test('lost business readback recovers only by reads after expired lease', async () => {
  f.behavior = 'business-readback-fails'
  expect((await post()).status).toBe(202)
  expect(f.proof().state).toBe('writing')
  f.blockReads = false
  f.behavior = ''
  setSystemTime(new Date('2026-10-01T12:02:00Z'))
  await post()
  expect(f.proof().state).toBe('complete')
  expect(patches()).toHaveLength(1)
})
test('read failure can retry; changed config cannot replan old source', async () => {
  f.behavior = 'identity-read-fails'
  await post()
  expect(f.proof().state).toBe('retryable')
  f.behavior = ''
  f.env.ACCORD_FORMATEUR_PERSON_PROJECTION = JSON.stringify({
    ...accordConfig,
    tables: { ...accordConfig.tables, records: 'otherjourneystable' },
  })
  await post()
  expect(f.proof()).toMatchObject({ state: 'review', code: 'projection_configuration_changed' })
  expect(patches()).toHaveLength(0)
})
test('different payload cannot displace an uncertain journey owner', async () => {
  f.behavior = 'business-lost-before'
  await post()
  f.behavior = ''
  const b = accordBody()
  b.answers.signature = 'Fictif Camille'
  await post(b)
  expect(patches()).toHaveLength(1)
  expect(
    f.sql
      .query("SELECT code FROM public_accord_projections WHERE code='journey_already_claimed'")
      .all(),
  ).toHaveLength(1)
})
test('public response never exposes existence or business proof', async () => {
  const success = await (await post()).json()
  f.people = []
  const b = accordBody()
  b.answers.email = 'unknown@example.invalid'
  const unknown = await (await post(b)).json()
  expect(unknown).toEqual(success)
  expect(JSON.stringify(success)).not.toContain('12')
  expect(JSON.stringify(success)).not.toContain('Camille')
})
test('private proof endpoint denies anonymous access before database reads', async () => {
  const result = await GET({
    request: new Request('https://euneos.fr/api/interne/accords-formateurs'),
    locals: { runtime: { env: f.env } },
  } as any)
  expect(result.status).toBeGreaterThanOrEqual(400)
  expect(f.calls).toHaveLength(0)
})
test('rate limit applies to replays too', async () => {
  for (let i = 0; i < 20; i++) await post()
  expect((await post()).status).toBe(429)
  expect(patches()).toHaveLength(1)
})

test('catalogue helper distinguishes trainer journey, exact source and unknown legacy status', async () => {
  const { accordCatalogueEntry } = await import('../src/lib/accord-formateur-catalogue')
  await post()
  const source = JSON.parse(f.sources[0].reponses)
  const entry = await accordCatalogueEntry(f.db as any, f.sources[0], source)
  expect(entry?.state).toBe('Accord vérifié dans le parcours formateur')
  expect(entry?.participationId).toBeNull()
  expect(entry?.year).toBe('')
  expect(entry?.details).toHaveLength(7)
  source.answers[0].value = 'another@example.invalid'
  expect((await accordCatalogueEntry(f.db as any, f.sources[0], source))?.state).toBe(
    'Accord en attente — à vérifier',
  )
  expect(await accordCatalogueEntry(f.db as any, {}, { kind: 'other' })).toBeNull()
  expect(
    (
      await accordCatalogueEntry(
        f.db as any,
        { statut_reprise: 'Reportée dans le dossier' },
        { kind: 'accord_formateur' },
      )
    )?.state,
  ).toBe('Accord en attente — à vérifier')
})
test('expired planning worker cannot write after owner changes', async () => {
  const original = f.fetch
  globalThis.fetch = (async (input: any, init: any) => {
    const result = await original(input, init)
    if (f.journeyLists === 2)
      f.sql.exec("UPDATE public_accord_projections SET owner='new-owner' WHERE state='planning'")
    return result
  }) as any
  expect((await post()).status).toBe(202)
  expect(patches()).toHaveLength(0)
})
