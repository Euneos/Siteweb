import { beforeEach, afterEach, test, expect, setSystemTime } from 'bun:test'
import {
  finalFixtureRuntime,
  finalFixtureAnswers,
  finalFixtureConfig,
} from './fixtures/final-questionnaire-runtime'
import { finalQuestionnairePreview as submit } from '../src/lib/final-questionnaire-preview'
import { finalQuestionnaireDefinitions as defs } from '../src/lib/final-questionnaire-definition'
import { validateFinalConfig } from '../src/lib/final-questionnaire-plan'
import { listPublicForms } from '../src/lib/public-forms'
let rt: ReturnType<typeof finalFixtureRuntime>
const realFetch = globalThis.fetch
beforeEach(() => {
  setSystemTime(new Date('2026-10-01T22:30:00Z'))
  rt = finalFixtureRuntime()
  globalThis.fetch = rt.fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  rt.close()
  setSystemTime()
})
const post = (i: number, answers = finalFixtureAnswers(i)) =>
  submit(
    new Request(`https://euneos.fr/api/questionnaires/${defs[i].slug}`, {
      method: 'POST',
      headers: { Origin: 'https://euneos.fr', 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: defs[i].version, website: '', answers }),
    }),
    defs[i].slug,
    rt.locals(),
  )
