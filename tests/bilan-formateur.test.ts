import { beforeEach, afterEach, test, expect, setSystemTime } from 'bun:test'
import { POST } from '../src/pages/api/questionnaires/bilan-formateur'
import { bilanFixture, bilanBody, bilanTestConfig } from './fixtures/bilan-formateur'
import { bilanQuestions } from '../src/lib/bilan-formateur-definition'
import { listPublicForms } from '../src/lib/public-forms'
let f: ReturnType<typeof bilanFixture>
const realFetch = globalThis.fetch
const post = (body: any = bilanBody(), origin = 'https://euneos.fr', extra: any = {}) =>
  POST({
    request: new Request(origin + '/api/questionnaires/bilan-formateur', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body),
    }),
    locals: { runtime: { env: f.env } },
  } as any)
const patches = () => f.calls.filter((c) => c.method === 'PATCH')
beforeEach(() => {
  setSystemTime(new Date('2026-10-01T12:00:00Z'))
  f = bilanFixture()
  globalThis.fetch = f.fetch as any
})
afterEach(() => {
  globalThis.fetch = realFetch
  f.sql.close()
  setSystemTime()
})
test('28 exact questions, 16 required, checkbox preserved', () => {
  expect(bilanQuestions).toHaveLength(28)
  expect(bilanQuestions.filter((q) => q.required)).toHaveLength(16)
  expect(bilanQuestions[27].type).toBe('checkbox')
})
test('journal then explicit unique mission and empty audited fields only', async () => {
  expect((await post()).status).toBe(200)
  expect(f.proof()).toMatchObject({
    state: 'complete',
    code: 'mission_fields_verified',
    mission_id: 51,
    trainer_id: 12,
    participation_id: 31,
  })
  expect(patches()).toHaveLength(1)
  expect(patches()[0].body).toEqual([
    {
      Id: 51,
      bilan_recu: true,
      date_debut: '2026-09-01',
      date_fin_reelle: '2026-09-30',
      nb_adultes_formes: 12,
      dates_respectees: 'Oui',
      difficulte: 'Non',
    },
  ])
  expect(f.missions[0].statut).toBe('En cours')
  expect(f.missions[0].bilan_recu).toBe(true)
  expect(f.missions[0].convention_signee).toBe(false)
  expect(JSON.parse(f.sources[0].reponses).answers).toHaveLength(28)
})
test('replay and concurrent identical answer are single-source single-PATCH', async () => {
  await Promise.all([post(), post()])
  await post()
  expect(f.sources).toHaveLength(1)
  expect(patches()).toHaveLength(1)
})
test('all existing values including zero, false, newer dates preserved, conflicts explicit', async () => {
  Object.assign(f.missions[0], {
    date_debut: '2026-01-01',
    date_fin_reelle: '2026-12-31',
    nb_adultes_formes: 0,
    dates_respectees: 'Partiellement',
    difficulte: false,
  })
  const before = structuredClone(f.missions[0])
  await post()
  expect(patches()).toHaveLength(1)
  expect(patches()[0].body).toEqual([{ Id: 51, bilan_recu: true }])
  expect(f.missions[0]).toEqual({ ...before, bilan_recu: true })
  expect(f.proof().code).toBe('mission_fields_verified')
  expect(JSON.parse(f.proof().plan).reasons).toHaveLength(5)
})
test('partial conflict does not block other empty fields and never overwrites', async () => {
  f.missions[0].date_fin_reelle = '2026-10-05'
  await post()
  expect(patches()[0].body[0].date_fin_reelle).toBeUndefined()
  expect(f.missions[0].date_fin_reelle).toBe('2026-10-05')
  expect(JSON.parse(f.proof().plan).reasons).toContain('nonempty_conflict:date_fin_reelle')
})
for (const [label, setup] of [
  ['duplicate mission', () => f.missions.push({ ...f.missions[0], Id: 52 })],
  ['missing mission', () => f.missions.splice(0)],
  ['wrong dossier cohort', () => (f.dossier.cohortes_id = 2)],
  ['wrong school relation', () => (f.dossier.etablissements_id = 42)],
  ['archived dossier', () => (f.dossier.fusionne_vers = 9)],
  ['different person', () => (f.people[0].nom = 'Autre')],
  ['truncated directory', () => (f.behavior = 'truncated')],
  ['new concurrent mission', () => (f.behavior = 'concurrent-mission')],
] as const)
  test(label + ' stays pending/review with source retained', async () => {
    setup()
    await post()
    expect(f.proof().state).toBe('review')
    expect(patches()).toHaveLength(0)
    expect(f.sources).toHaveLength(1)
    expect(f.missions.every((m) => m.bilan_recu === false)).toBe(true)
  })
