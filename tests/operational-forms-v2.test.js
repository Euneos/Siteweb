import { expect, test } from 'bun:test'
import {
  parseOperationalInput,
  buildOperationalPatch,
  operationalReviewCodes,
} from '../src/lib/operational-data'
import { readContact, writeContact } from '../src/lib/google-form-contact'
import { contactV2, deploymentV2, youthV2 } from './fixtures/operational-forms-v2'
const snapshot = (extra = {}) => ({
  participation: { Id: 7, notes: 'Note humaine', ...extra },
  school: { Id: 1 },
  cohort: { Id: 2, annee_debut: 2026, annee_fin: 2027, active: true },
})
const patch = (kind, raw, snap = snapshot()) => {
  const data = parseOperationalInput(raw, kind)
  return buildOperationalPatch({
    snapshot: snap,
    kind,
    data,
    receipt: 'a'.repeat(64),
    now: '2026-09-29T10:00:00.000Z',
    adultIds: [],
    reviewCodes: operationalReviewCodes(snap, data, kind),
  })
}
test('contact v2 needs no premature dates, adult names or headcounts, keeps removed stored fields', () => {
  const previous = {
    version: 1,
    source: { kind: 'site', receipt: 'b'.repeat(64), readAt: '2026-09-01T00:00:00Z' },
    receivedAt: null,
    formation: {
      start: '2026-10-01',
      end: '2027-01-01',
      kind: 'previsionnelle',
      format: 'Présentiel',
      planning: 'Ancien planning',
      issues: [],
    },
    declaredTrainers: [{ name: 'Ancien formateur' }],
    participants: {
      declared: 'Ancienne liste',
      unresolved: ['Identité à préciser'],
      importedCount: 8,
    },
  }
  const s = snapshot({
    date_debut_formation: '2026-10-01',
    date_fin_formation: '2027-01-01',
    notes: writeContact('Note humaine', previous),
  })
  const result = patch('contact', contactV2(), s),
    n = readContact(result.notes)
  expect(result).not.toHaveProperty('date_debut_formation')
  expect(result).not.toHaveProperty('date_fin_formation')
  expect(result).not.toHaveProperty('statut_formation')
  expect(n.formation).toEqual(previous.formation)
  expect(n.participants.declared).toBe('Ancienne liste')
  expect(n.participants.importedCount).toBe(8)
  expect(n.declaredTrainers).toEqual(previous.declaredTrainers)
  expect(result.intention_evaluation_scientifique).toBe('Non')
  expect(n.operationalSubmissions[0].data.evaluationInterest.answer).toBe('Non')
})
test.each(['Non', 'Je ne sais pas, j’ai besoin de plus d’information'])(
  'contact %s permits no class level and retains older levels',
  (answer) => {
    const raw = contactV2()
    raw.evaluationInterest.answer = answer
    expect(parseOperationalInput(raw, 'contact').evaluationInterest.level).toBe('')
    expect(
      patch('contact', raw, snapshot({ niveau_evaluation_envisage: 'Ancien niveau' })),
    ).not.toHaveProperty('niveau_evaluation_envisage')
  },
)
test('contact yes requires a level, rejects old removed fields in v2', () => {
  const raw = contactV2()
  raw.evaluationInterest.answer = 'Oui'
  expect(() => parseOperationalInput(raw, 'contact')).toThrow()
  raw.evaluationInterest.level = 'Cinquième'
  expect(patch('contact', raw).niveau_evaluation_envisage).toBe('Cinquième')
  for (const override of [
    { formation: { format: 'Présentiel', start: '2026-10-01', end: '2027-01-01' } },
    { participants: [{ firstName: 'A', lastName: 'Exemple' }] },
    { formation: { format: 'Présentiel', planning: 'old' } },
    { evaluationInterest: { answer: 'Non', level: 'Hidden answer' } },
  ])
    expect(() => parseOperationalInput({ ...raw, ...override }, 'contact')).toThrow()
})
test.each(['Oui', 'Non', 'Je vais le faire'])(
  'deployment explicitly retains preformation %s, never declares trained',
  (preformation) => {
    const result = patch('deploiement', { ...deploymentV2(), preformation })
    expect(result.preformation_questionnaire).toBe(preformation)
    expect(result).not.toHaveProperty('date_debut_formation')
    expect(readContact(result.notes).operationalSubmissions[0].data.preformation).toBe(preformation)
    expect(result).not.toHaveProperty('statut')
  },
)
test('unified deployment permits an empty or partial list, but validates each added adult and the 200 limit', () => {
  const adult = { firstName: 'Alex', lastName: 'Exemple', email: '', role: '' }
  expect(parseOperationalInput(deploymentV2(), 'deploiement').participants).toEqual([])
  expect(parseOperationalInput({ ...deploymentV2(), participants: [adult] }, 'deploiement').participants).toEqual([adult])
  for (const invalid of [{ ...adult, firstName: '' }, { ...adult, lastName: '' }, { ...adult, email: 'incorrect' }])
    expect(() => parseOperationalInput({ ...deploymentV2(), participants: [invalid] }, 'deploiement')).toThrow()
  const participants = Array.from({ length: 200 }, (_, i) => ({ ...adult, firstName: `Adulte ${i}` }))
  expect(parseOperationalInput({ ...deploymentV2(), participants }, 'deploiement').participants).toHaveLength(200)
  expect(() => parseOperationalInput({ ...deploymentV2(), participants: [...participants, { ...adult, firstName: '201' }] }, 'deploiement')).toThrow()
})
test.each([undefined, 'yes', false])(
  'v2 deployment refuses missing or invalid preformation %s',
  (preformation) => {
    expect(() =>
      parseOperationalInput({ ...deploymentV2(), preformation }, 'deploiement'),
    ).toThrow()
  },
)
test('new dates conflicting with Noco remain raw without overriding dates or preformation', () => {
  const raw = deploymentV2()
  raw.formation.start = '2026-10-06'
  raw.formation.end = '2027-01-01'
  const result = patch('deploiement', raw, snapshot({ date_debut_formation: '2026-10-05' }))
  expect(result).not.toHaveProperty('date_debut_formation')
  expect(result).not.toHaveProperty('preformation_questionnaire')
  expect(readContact(result.notes).operationalSubmissions[0].data.formation.start).toBe(
    '2026-10-06',
  )
})
test('youth accepts unequal groups and optional dates/counts, stores complete declaration, generates no codes', () => {
  const raw = youthV2(),
    data = parseOperationalInput(raw, 'activites-jeunes')
  expect(parseOperationalInput(data, 'activites-jeunes')).toEqual(data)
  const result = patch('activites-jeunes', raw),
    n = readContact(result.notes)
  expect(n.operationalSubmissions[0].data.youth).toEqual(raw.youth)
  expect(result.activites_jeunes_effectif).toBe(75)
  expect(result.evaluation_jeunes_statut).toBe('À examiner')
  expect(result).not.toHaveProperty('statut_formation')
  expect(result).not.toHaveProperty('fiche_contact_recue')
  expect(result).not.toHaveProperty('codes')
  const minimal = youthV2()
  for (const key of [
    'activeCount',
    'controlCount',
    'activeT1',
    'activeT2',
    'controlT1',
    'workshopCount',
    'workshopSchedule',
  ])
    delete minimal.youth[key]
  expect(parseOperationalInput(minimal, 'activites-jeunes').youth.activeCount).toBeNull()
})
test('youth non-evaluation skips group questions, empty hidden fields rejected if contradictory', () => {
  const raw = youthV2()
  raw.youth = { totalClasses: 1, totalStudents: 20, levels: 'Sixième', evaluation: false }
  expect(patch('activites-jeunes', raw).evaluation_jeunes_statut).toBe('Non demandée')
  raw.youth.activeClasses = 'Hidden data'
  expect(() => parseOperationalInput(raw, 'activites-jeunes')).toThrow()
})
test.each([
  'negative',
  'missing',
  'invalid-date',
  'unknown',
  'injected-marker',
  'false-confirmation',
])('youth rejects %s at the boundary', (scenario) => {
  const raw = youthV2()
  if (scenario === 'negative') raw.youth.totalStudents = -5
  if (scenario === 'missing') raw.youth.controlClasses = ''
  if (scenario === 'invalid-date') raw.youth.activeT1 = '2026-02-30'
  if (scenario === 'unknown') raw.youth.controlT2 = '2027-01-01'
  if (scenario === 'injected-marker') raw.youth.levels = '[EUNEOS_CONTACT_V1]'
  if (scenario === 'false-confirmation') raw.changesAcknowledged = false
  expect(() => parseOperationalInput(raw, 'activites-jeunes')).toThrow()
})
test('new youth headcounts conflict with existing declaration; human validation never overwritten', () => {
  const s = snapshot({
    activites_jeunes_effectif: 80,
    evaluation_jeunes_statut: 'Validée par équipe',
  })
  const result = patch('activites-jeunes', youthV2(), s)
  expect(result).not.toHaveProperty('activites_jeunes_effectif')
  expect(result).not.toHaveProperty('evaluation_jeunes_statut')
  const n = readContact(result.notes)
  expect(n.operationalSubmissions[0].data.youth.totalStudents).toBe(75)
  expect(n.operationalReview).toContain('youth_declaration_conflict')
  expect(n.formation.issues).toEqual([])
})

test('Noco DateTime and Checkbox transport normalization does not invent a concurrent edit', async()=>{
  const { operationalFingerprint }=await import('../src/lib/operational-data')
  const original=snapshot({activites_jeunes_recues:true,activites_jeunes_date_reception:'2026-09-29T10:00:00.000Z'})
  const returned=snapshot({activites_jeunes_recues:1,activites_jeunes_date_reception:'2026-09-29 10:00:00+00:00'})
  expect(operationalFingerprint(original,[])).toBe(operationalFingerprint(returned,[]))
})
