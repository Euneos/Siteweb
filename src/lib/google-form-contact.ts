/** Shared EUNEOS_CONTACT_V1 projection. Free text is data, never instructions. */
export const CONTACT_OPEN = '[EUNEOS_CONTACT_V1]'
export const CONTACT_CLOSE = '[/EUNEOS_CONTACT_V1]'
export interface ContactProjection {
  [key: string]: unknown
  version: 1
  source:
    | { [key: string]: unknown; spreadsheetId: string; rows: number[]; readAt: string }
    | { kind: 'site'; receipt: string; readAt: string }
  receivedAt: string | null
  formation: {
    [key: string]: unknown
    start: string | null
    end: string | null
    kind: 'previsionnelle' | 'deploiement'
    format: string
    planning: string
    issues: string[]
  }
  declaredTrainers: { name: string; email?: string }[]
  participants: {
    [key: string]: unknown
    declared: string
    unresolved: string[]
    importedCount: number
  }
}
export const normalise = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null
}
/** Parent imports use Python microseconds and Europe/Paris UTC offsets. */
export function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    isoDate(value.slice(0, 10)) !== null &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    Number(value.slice(17, 19)) < 60 &&
    Number.isFinite(Date.parse(value))
  )
}
/** New website submissions have their own provenance; historical Google rows
 * remain readable without inventing a spreadsheet identifier for the website. */
export function validContactSource(value: unknown): value is ContactProjection['source'] {
  if (!value || typeof value !== 'object') return false
  const s = value as Record<string, unknown>
  if (!isoTimestamp(s.readAt)) return false
  if (s.kind === 'site')
    return (
      typeof s.receipt === 'string' &&
      /^[a-f0-9]{64}$/.test(s.receipt) &&
      s.spreadsheetId === undefined &&
      s.rows === undefined
    )
  return (
    typeof s.spreadsheetId === 'string' &&
    !!s.spreadsheetId.trim() &&
    Array.isArray(s.rows) &&
    s.rows.length > 0 &&
    s.rows.length <= 500 &&
    s.rows.every((x) => Number.isSafeInteger(x) && x >= 2) &&
    new Set(s.rows).size === s.rows.length
  )
}
export function readContact(notes: string): ContactProjection | null {
  const starts = notes.split(CONTACT_OPEN),
    ends = notes.split(CONTACT_CLOSE)
  if (starts.length === 1 && ends.length === 1) return null
  if (
    starts.length !== 2 ||
    ends.length !== 2 ||
    notes.indexOf(CONTACT_CLOSE) < notes.indexOf(CONTACT_OPEN)
  )
    throw new Error('notes_invalid')
  try {
    const v = JSON.parse(starts[1].split(CONTACT_CLOSE)[0]) as ContactProjection
    const date = (x: unknown) => x === null || isoDate(x) !== null
    const strings = (x: unknown) => Array.isArray(x) && x.every((y) => typeof y === 'string')
    if (
      v.version !== 1 ||
      !validContactSource(v.source) ||
      !(date(v.receivedAt) || isoTimestamp(v.receivedAt)) ||
      !v.formation ||
      !date(v.formation.start) ||
      !date(v.formation.end) ||
      !['previsionnelle', 'deploiement'].includes(v.formation.kind) ||
      typeof v.formation.format !== 'string' ||
      typeof v.formation.planning !== 'string' ||
      !strings(v.formation.issues) ||
      !Array.isArray(v.declaredTrainers) ||
      !v.declaredTrainers.every(
        (x) =>
          typeof x?.name === 'string' && (x.email === undefined || typeof x.email === 'string'),
      ) ||
      typeof v.participants?.declared !== 'string' ||
      !strings(v.participants.unresolved) ||
      !Number.isSafeInteger(v.participants.importedCount) ||
      v.participants.importedCount < 0
    )
      throw new Error()
    return v
  } catch {
    throw new Error('notes_invalid')
  }
}
export function writeContact(notes: string, value: ContactProjection): string {
  readContact(notes) // never silently remove malformed/multiple provenance blocks
  const block = CONTACT_OPEN + '\n' + JSON.stringify(value) + '\n' + CONTACT_CLOSE
  const start = notes.indexOf(CONTACT_OPEN)
  return start < 0
    ? notes + (notes ? '\n\n' : '') + block
    : notes.slice(0, start) +
        block +
        notes.slice(notes.indexOf(CONTACT_CLOSE) + CONTACT_CLOSE.length)
}
