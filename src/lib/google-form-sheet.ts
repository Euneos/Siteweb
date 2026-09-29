import { normalise } from './google-form-contact'
import {
  parseGoogleFormEvent,
  type GoogleFormEvent,
  type GoogleFormSource,
} from './google-form-sync'

export type SheetField =
  | 'timestamp'
  | 'name'
  | 'city'
  | 'postcode'
  | 'referenceEmail'
  | 'contactName'
  | 'contactEmail'
  | 'phone'
  | 'start'
  | 'end'
  | 'format'
  | 'planning'
  | 'trainer'
  | 'participants'
/** Occurrence is one-based among equal labels, never an absolute column number. */
export type SheetHeader = string | { label: string; occurrence: number }
type Cell = string | number | boolean | null
export interface GoogleSheetSnapshot {
  headers: string[]
  values: Cell[]
  unmappedColumns: number[]
  missingFields: SheetField[]
}

/** Pure adapter, no Google access, installation, trigger, counter reset or mail.
 * The caller supplies a durably reserved revision and timestamp from getValues()
 * (or an independently verified ISO timestamp for a CSV). Form definitions and
 * positional columns are deliberately absent from this mapping. */
export function mapGoogleSheetRow(input: {
  source: GoogleFormSource
  mapping: Partial<Record<SheetField, SheetHeader>>
  headers: string[]
  values: Cell[]
  row: number
  revision: number
  submittedAt: string
  readAt: string
}): GoogleFormEvent & { sheetSnapshot: GoogleSheetSnapshot } {
  const { source, headers, values, mapping } = input
  if (
    headers.length !== values.length ||
    headers.length > 256 ||
    headers.some((h) => typeof h !== 'string') ||
    values.some((v) => v !== null && !['string', 'number', 'boolean'].includes(typeof v))
  )
    throw new Error('sheet_shape_invalid')
  if (!mapping.timestamp || !mapping.name || input.row < source.firstRow)
    throw new Error('sheet_mapping_invalid')
  const used = new Set<number>(),
    missingFields: SheetField[] = []
  function field(key: SheetField) {
    const selector = mapping[key]
    if (!selector) return ''
    const label = typeof selector === 'string' ? selector : selector.label
    if (typeof label !== 'string' || !normalise(label)) throw new Error('sheet_mapping_invalid')
    const matches = headers.flatMap((h, i) => (normalise(h) === normalise(label) ? [i] : []))
    if (!matches.length) {
      missingFields.push(key)
      return ''
    }
    let index: number
    if (typeof selector === 'string') {
      if (matches.length !== 1) throw new Error('sheet_header_ambiguous')
      index = matches[0]
    } else {
      if (
        !Number.isSafeInteger(selector.occurrence) ||
        selector.occurrence < 1 ||
        selector.occurrence > matches.length
      )
        throw new Error('sheet_header_occurrence_invalid')
      index = matches[selector.occurrence - 1]
    }
    used.add(index)
    return String(values[index] ?? '').trim()
  }
  function date(key: 'start' | 'end') {
    const value = field(key),
      fr = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(value)
    return fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : value // invalid dates retained for review
  }
  // Keep the sheet timestamp cell verbatim; never guess a CSV timezone or locale.
  if (!field('timestamp')) throw new Error('sheet_timestamp_missing')
  const email = field('referenceEmail')
  const event = parseGoogleFormEvent({
    version: 1,
    kind: source.kind,
    cohortId: source.cohortId,
    source: {
      spreadsheetId: source.spreadsheetId,
      sheetId: source.sheetId,
      row: input.row,
      revision: input.revision,
      submittedAt: input.submittedAt,
      readAt: input.readAt,
    },
    identity: {
      name: field('name'),
      city: field('city'),
      postcode: field('postcode'),
      referenceEmail: email.toLowerCase(),
    },
    contact: {
      name: field('contactName'),
      email: field('contactEmail') || email,
      phone: field('phone'),
    },
    formation: {
      start: date('start'),
      end: date('end'),
      format: field('format'),
      planning: field('planning'),
    },
    declaredTrainer: field('trainer'),
    participants: field('participants'),
  })
  return {
    ...event,
    sheetSnapshot: {
      headers: [...headers],
      values: [...values],
      // Blank cells still describe an unmapped question; keep them visible in review.
      unmappedColumns: headers.flatMap((_, i) => (used.has(i) ? [] : [i + 1])),
      missingFields,
    },
  }
}
