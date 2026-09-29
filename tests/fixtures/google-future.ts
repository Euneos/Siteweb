import { digest, type GoogleFormSource } from '../../src/lib/google-form-sync'
import type { SheetField, SheetHeader, GoogleSheetPolicy } from '../../src/lib/google-form-sheet'

/** Synthetic source only; deliberately unrelated to the private catalogue. */
export async function futureSheet(kind: 'contact' | 'deploiement' = 'contact') {
  const headers = [
    'Horodateur',
    'Établissement',
    'Ville',
    'CP',
    'Référent',
    'Email',
    'Format',
    'Formateur',
    'Début',
    'Fin',
    'Participants',
    'Confirmation',
    'Intention',
    'Niveau',
    'Information conservée',
  ]
  const values = [
    '29/09/2026 10:00:00',
    'Collège Exemple',
    'Ville Exemple',
    '01234',
    'Référente fictive',
    'fiction@example.invalid',
    'Présentiel',
    '',
    '',
    '',
    '',
    'Oui, je confirme',
    'Non',
    '',
    '',
  ]
  const mapping: Partial<Record<SheetField, SheetHeader>> = {
    timestamp: 'Horodateur',
    name: 'Établissement',
    city: 'Ville',
    postcode: 'CP',
    contactName: 'Référent',
    contactEmail: 'Email',
    referenceEmail: 'Email',
    format: 'Format',
    trainer: 'Formateur',
  }
  const policy: GoogleSheetPolicy = {
    headerDigest: '',
    confirmations: [{ header: 'Confirmation', answer: 'Oui, je confirme' }],
    emptyOnly: ['Début', 'Fin', 'Participants'],
    captureOnly: ['Information conservée'],
  }
  if (kind === 'contact') {
    mapping.evaluationInterest = 'Intention'
    mapping.evaluationLevel = 'Niveau'
  } else {
    headers[12] = 'Préformation'
    values[12] = 'Je vais le faire'
    headers[13] = 'Planning'
    values[13] = '5 sessions prévues'
    headers.push('Confirmation', 'Modification')
    values[11] = ''
    values.push('Oui, je confirme', 'Oui, compris')
    Object.assign(mapping, {
      preformation: 'Préformation',
      planning: 'Planning',
      start: 'Début',
      end: 'Fin',
      participants: 'Participants',
    })
    policy.emptyOnly = [{ label: 'Confirmation', occurrence: 1, column: 12 }]
    policy.confirmations = [
      { header: { label: 'Confirmation', occurrence: 2, column: 16 }, answer: 'Oui, je confirme' },
      { header: 'Modification', answer: 'Oui, compris' },
    ]
  }
  policy.headerDigest = await digest(JSON.stringify(headers))
  const source: GoogleFormSource = {
    spreadsheetId: 'fictional_sheet_id_00001',
    sheetId: 0,
    kind,
    cohortId: 2,
    firstRow: 2,
    eventVersion: 2,
    projectionStartAt: '2026-09-29T06:00:00Z',
    headerDigest: policy.headerDigest,
  }
  return {
    source,
    headers,
    values,
    mapping,
    policy,
    row: 2,
    revision: 1,
    submittedAt: '2026-09-29T08:00:00.000Z',
    readAt: '2026-09-29T08:30:00.000Z',
  }
}
