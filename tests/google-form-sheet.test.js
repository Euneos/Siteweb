import { expect, test } from 'bun:test'
import { mapGoogleSheetRow } from '../src/lib/google-form-sheet'
const fixture = () => ({
  source: {
    spreadsheetId: 'fictional_sheet_id',
    sheetId: 0,
    kind: 'contact',
    cohortId: 2,
    firstRow: 2,
  },
  row: 2,
  revision: 1,
  submittedAt: '2026-09-25T10:00:00Z',
  readAt: '2026-09-29T10:00:00Z',
  headers: [
    'Horodateur',
    'Établissement',
    'Ville',
    'CP',
    'Début historique',
    'Fin historique',
    'Participants historiques',
  ],
  values: [
    '25/09/2026 12:00:00',
    'Collège Fictif',
    'Ville Fictive',
    '01234',
    '01/10/2026',
    '01/02/2027',
    'Liste historique',
  ],
  mapping: {
    timestamp: 'Horodateur',
    name: 'Établissement',
    city: 'Ville',
    postcode: 'CP',
    start: 'Début historique',
    end: 'Fin historique',
    participants: 'Participants historiques',
  },
})
test('maps by normalized header labels after column reorder; no current Form definition needed', () => {
  const f = fixture(),
    before = mapGoogleSheetRow(f)
  f.headers.reverse()
  f.values.reverse()
  const after = mapGoogleSheetRow(f)
  expect(after.formation).toEqual(before.formation)
  expect(after.participants).toBe('Liste historique')
  expect(after.formation.start).toBe('2026-10-01')
  expect(after.sheetSnapshot.values).toEqual(f.values)
  expect(after.sheetSnapshot.unmappedColumns).toEqual([])
})
test('removed Sheet columns become missing diagnostics; remaining history never drops', () => {
  const f = fixture()
  f.headers.splice(4, 1)
  f.values.splice(4, 1)
  const result = mapGoogleSheetRow(f)
  expect(result.formation.start).toBe('')
  expect(result.formation.end).toBe('2027-02-01')
  expect(result.participants).toBe('Liste historique')
  expect(result.sheetSnapshot.missingFields).toEqual(['start'])
})
test('duplicate questions retained separately; mapping requires explicit occurrence', () => {
  const f = fixture()
  f.headers.push('Participants historiques')
  f.values.push('Liste plus récente')
  expect(() => mapGoogleSheetRow(f)).toThrow('sheet_header_ambiguous')
  f.mapping.participants = { label: 'Participants historiques', occurrence: 2 }
  const result = mapGoogleSheetRow(f)
  expect(result.participants).toBe('Liste plus récente')
  expect(result.sheetSnapshot.unmappedColumns).toEqual([7])
  expect(result.sheetSnapshot.values).toEqual(f.values)
})
test('45-column deployment evidence retains duplicate confirmations and new preformation/participants verbatim', () => {
  const f = fixture()
  f.source.kind = 'deploiement'
  while (f.headers.length < 45) {
    f.headers.push('Champ ' + (f.headers.length + 1))
    f.values.push('')
  }
  f.headers[25] = f.headers[41] = 'Confirmation'
  f.values[25] = 'Ancienne confirmation'
  f.values[41] = 'Confirmation actuelle'
  f.headers[26] = f.headers[42] = 'Modification'
  f.headers[43] = 'Préformation'
  f.values[43] = 'Non'
  f.headers[44] = 'Contacts des personnes formées'
  f.values[44] = 'Personne fictive\nDeuxième ligne'
  const result = mapGoogleSheetRow(f)
  expect(result.sheetSnapshot.headers).toHaveLength(45)
  expect(result.sheetSnapshot.values).toEqual(f.values)
  expect(result.sheetSnapshot.unmappedColumns).toContain(44)
  expect(result.sheetSnapshot.unmappedColumns).toContain(45)
  expect(result.sheetSnapshot.values[25]).not.toBe(result.sheetSnapshot.values[41])
})
test('zero/false cells retained, original whitespace untouched in raw snapshot', () => {
  const f = fixture()
  f.values[6] = '  Liste\nDeux lignes  '
  f.headers.push('Nombre', 'Confirmation')
  f.values.push(0, false)
  const r = mapGoogleSheetRow(f)
  expect(r.sheetSnapshot.values).toEqual(f.values)
  expect(r.participants).toBe('Liste\nDeux lignes')
})
test('missing timestamp, missing identity, mismatched widths and invalid occurrence fail visibly', () => {
  const f = fixture()
  f.values[0] = ''
  expect(() => mapGoogleSheetRow(f)).toThrow('sheet_timestamp_missing')
  const g = fixture()
  g.values[1] = ''
  expect(() => mapGoogleSheetRow(g)).toThrow('payload_invalid')
  const h = fixture()
  h.headers.push('New')
  expect(() => mapGoogleSheetRow(h)).toThrow('sheet_shape_invalid')
  const i = fixture()
  i.mapping.name = { label: 'Établissement', occurrence: 2 }
  expect(() => mapGoogleSheetRow(i)).toThrow('sheet_header_occurrence_invalid')
})