for (const i of [0, 1]) {
  const family = defs[i].slug
  test(`${family}: source exact -> single targeted receipt write -> readback -> private catalogue`, async () => {
    expect((await post(i)).status).toBe(200)
    expect(rt.projection()).toMatchObject({ state: 'complete', participation_id: 7 })
    const field = finalFixtureConfig(i).receipt.field
    expect((i === 0 ? rt.state.people[0] : rt.state.dossiers[0])[field]).toBe('2026-10-02')
    expect(rt.state.writes).toHaveLength(1)
    expect(Object.keys(rt.state.writes[0].body[0]).sort()).toEqual(
      ['Id', field, ...(i === 1 ? ['score_nps'] : [])].sort(),
    )
    expect(JSON.parse(rt.state.rows[0].reponses).answers).toHaveLength(i === 0 ? 21 : 16)
    expect(rt.state.people[0].statut).toBe('Inchangé')
    expect(rt.state.people[0].date_post_recu).toBeNull()
    expect(rt.state.dossiers[0].statut_formation).toBe('Inchangé')
    const entry = (await listPublicForms(rt.locals()))[0]
    expect(entry.participationId).toBe(7)
    expect(entry.state).toContain('vérifiée')
  })
  test(`${family}: distinct concurrent responses never duplicate a business receipt`, async () => {
    const other = finalFixtureAnswers(i)
    other[i === 0 ? 'q20' : 'q15'] = 'Autre réponse fictive'
    await Promise.all([post(i), post(i, other), post(i)])
    expect(rt.state.rows).toHaveLength(2)
    expect(rt.state.writes).toHaveLength(1)
  })
  for (const error of ['missing-config', 'missing-registry', 'missing-field', 'wrong-type'])
    test(`${family}: ${error} refuses capture`, async () => {
      if (error === 'missing-config')
        delete rt.env[
          i === 0 ? 'EVALUATION_FORMATION_PROJECTION' : 'BILAN_ETABLISSEMENT_PROJECTION'
        ]
      if (error === 'missing-registry') rt.sql.exec('DROP TABLE public_final_questionnaire_claims')
      if (error === 'missing-field') rt.state.schemaMissing = true
      if (error === 'wrong-type') rt.state.schemaWrongType = true
      expect((await post(i)).status).toBe(503)
      expect(rt.state.rows).toHaveLength(0)
      expect(rt.state.writes).toHaveLength(0)
    })
  for (const reason of [
    'unknown-email',
    'duplicate-email',
    'unknown-school',
    'wrong-year',
    'wrong-dossier',
    'merged',
    'duplicate-dossier',
    'truncated',
    'date-conflict',
    'row-field-absent',
  ])
    test(`${family}: ${reason} explicit pending without mutation`, async () => {
      const a = finalFixtureAnswers(i)
      if (reason === 'unknown-email') a.email = 'unlisted@example.invalid'
      if (reason === 'duplicate-email') {
        if (i === 0) rt.state.people.push({ ...rt.state.people[0], Id: 51 })
        else rt.state.schools.push({ ...rt.state.schools[0], Id: 10 })
      }
      if (reason === 'unknown-school') a.school = 'Nom non configuré'
      if (reason === 'wrong-year') a.year = '2006-2007'
      if (reason === 'wrong-dossier') rt.state.dossiers[0].Id = 17
      if (reason === 'merged') rt.state.dossiers[0].fusionne_vers = 17
      if (reason === 'duplicate-dossier')
        rt.state.dossiers.push({ ...rt.state.dossiers[0], Id: 17 })
      if (reason === 'truncated') rt.state.truncated = true
      const target: any = i === 0 ? rt.state.people[0] : rt.state.dossiers[0],
        field = finalFixtureConfig(i).receipt.field
      if (reason === 'date-conflict') target[field] = '2026-09-29'
      if (reason === 'row-field-absent') delete target[field]
      expect((await post(i, a)).status).toBe(200)
      expect(rt.projection().state).toBe('review')
      expect(rt.state.writes).toHaveLength(0)
      expect((await listPublicForms(rt.locals()))[0].participationId).toBeNull()
    })
  for (const fault of [
    'source-lost-after',
    'source-lost-before',
    'write-lost-after',
    'write-lost-before',
    'readback-lost',
  ])
    test(`${family}: ${fault} replay never repeats uncertain writes`, async () => {
      rt.state.behavior = fault
      await post(i)
      const sourcePosts = rt.state.calls.filter((c) => c.method === 'POST').length,
        writes = rt.state.writes.length
      rt.state.behavior = ''
      rt.state.blocked = false
      setSystemTime(new Date('2026-10-05T12:00:00Z'))
      await post(i)
      expect(rt.state.calls.filter((c) => c.method === 'POST')).toHaveLength(sourcePosts)
      expect(rt.state.writes.length).toBeLessThanOrEqual(Math.max(writes, 1))
      if (fault === 'write-lost-after' || fault === 'readback-lost') {
        expect(rt.projection().state).toBe('complete')
        expect(JSON.parse(rt.projection().fields_json)[finalFixtureConfig(i).receipt.field]).toBe(
          '2026-10-02',
        )
      }
    })
  test(`${family}: changed configuration after a read failure never retargets`, async () => {
    rt.state.behavior = 'read-failure'
    expect((await post(i)).status).toBe(202)
    const key = i === 0 ? 'EVALUATION_FORMATION_PROJECTION' : 'BILAN_ETABLISSEMENT_PROJECTION',
      c = JSON.parse(rt.env[key])
    c.cohorts[0].establishments[0].participationId = 17
    rt.env[key] = JSON.stringify(c)
    rt.state.behavior = ''
    await post(i)
    expect(rt.projection().code).toBe('projection_configuration_changed')
    expect(rt.state.writes).toHaveLength(0)
  })
  test(`${family}: prior native answers-only cohort aliases identify the explicit older dossier`, async () => {
    const a = finalFixtureAnswers(i)
    a.year = '2025-2026'
    a.school = 'École fictive passée'
    rt.state.people[0].participations_id = 8
    expect((await post(i, a)).status).toBe(200)
    expect(rt.projection()).toMatchObject({ state: 'complete', participation_id: 8 })
  })
}
test('NPS zero is preserved on conflict; receipt verified as partial and journal remains complete', async () => {
  rt.state.dossiers[0].score_nps = 0
  const a = finalFixtureAnswers(1)
  a.q14 = '10'
  await post(1, a)
  expect(rt.state.dossiers[0].score_nps).toBe(0)
  expect(rt.projection().code).toBe('receipt_verified_partial')
  expect(rt.state.writes[0].body[0]).not.toHaveProperty('score_nps')
  expect((await listPublicForms(rt.locals()))[0].details.at(-1)?.[1]).toContain(
    'score NPS existant',
  )
})
test('NPS projection requires private opt-in', async () => {
  const c = finalFixtureConfig(1)
  c.scoreNps = false
  rt.env.BILAN_ETABLISSEMENT_PROJECTION = JSON.stringify(c)
  await post(1)
  expect(rt.state.dossiers[0].score_nps).toBeNull()
  expect(rt.state.writes[0].body[0]).not.toHaveProperty('score_nps')
})
test('both families preserve independent receipts and mixed catalogue checkbox values', async () => {
  await post(0)
  await post(1)
  expect(rt.state.writes).toHaveLength(2)
  const entries = await listPublicForms(rt.locals())
  expect(entries).toHaveLength(2)
  expect(entries.every((e) => e.participationId === 7)).toBe(true)
  expect(entries[0].details.find((d) => d[0].startsWith('Recommanderiez-vous'))?.[1]).toBe(
    'Non\nPeut-être',
  )
})
test('concurrent journal annotations never receive a stale PATCH', async () => {
  rt.state.beforeWrite = () => {
    rt.state.rows[0].detail_reprise = 'Annotation fictive concurrente'
  }
  await post(0)
  await post(0)
  expect(rt.state.rows[0].detail_reprise).toBe('Annotation fictive concurrente')
  expect(
    rt.state.calls.filter((c) => c.method === 'PATCH' && c.url.includes('fictionaljournal')),
  ).toHaveLength(0)
})
test('configuration accepts native answers[] and refuses overlapping aliases, wrong receipt and status fields', () => {
  expect(() => validateFinalConfig(finalFixtureConfig(0))).not.toThrow()
  for (const change of ['alias', 'field', 'type', 'family', 'tables', 'extra']) {
    const c: any = finalFixtureConfig(0)
    if (change === 'alias') c.cohorts[1].answers.push('2026-2027')
    if (change === 'field') c.receipt.field = 'date_post_recu'
    if (change === 'type') c.receipt.type = 'Checkbox'
    if (change === 'family') c.family = 'postformation_b'
    if (change === 'tables') c.tables.records = c.tables.people
    if (change === 'extra') c.statut = 'Formé'
    expect(() => validateFinalConfig(c)).toThrow()
  }
})

test('a second identity appearing during the write prevents a false verified receipt', async () => {
  rt.state.afterWrite = () => {
    rt.state.people.push({ ...rt.state.people[0], Id: 51 })
  }
  await post(0)
  expect(rt.state.writes).toHaveLength(1)
  expect(rt.projection()).toMatchObject({ state: 'review', code: 'identity_or_value_changed' })
})
test('a stale planning owner cannot write after another owner takes its lease', async () => {
  rt.state.behavior = 'read-failure'
  await post(0)
  rt.state.behavior = ''
  rt.sql.exec(
    "UPDATE public_final_questionnaire_projections SET state='planning', owner='old', lease_until=1",
  )
  await post(0)
  expect(rt.projection().state).toBe('complete')
  expect(rt.state.writes).toHaveLength(1)
  rt.sql.exec("UPDATE public_final_questionnaire_projections SET state='writing', lease_until=1")
  rt.state.people[0].date_evaluation_recu = null
  await post(0)
  expect(rt.state.writes).toHaveLength(1)
  expect(rt.projection().state).toBe('review')
})