for (const change of [
  (b: any) => (b.answers.year = '2025-2026'),
  (b: any) => (b.answers.school = 'Autre école'),
  (b: any) => (b.answers.email = 'unknown@example.invalid'),
  (b: any) => (b.answers.start = '2025-01-01'),
])
  test('explicit unmatched year/school/person/date is never guessed', async () => {
    const b = bilanBody()
    change(b)
    await post(b)
    expect(f.proof().state).toBe('review')
    expect(patches()).toHaveLength(0)
  })
for (const change of [
  (b: any) => (b.answers.year = '2026'),
  (b: any) => (b.answers.adultCount = '-1'),
  (b: any) => (b.answers.adultCount = '3.5'),
  (b: any) => (b.answers.invoiceAmount = '100 €'),
  (b: any) => (b.answers.start = '2026-02-30'),
  (b: any) => (b.answers.end = '2026-01-01'),
  (b: any) => (b.answers.attendanceUrl = 'javascript:alert(1)'),
  (b: any) => (b.answers.contractReturned = []),
  (b: any) => (b.answers.contractReturned = ['Oui']),
  (b: any) => (b.answers.contractReturned = ['OUI', 'OUI']),
  (b: any) => (b.answers.statut = 'Terminee'),
])
  test('invalid or dangerous field rejected', async () => {
    const b = bilanBody()
    change(b)
    expect((await post(b)).status).toBe(400)
    expect(f.calls).toHaveLength(0)
  })
test('optional questions can stay unanswered; both literal checkbox choices never sign', async () => {
  const b: any = bilanBody()
  for (const q of bilanQuestions) if (!q.required) delete b.answers[q.key]
  b.answers.contractReturned = ['OUI', 'Non, merci de le renvoyer']
  await post(b)
  expect(f.missions[0].convention_signee).toBe(false)
  expect(f.proof().state).toBe('complete')
})
for (const mutation of [
  (c: any) => c.fields.push({ source: 'adultCount', field: 'statut', type: 'Number' }),
  (c: any) => (c.fields[0].type = 'SingleLineText'),
  (c: any) => (c.cohorts[0].id = null),
  (c: any) => c.cohorts.push(c.cohorts[0]),
])
  test('audited config rejects unsafe type/field/year', async () => {
    const c = structuredClone(bilanTestConfig)
    mutation(c)
    f.env.BILAN_FORMATEUR_PROJECTION = JSON.stringify(c)
    expect((await post()).status).toBe(503)
    expect(f.calls).toHaveLength(0)
  })
test('missing config/schema refuse capture; preview no writes; CSRF', async () => {
  delete f.env.BILAN_FORMATEUR_PROJECTION
  expect((await post()).status).toBe(503)
  expect((await (await post(undefined, 'http://localhost')).json()).preview).toBe(true)
  expect((await post(undefined, undefined, { Origin: 'https://evil.invalid' })).status).toBe(403)
  expect(f.calls).toHaveLength(0)
})
for (const behavior of ['lost-before', 'lost-after', 'readback-fails'])
  test(behavior + ' is never blindly repeated', async () => {
    f.behavior = behavior
    await post()
    f.behavior = ''
    f.blockMissionReads = false
    setSystemTime(new Date('2026-10-01T12:02:00Z'))
    await post()
    expect(patches()).toHaveLength(1)
    expect(f.proof().state).toBe(behavior === 'lost-before' ? 'review' : 'complete')
  })
