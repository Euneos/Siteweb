import { normalise } from './google-form-contact'
import {
  parseGoogleFormEvent,
  digest,
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
  | 'evaluationInterest'
  | 'evaluationLevel'
  | 'preformation'
/** Occurrence is one-based among equal labels, never an absolute column number. */
export type SheetHeader = string | { label: string; occurrence: number; column?: number }
export type GoogleSheetPolicy = {
  headerDigest: string
  /** Audited questions kept as declarations only, never mapped to people. */
  captureOnly?: SheetHeader[]
  /** Retired questions: only an empty cell can be ignored for future projection. */
  emptyOnly?: SheetHeader[]
  /** Exact published answer, not a truthiness test on an arbitrary checkbox. */
  confirmations: { header: SheetHeader; answer: string }[]
}
type Cell = string | number | boolean | null
export interface GoogleSheetSnapshot {
  headers: string[]
  values: Cell[]
  unmappedColumns: number[]
  missingFields: SheetField[]
  deferredColumns?: number[]
}

/** Pure adapter, no Google access, installation, trigger, counter reset or mail.
 * The caller supplies a durably reserved revision and timestamp from getValues()
 * (or an independently verified ISO timestamp for a CSV). Form definitions and
 * positional columns are deliberately absent from this mapping. */
export function mapGoogleSheetRow(input: {
  source: GoogleFormSource
  mapping: Partial<Record<SheetField, SheetHeader>>
  policy?: GoogleSheetPolicy
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
  function column(selector: SheetHeader): number | null {
    const label = typeof selector === 'string' ? selector : selector.label
    if (typeof label !== 'string' || !normalise(label)) throw new Error('sheet_mapping_invalid')
    const matches = headers.flatMap((h, i) => (normalise(h) === normalise(label) ? [i] : []))
    if (!matches.length) {
      return null
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
      if (source.eventVersion === 2 && matches.length > 1 && selector.column === undefined)
        throw new Error('sheet_header_position_required')
      if (selector.column !== undefined && selector.column !== index + 1)
        throw new Error('sheet_header_position_invalid')
    }
    return index
  }
  function field(key: SheetField) {
    const selector = mapping[key]
    if (!selector) return ''
    const index = column(selector)
    if (index === null) {
      missingFields.push(key)
      return ''
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
    version: source.eventVersion ?? 1,
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
    ...(source.eventVersion === 2
      ? {
          declaration:
            source.kind === 'contact'
              ? {
                  evaluationInterest: {
                    answer: field('evaluationInterest'),
                    level: field('evaluationLevel'),
                  },
                }
              : { preformation: field('preformation') },
        }
      : {}),
  })
  const deferredColumns: number[] = []
  if (source.eventVersion === 2) {
    const policy = input.policy
    if (
      !policy ||
      !Array.isArray(policy.confirmations) ||
      policy.confirmations.length !== (source.kind === 'contact' ? 1 : 2)
    )
      throw new Error('sheet_confirmations_required')
    const reserve = (selector: SheetHeader) => {
      const index = column(selector)
      if (index === null) throw new Error('sheet_policy_header_missing')
      if (used.has(index)) throw new Error('sheet_mapping_overlap')
      used.add(index)
      return index
    }
    for (const check of policy.confirmations) {
      if (typeof check.answer !== 'string' || !check.answer.trim())
        throw new Error('sheet_confirmation_invalid')
      const index = reserve(check.header)
      if (String(values[index] ?? '').trim() !== check.answer.trim())
        throw new Error('sheet_confirmation_missing')
      // Selecting a duplicate is explicit, but contradictory answers still fail.
      const label = typeof check.header === 'string' ? check.header : check.header.label
      if (
        headers.some(
          (h, i) =>
            normalise(h) === normalise(label) &&
            String(values[i] ?? '').trim() &&
            String(values[i]).trim() !== check.answer.trim(),
        )
      )
        throw new Error('sheet_confirmation_conflict')
    }
    for (const selector of policy.captureOnly ?? []) {
      const index = reserve(selector)
      if (String(values[index] ?? '').trim()) deferredColumns.push(index + 1)
    }
    for (const selector of policy.emptyOnly ?? []) {
      const index = reserve(selector)
      // Unexpected data remains unmapped, including a removed question filled again.
      if (String(values[index] ?? '').trim()) used.delete(index)
    }
  }
  return {
    ...event,
    sheetSnapshot: {
      headers: [...headers],
      values: [...values],
      // Blank cells still describe an unmapped question; keep them visible in review.
      unmappedColumns: headers.flatMap((_, i) => (used.has(i) ? [] : [i + 1])),
      missingFields,
      ...(source.eventVersion === 2 ? { deferredColumns } : {}),
    },
  }
}

/** Required v2 entry point: hash exact ordered labels before interpreting cells.
 * Keep the synchronous legacy adapter available for old v1 tooling/replays. */
export async function mapGoogleSheetRowVerified(input: Parameters<typeof mapGoogleSheetRow>[0]) {
  if (
    input.source.eventVersion === 2 &&
    (!/^[a-f0-9]{64}$/.test(input.policy?.headerDigest ?? '') ||
      (await digest(JSON.stringify(input.headers))) !== input.policy?.headerDigest)
  )
    throw new Error('sheet_headers_changed')
  return mapGoogleSheetRow(input)
}
