import { expect, test } from 'bun:test'
import { planKnownPreformationAdult } from '../src/lib/preformation-directory'
import { NC } from '../src/lib/nocodb'
import { preformationPersonConfig as config } from './fixtures/preformation-person'
import type { PreformationAnswers } from '../src/lib/preformation'

function fixture() {
  const schools: any[] = [{ Id: 9, nom: 'CLG CHARLOUN RIEU' }]
  const parts: any[] = [{ Id: 7, etablissements_id: 9, cohortes_id: 2, fusionne_vers: null, statut: 'Établissement engagé' }]
  const adults: any[] = [{ Id: 50, prenom: 'Joelle', nom: 'Paulin', email: null, email_2: null, participations_id: 7, date_pre_recu: null }]
  const sources: any[] = []
  let truncated = false
  const read = async (path: string) => {
    const url = new URL('https://fixture.invalid/' + path), table = path.split('/')[1]
    let rows = table === NC.tables.etablissements ? schools : table === config.tables.records ? parts : table === 'sourcesfixture1' ? sources : adults
    const where = url.searchParams.get('where') || ''
    if (table === config.tables.people) rows = rows.filter(p => where.includes('(participations_id,eq,')
      ? where === `(participations_id,eq,${p.participations_id})`
      : [p.email, p.email_2].some(e => e && where.includes(`,eq,${e})`)))
    return { list: rows, pageInfo: { isLastPage: !truncated } }
  }
  const run = (patch: Partial<PreformationAnswers> = {}) => planKnownPreformationAdult(config,
    { school: 'Collège Charloun Rieu', year: '2026-2027', name: 'Joëlle Paulin', email: 'joelle@example.org', ...patch } as PreformationAnswers,
    '2026-10-01T22:30:00Z', 'sourcesfixture1', read)
  return { schools, parts, adults, sources, run, truncate: () => { truncated = true } }
}

test('unique known adult: normalises school and person, fills missing email, dates in Paris', async () => {
  const result = await fixture().run()
  expect(result.state).toBe('planned')
  if (result.state !== 'planned') throw Error('plan absent')
  expect(result.plan.id).toBe(50)
  expect(result.plan.create).toBeUndefined()
  expect(result.plan.after).toEqual({ email: 'joelle@example.org', date_pre_recu: '2026-10-02' })
  expect(result.plan.guard).toHaveLength(3)
})
test('recognises name-first and surname-first without fuzzy person identity', async () => {
  expect((await fixture().run({ name: 'PAULIN JOËLLE' })).state).toBe('planned')
  expect((await fixture().run({ name: 'Julie Paulin' })).state).toBe('review')
})
test('uses only previously reported aliases for the same year and dossier', async () => {
  const f = fixture()
  const alias = { Id: 12, etablissement: 'Collège Charles Rieu', annee_scolaire: '2026-2027', dossier_id: 7, statut_reprise: 'À vérifier' }
  f.sources.push(alias)
  expect(await f.run({ school: alias.etablissement })).toEqual({ state: 'review', code: 'establishment_unresolved' })
  alias.statut_reprise = 'Reportée dans le dossier'
  expect((await f.run({ school: alias.etablissement })).state).toBe('planned')
  alias.annee_scolaire = '2025-2026'
  expect((await f.run({ school: alias.etablissement })).state).toBe('review')
})
test('rejects ambiguous schools even when one is exact; ignores archives and other cohorts', async () => {
  const f = fixture()
  f.schools.push({ Id: 10, nom: 'Collège Charloun Rie' })
  f.parts.push({ ...f.parts[0], Id: 8, etablissements_id: 10 })
  expect(await f.run()).toEqual({ state: 'review', code: 'establishment_not_unique' })
  f.parts[1].fusionne_vers = 7
  expect((await f.run()).state).toBe('planned')
  f.parts[0].cohortes_id = 1
  expect((await f.run()).state).toBe('review')
})
test('never replaces an existing different email; accepts email_2', async () => {
  const f = fixture()
  f.adults[0].email = 'other@example.org'
  expect(await f.run()).toEqual({ state: 'review', code: 'identity_conflict' })
  f.adults[0].email_2 = 'joelle@example.org'
  const result = await f.run()
  if (result.state !== 'planned') throw Error('plan absent')
  expect(result.plan.after).toEqual({ date_pre_recu: '2026-10-02' })
})
test('refuses duplicate adults, email in another dossier, closed dossiers and date conflicts', async () => {
  const f = fixture()
  f.adults.push({ ...f.adults[0], Id: 51 })
  expect(await f.run()).toEqual({ state: 'review', code: 'identity_not_unique' })
  f.adults[1].email = 'joelle@example.org'; f.adults[1].participations_id = 8
  expect(await f.run()).toEqual({ state: 'review', code: 'cohort_conflict' })
  f.adults.pop(); f.adults[0].date_pre_recu = '2026-09-30'
  expect(await f.run()).toEqual({ state: 'review', code: 'existing_value_conflict' })
  f.parts[0].statut = 'Abandon'
  expect((await f.run()).state).toBe('review')
})
test('does not create an adult from a formateur or an unknown respondent', async () => {
  const f = fixture(); f.adults.length = 0
  expect(await f.run()).toEqual({ state: 'review', code: 'identity_unresolved' })
})
test('fails closed on repeated/truncated pages', async () => {
  const f = fixture(); f.truncate()
  await expect(f.run()).rejects.toThrow('identity_directory_incomplete')
})