test('catalogue explicitly partial, dossier correct, raw answers preserved', async () => {
  await post()
  const entries = await listPublicForms({ runtime: { env: f.env } })
  expect(entries[0].state).toBe('Bilan — report partiel vérifié')
  expect(entries[0].participationId).toBe(31)
  expect(entries[0].details).toHaveLength(29)
  expect(entries[0].details.find((d) => d[0].startsWith('Avez vous signé'))?.[1]).toBe('OUI')
})
test('new uncertain payload cannot displace mission claim', async () => {
  f.behavior = 'lost-before'
  await post()
  f.behavior = ''
  const b: any = bilanBody()
  b.answers.quote = 'Autre retour'
  await post(b)
  expect(patches()).toHaveLength(1)
  expect(
    f.sql
      .query(
        "SELECT receipt FROM public_bilan_formateur_projections WHERE code='mission_already_claimed'",
      )
      .all(),
  ).toHaveLength(1)
})

test('receipt mapping must be explicit and exactly boolean true, no other status', async () => {
  for (const receipt of [
    undefined,
    { field: 'statut', type: 'Checkbox', value: true },
    { field: 'bilan_recu', type: 'Checkbox', value: false },
    { field: 'bilan_recu', type: 'SingleLineText', value: true },
  ]) {
    f.env.BILAN_FORMATEUR_PROJECTION = JSON.stringify({ ...bilanTestConfig, receipt })
    expect((await post()).status).toBe(503)
  }
  expect(f.calls).toHaveLength(0)
})
test('receipt true already present is read back without rewriting', async () => {
  f.missions[0].bilan_recu = true
  f.env.BILAN_FORMATEUR_PROJECTION = JSON.stringify({ ...bilanTestConfig, fields: [] })
  await post()
  expect(patches()).toHaveLength(0)
  expect(f.proof().state).toBe('complete')
  expect(JSON.parse(f.proof().fields_json)).toEqual({ bilan_recu: true })
})
test('invalid receipt type remains pending without any business patch', async () => {
  f.missions[0].bilan_recu = 'unknown'
  await post()
  expect(f.proof()).toMatchObject({ state: 'review', code: 'receipt_value_invalid' })
  expect(patches()).toHaveLength(0)
})

test('unverified source never sets the business receipt checkbox', async () => {
  const transport = f.fetch
  globalThis.fetch = (async (input: any, init: any) => {
    const result = await transport(input, init)
    if (String(input).includes('/fictionjournalstable/records/'))
      return Response.json({ ...f.sources[0], reponses: 'mismatch' })
    return result
  }) as any
  expect((await post()).status).toBe(503)
  expect(f.missions[0].bilan_recu).toBe(false)
  expect(patches()).toHaveLength(0)
})
test('lost source POST response is recovered before setting receipt once', async () => {
  const transport = f.fetch
  globalThis.fetch = (async (input: any, init: any) => {
    const result = await transport(input, init)
    if (String(input).includes('/fictionjournalstable/records') && init?.method === 'POST')
      throw new Error('PRIVATE_TRANSPORT_LOSS')
    return result
  }) as any
  expect((await post()).status).toBe(503)
  expect(f.missions[0].bilan_recu).toBe(false)
  globalThis.fetch = f.fetch as any
  await post()
  expect(f.missions[0].bilan_recu).toBe(true)
  expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  expect(patches()).toHaveLength(1)
})


test('journal POST failing before creation remains visible privately without a second POST', async () => {
  const transport = f.fetch
  let attempts = 0
  globalThis.fetch = (async (input: any, init: any) => {
    if (init?.method === 'POST' && String(input).includes(`/tables/${f.env.PUBLIC_FORMS_TABLE}/records`)) {
      attempts++
      return Response.json({ message: 'Unavailable' }, { status: 503 })
    }
    return transport(input, init)
  }) as typeof fetch
  expect((await post()).status).toBe(503)
  expect((await post()).status).toBe(202)
  expect(attempts).toBe(1)
  expect(f.sources).toHaveLength(0)
  expect(patches()).toHaveLength(0)
  const entries = await listPublicForms({ runtime: { env: f.env } })
  expect(entries).toHaveLength(1)
  expect(entries[0].state).toContain('Transmission au journal non confirmée')
  expect(entries[0].participationId).toBeNull()
  expect(entries[0].details.some(([label, value]) => label === 'Adresse e-mail' && value === 'trainer@example.invalid')).toBe(true)
})
