import { expect, test } from 'bun:test'
import { lireAideDeduite, type AideDeduite } from '../src/lib/aide-deduite'
import type { SuiviVerifie } from '../src/lib/suivi-verifie'

const source: SuiviVerifie = { version: 1, checkedAt: '2026-10-22T10:00:00.000Z', dateDeReference: null,
  qualification: 'à vérifier', referent: '', situation: 'Calendrier à préciser.', organisation: '', organisationRecue: false, sources: [] }
const value: AideDeduite = { version: 1, nature: 'deduction', analysedAt: '2026-10-27T10:00:00.000Z', sourceCheckedAt: source.checkedAt,
  sourceSituation: source.situation, blocage: 'Jour non fixé.', aide: 'Convenir du calendrier.', actionProposee: true }
const block = (v: unknown) => `[EUNEOS_AIDE_V1]${JSON.stringify(v)}[/EUNEOS_AIDE_V1]`

test('une proposition reste rattachée au texte et à la date réellement analysés', () => {
  expect(lireAideDeduite(block(value), source)).toEqual(value)
  expect(lireAideDeduite(block(value), { ...source, situation: 'Calendrier fixé.' })).toBeNull()
  expect(lireAideDeduite(block(value), { ...source, checkedAt: '2026-10-26T10:00:00.000Z' })).toBeNull()
  expect(lireAideDeduite(block(value), null)).toBeNull()
})
test('refuse les notes ambiguës, invalides ou présentées comme validation humaine', () => {
  for (const invalid of [block(value) + block(value), '[EUNEOS_AIDE_V1]{[/EUNEOS_AIDE_V1]',
    block({ ...value, nature: 'confirmee' }), block({ ...value, blocage: '' }),
    block({ ...value, analysedAt: '2026-10-21T10:00:00.000Z' })]) expect(lireAideDeduite(invalid, source)).toBeNull()
  expect(lireAideDeduite(block({ ...value, secret: 'private' }), source)).not.toHaveProperty('secret')
})
