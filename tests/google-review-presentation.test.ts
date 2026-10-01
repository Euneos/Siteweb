import { expect, test } from 'bun:test'
import { matchesReviewFilter } from '../src/lib/google-review-presentation'

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
