import { beforeEach, afterEach, expect, test, setSystemTime } from 'bun:test'
import { POST as postB } from '../src/pages/api/questionnaires/post-formation'
import { POST as postJ } from '../src/pages/api/questionnaires/suivi-j45'
import { GET as privateGet } from '../src/pages/api/interne/formulaires'
import { listPublicForms } from '../src/lib/public-forms'
import { parsePostformation } from '../src/lib/postformation'
import { postformationDefinitions } from '../src/lib/postformation-definition'
import { postformationProjectionConfig } from '../src/lib/postformation-projection'
import { postformationFixture, samplePostformation } from './fixtures/postformation'
let f: ReturnType<typeof postformationFixture>
const realFetch = globalThis.fetch
beforeEach(() => {
  setSystemTime(new Date('2026-10-01T22:30:00Z'))
  f = postformationFixture()
  globalThis.fetch = f.transport as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  f.sql.close()
  setSystemTime()
})
for (const def of postformationDefinitions) {
  const body = () => ({ version: def.version, website: '', answers: samplePostformation(def) })
  const post = (data: any = body(), origin = 'https://euneos.fr') =>
    (def.slug === 'post-formation' ? postB : postJ)({
      request: new Request(origin + `/api/questionnaires/${def.slug}`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
      locals: { runtime: { env: f.env } },
    } as any)
  const state = () =>
    f.sql.query('SELECT * FROM public_postformation_projections LIMIT 1').get() as any
  test(`${def.slug}: exact required count and optional radio absent accepted`, () => {
    expect(def.questions).toHaveLength(21)
    expect(def.questions.filter((q) => q.required)).toHaveLength(
      def.slug === 'post-formation' ? 17 : 15,
    )
    const a = samplePostformation(def)
    for (const q of def.questions.filter((q) => !q.required)) delete a[q.key]
    expect(() => parsePostformation(def, a)).not.toThrow()
    for (const q of def.questions.filter((q) => q.required)) {
      const b = { ...a }
      delete b[q.key]
      expect(() => parsePostformation(def, b)).toThrow()
    }
  })
  test(`${def.slug}: persist journal then exact date only, same public result, private receipt`, async () => {
    const r = await post()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ state: 'complete', code: 'received', duplicate: false })
    expect(f.rows).toHaveLength(1)
    expect(f.writes).toEqual([{ Id: 50, [def.dateField]: '2026-10-02' }])
    expect(f.people[0].statut).toBe('Déclaré — préformation')
    expect(state().state).toBe('complete')
    expect(state().received_at).toBe('2026-10-01T22:30:00.000Z')
    const list = await listPublicForms({ runtime: { env: f.env } })
    expect(list[0].state).toBe('Réception vérifiée sur l’adulte')
    expect(list[0].participationId).toBe(7)
    expect(JSON.parse(f.rows[0].reponses).answers.find((a: any) => a.key === 'name').value).toBe(
      'Adulte Fictif',
    )
    expect(f.calls.findIndex((c) => c.method === 'POST')).toBeLessThan(
      f.calls.findIndex((c) => c.method === 'PATCH' && c.url.includes('fictionaladults')),
    )
  })
  test(`${def.slug}: journal notes/status/links never overwritten during replay`, async () => {
    await post()
    f.rows[0].detail_reprise = 'Note équipe à conserver'
    f.rows[0].statut_reprise = 'Qualification humaine'
    f.rows[0].dossier_id = 77
    const before = structuredClone(f.rows[0])
    await post()
    expect(f.rows[0]).toEqual(before)
    expect(
      f.calls.filter((c) => c.method === 'PATCH' && c.url.includes('publicanswerstable')),
    ).toHaveLength(0)
  })
  test(`${def.slug}: same response retry next day creates no duplicate and freezes receipt date`, async () => {
    await post()
    setSystemTime(new Date('2026-10-03T12:00:00Z'))
    expect((await post()).status).toBe(200)
    expect(f.rows).toHaveLength(1)
    expect(f.writes).toHaveLength(1)
    expect(state().received_date).toBe('2026-10-02')
  })
  test(`${def.slug}: concurrent identical submissions never repeat writes`, async () => {
    await Promise.all([post(), post(), post()])
    await post()
    expect(f.rows).toHaveLength(1)
    expect(f.writes).toHaveLength(1)
  })
  for (const scenario of [
    'unknown-email',
    'wrong-name',
    'wrong-year',
    'wrong-school',
    'wrong-relation',
    'wrong-cohort',
    'merged',
    'duplicate',
    'partial-list',
    'existing-date',
    'missing-date',
    'identity-race',
  ]) {
    test(`${def.slug}: ${scenario} preserved privately without adult write`, async () => {
      const b = body()
      if (scenario === 'unknown-email') b.answers.email = 'unknown@example.invalid'
      if (scenario === 'wrong-name') b.answers.name = 'Autre Personne'
      if (scenario === 'wrong-year') b.answers.year = '2027-2028'
      if (scenario === 'wrong-school') b.answers.school = 'Autre école'
      if (scenario === 'wrong-relation') f.people[0].participations_id = 8
      if (scenario === 'wrong-cohort') f.dossier.cohortes_id = 3
      if (scenario === 'merged') f.dossier.fusionne_vers = 8
      if (scenario === 'duplicate') f.people.push({ ...f.people[0], Id: 51 })
      if (scenario === 'existing-date') f.people[0][def.dateField] = '2026-09-01'
      if (scenario === 'missing-date') delete f.people[0][def.dateField]
      if (['partial-list', 'identity-race'].includes(scenario)) f.behavior = scenario
      const r = await post(b)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ state: 'complete', code: 'received', duplicate: false })
      expect(f.rows).toHaveLength(1)
      expect(f.writes).toHaveLength(0)
      expect(state().state).toBe('review')
      const list = await listPublicForms({ runtime: { env: f.env } })
      expect(list[0].state).toContain('rapprocher')
      expect(list[0].participationId).toBeNull()
    })
  }
  test(`${def.slug}: missing config or migration fails closed before writes`, async () => {
    delete f.env[
      def.slug === 'post-formation'
        ? 'POST_FORMATION_PERSON_PROJECTION'
        : 'SUIVI_J45_PERSON_PROJECTION'
    ]
    expect((await post()).status).toBe(503)
    expect(f.calls).toHaveLength(0)
    f.env[
      def.slug === 'post-formation'
        ? 'POST_FORMATION_PERSON_PROJECTION'
        : 'SUIVI_J45_PERSON_PROJECTION'
    ] = JSON.stringify(f.config(def.family))
    f.sql.exec('DROP TABLE public_postformation_projections')
    expect((await post()).status).toBe(503)
    expect(f.calls).toHaveLength(0)
  })
  test(`${def.slug}: wrong family rejected; contiguous unique shared configuration accepted`, async () => {
    const key =
      def.slug === 'post-formation'
        ? 'POST_FORMATION_PERSON_PROJECTION'
        : 'SUIVI_J45_PERSON_PROJECTION'
    f.env[key] = JSON.stringify(
      f.config(def.family === 'postformation_b' ? 'suivi_j45' : 'postformation_b'),
    )
    expect((await post()).status).toBe(503)
    delete f.env[key]
    f.env.SOURCES = JSON.stringify([{ personProjection: f.config(def.family) }])
    expect((await postformationProjectionConfig({ runtime: { env: f.env } }, def)).family).toBe(
      def.family,
    )
    f.env.SOURCES_3 = '[]'
    expect(postformationProjectionConfig({ runtime: { env: f.env } }, def)).rejects.toThrow()
  })
  for (const behavior of ['capture-before-save', 'capture-after-save', 'capture-mismatch'])
    test(`${def.slug}: ${behavior} cannot falsely project or duplicate`, async () => {
      f.behavior = behavior
      expect((await post()).status).toBe(503)
      expect(f.writes).toHaveLength(0)
      f.behavior = ''
      const retry = await post()
      expect(retry.status).toBe(behavior === 'capture-before-save' ? 202 : 200)
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1)
    })
  test(`${def.slug}: lost adult response after saving is verified once`, async () => {
    f.behavior = 'write-after-save'
    expect((await post()).status).toBe(200)
    expect(state().state).toBe('complete')
    await post()
    expect(f.writes).toHaveLength(1)
  })
  test(`${def.slug}: lost before saving is quarantined, not replayed`, async () => {
    f.behavior = 'write-before-save'
    expect((await post()).status).toBe(200)
    expect(state().code).toBe('business_write_uncertain')
    f.behavior = ''
    await post()
    expect(f.writes).toHaveLength(1)
    expect(f.people[0][def.dateField]).toBeNull()
  })
  test(`${def.slug}: unavailable read retries; uncertain write resolves by read only`, async () => {
    f.behavior = 'adult-read-failure'
    expect((await post()).status).toBe(202)
    expect(state().state).toBe('retryable')
    f.behavior = 'write-readback-failure'
    expect((await post()).status).toBe(202)
    expect(state().state).toBe('writing')
    f.behavior = ''
    f.readbackBlocked = false
    expect((await post()).status).toBe(200)
    expect(state().state).toBe('complete')
    expect(f.writes).toHaveLength(1)
  })
  test(`${def.slug}: changed private config after retryable read fails closed`, async () => {
    f.behavior = 'adult-read-failure'
    await post()
    f.behavior = ''
    const key =
      def.slug === 'post-formation'
        ? 'POST_FORMATION_PERSON_PROJECTION'
        : 'SUIVI_J45_PERSON_PROJECTION'
    const cfg = f.config(def.family)
    cfg.cohorts[0].establishments[0].schoolId = 10
    f.env[key] = JSON.stringify(cfg)
    await post()
    expect(state().code).toBe('projection_configuration_changed')
    expect(f.writes).toHaveLength(0)
  })
  test(`${def.slug}: changed answer remains a new journal revision but never overwrites previous date`, async () => {
    await post()
    setSystemTime(new Date('2026-10-04T12:00:00Z'))
    const b = body()
    b.answers.q21 = 'Autre commentaire'
    await post(b)
    expect(f.rows).toHaveLength(2)
    expect(f.writes).toHaveLength(1)
    expect(f.people[0][def.dateField]).toBe('2026-10-02')
  })
  test(`${def.slug}: preview accepts schema without transport; foreign origin / spam rejected`, async () => {
    expect((await post(body(), 'http://localhost')).status).toBe(200)
    expect(f.calls).toHaveLength(0)
    const r = await (def.slug === 'post-formation' ? postB : postJ)({
      request: new Request(`https://euneos.fr/api/questionnaires/${def.slug}`, {
        method: 'POST',
        headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json' },
        body: JSON.stringify(body()),
      }),
      locals: { runtime: { env: f.env } },
    } as any)
    expect(r.status).toBe(403)
    expect((await post({ ...body(), website: 'spam' })).status).toBe(400)
    expect(f.calls).toHaveLength(0)
  })
  test(`${def.slug}: exact single-choice other text, malformed and unknown answers rejected`, () => {
    const q = def.questions.find((q) => q.other)!,
      a = samplePostformation(def)
    a[q.key] = 'Autre :'
    a[`${q.key}Other`] = 'Pratique fictive'
    expect(parsePostformation(def, a)[`${q.key}Other`]).toBe('Pratique fictive')
    a[`${q.key}Other`] = ''
    expect(() => parsePostformation(def, a)).toThrow()
    a[q.key] = ['Autre :']
    expect(() => parsePostformation(def, a)).toThrow()
    expect(() =>
      parsePostformation(def, { ...samplePostformation(def), statut: 'Formé' }),
    ).toThrow()
  })
}
test('J45 checkbox preserves multiple choices canonically and rejects duplicates/unknown values', () => {
  const d = postformationDefinitions[1],
    a = samplePostformation(d),
    q = d.questions.find((q) => q.type === 'checkbox')!
  a[q.key] = [q.choices[2], q.choices[0]]
  expect(parsePostformation(d, a)[q.key]).toEqual([q.choices[0], q.choices[2]])
  a[q.key] = [q.choices[0], q.choices[0]]
  expect(() => parsePostformation(d, a)).toThrow()
  a[q.key] = ['inventé']
  expect(() => parsePostformation(d, a)).toThrow()
})
test('team response list is not publicly readable', async () => {
  const response = await privateGet({
    request: new Request('https://euneos.fr/api/interne/formulaires'),
    locals: { runtime: { env: f.env } },
  } as any)
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(f.calls).toHaveLength(0)
})
