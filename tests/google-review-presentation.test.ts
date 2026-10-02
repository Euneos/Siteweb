import { expect, test } from 'bun:test'
import { matchesReviewFilter, matchesReviewSearch, reviewIdentity, reviewTitle, reviewGuidance, reviewRequest } from '../src/lib/google-review-presentation'

test('288 retained entries separate pending from pedagogical partials without counting dossiers', () => {
  const rows = [
    ...Array.from({ length: 41 }, () => ({ state: 'pending' as const })),
    ...Array.from({ length: 214 }, () => ({ state: 'partial' as const })),
    ...Array.from({ length: 33 }, () => ({ state: 'integrated' as const })),
  ]
  const counts = ['pending', 'partial', 'integrated', 'all'].map(
    (filter) => rows.filter((row) => matchesReviewFilter(row, filter)).length,
  )
  expect(counts).toEqual([41, 214, 33, 288])
})

test('uncertain operations stay examinable in any integration state, without duplicate rows', () => {
  const rows = [
    { state: 'pending' as const, operation: { state: 'pending' } },
    { state: 'partial' as const, operation: { state: 'pending' } },
    { state: 'integrated' as const, operation: { state: 'pending' } },
    { state: 'unknown' as const, operation: null },
    { state: 'partial' as const, operation: { state: 'complete' } },
  ]
  expect(rows.filter((row) => matchesReviewFilter(row, 'pending'))).toEqual(rows.slice(0, 4))
  expect(rows.filter((row) => matchesReviewFilter(row, 'partial'))).toEqual([rows[1], rows[4]])
  expect(rows.filter((row) => matchesReviewFilter(row, 'integrated'))).toEqual([rows[2]])
  expect(rows.filter((row) => matchesReviewFilter(row, 'typo'))).toEqual([])
})

const searchable = {
  id: 7301,
  form: 'Questionnaire fictif de suivi',
  answers: [{ question: 'Établissement', answer: 'École des Exemples' }],
  rawAnswers: '',
  attachment: { target: { label: 'Dossier fictif' } },
  resolvedTargets: [],
  state: 'partial' as const,
}
test('review search finds the numeric response ID and the displayed title or form label', () => {
  for (const query of [
    '7301',
    '#7301',
    'Réponse #7301',
    '  RÉPONSE #7301  ',
    'questionnaire fictif',
    'Formulaire source : Questionnaire fictif de suivi',
  ])
    expect(matchesReviewSearch(searchable, query)).toBe(true)
  expect(matchesReviewSearch(searchable, '7302')).toBe(false)
  expect(matchesReviewSearch(searchable, 'autre formulaire')).toBe(false)
})
test('review search retains answers and dossier matching without searching unrelated properties or bypassing state filters', () => {
  for (const query of ['', 'école des exemples', 'dossier fictif'])
    expect(matchesReviewSearch(searchable, query)).toBe(true)
  const extra = { ...searchable, technicalMetadata: 'not-visible-marker' }
  expect(matchesReviewSearch(extra, 'not-visible-marker')).toBe(false)
  const rows = [searchable]
  expect(
    rows.filter((row) => matchesReviewFilter(row, 'pending') && matchesReviewSearch(row, '7301')),
  ).toHaveLength(0)
  expect(
    rows.filter((row) => matchesReviewFilter(row, 'all') && matchesReviewSearch(row, '7301')),
  ).toHaveLength(1)
})

test('technical review reasons are readable, while human notes and unknown codes are preserved', async () => {
  const { reviewReasonLabel } = await import('../src/lib/google-review-presentation')
  expect(reviewReasonLabel('existing_value_conflict')).toBe(
    'Une valeur différente existe déjà et a été conservée.',
  )
  expect(reviewReasonLabel('saved_raw_remaining')).toContain('restent à examiner')
  expect(reviewReasonLabel('linked_raw_only')).toContain('champs métier non repris')
  expect(reviewReasonLabel('Confirmer avec la coordination')).toBe('Confirmer avec la coordination')
  expect(reviewReasonLabel('future_unknown_code')).toBe('future_unknown_code')
  expect(reviewReasonLabel('constructor')).toBe('constructor')
})

const review = {
  id: 113, state: 'pending' as const, form: 'Préformation',
  answers: [
    { question: 'Prénom et nom', answer: 'Camille Exemple' },
    { question: 'Établissement', answer: 'CIO Exemple' },
    { question: 'Année Scolaire concernée', answer: '2026-2027' },
    { question: 'Que vous a dit votre responsable ?', answer: 'Une autre personne' },
  ],
  receipt: { reasons: ['establishment_unresolved'] }, resolvedTargets: [],
}
test('review shows declared identity only and keeps source and year in the request', () => {
  expect(reviewIdentity(review)).toEqual({ person: 'Camille Exemple', school: 'CIO Exemple', year: '2026-2027' })
  expect(reviewTitle(review)).toBe('Camille Exemple — CIO Exemple')
  expect(reviewRequest(review)).toContain('#reponse-113')
  expect(reviewRequest(review)).toContain('2026-2027')
  expect(reviewIdentity({ answers: [review.answers[3]] }).person).toBe('')
})
test('review never invites a new attachment to repair uncertain writes or known targets', () => {
  expect(reviewGuidance(review).canAttach).toBe(true)
  expect(reviewGuidance({ ...review, operation: { state: 'pending' } }).canAttach).toBe(false)
  expect(reviewGuidance({ ...review, resolvedTargets: [{ table: 'participations', id: 1, label: 'Known', fields: [] }] }).canAttach).toBe(false)
  expect(reviewGuidance({ ...review, state: 'integrated' }).canAttach).toBe(false)
  expect(reviewGuidance({ ...review, receipt: { reasons: ['existing_value_conflict'] } }).canAttach).toBe(false)
})
test('a partial receipt and an attachment do not become completed migration proof', () => {
  expect(reviewGuidance({ ...review, state: 'partial', receipt: { reasons: ['saved_raw_remaining'] } }).title).toContain('Certaines')
  expect(reviewGuidance({ ...review, attachment: { target: { label: 'Dossier confirmé' } } }).title).toContain('report reste à vérifier')
  expect(reviewGuidance({ ...review, state: 'unknown', receipt: null }).next).not.toContain('rien n’a été')
})
