import {
  mapGoogleSheetRowVerified,
  type SheetHeader,
  type SheetField,
  type GoogleSheetPolicy,
} from '../../src/lib/google-form-sheet'
import { digest } from '../../src/lib/google-form-sync'
import { isoTimestamp } from '../../src/lib/google-form-contact'
import {
  planGooglePerson,
  checkGooglePersonPlan,
  validatePersonConfig,
  googleReconciliationDetail,
  mergeGoogleReconciliationDetail,
  hasPendingGoogleReconciliation,
  type PersonPlan,
  type PersonProjectionConfig,
} from '../../src/lib/google-form-person'
import { reconcileGoogleRows } from '../../src/lib/google-form-identity'
import type { SubmissionDatabase } from '../../src/lib/candidature-store'

export type Source = {
  label: string
  spreadsheetId: string
  sheetId: number
  firstRow: number
  kind?: 'contact' | 'deploiement'
  mapping?: Partial<Record<SheetField, SheetHeader>>
  // Audited first NEW row at future projection cutover, never the historic firstRow.
  projectionFirstRow?: number
  eventVersion?: 2
  cohortId?: 2
  policy?: GoogleSheetPolicy
  personProjection?: PersonProjectionConfig
}
export type Env = {
  STATE: SubmissionDatabase
  NOCODB_TOKEN: string
  JOURNAL_TABLE: string
  SOURCES: string
  SOURCES_2?: string
  SOURCES_3?: string
  SOURCES_4?: string
  SOURCES_5?: string
  SOURCES_6?: string
  SOURCES_7?: string
  SOURCES_8?: string
  SOURCES_9?: string
  SOURCES_10?: string
  SOURCES_11?: string
  SOURCES_12?: string
  ENABLED: string
  PROJECTION_ENABLED: string
  RUN_SECRET: string
  INPUT_MODE?: 'poll' | 'push'
  INGEST_SECRET?: string
  PROJECTION_START_AT?: string
  GOOGLE_FORMS_SYNC_SECRET?: string
}
type Receipt = {
  response_key: string
  source_key: string
  source_row: number
  fingerprint: string
  revision: number
  raw_payload: string
  capture_state: string
  noco_id: number | null
  projection_eligible: number
  projection_payload: string | null
  projection_outcome: string | null
  projection_complete: number
  attempts: number
  next_attempt_at: number
  last_error: string | null
  updated_at: string
}
type Captured = {
  headers: string[]
  cells: string[]
  label: string
  timestamp: string
  readAt: string
  physicalRow?: number
  identityAmbiguous?: boolean
}
export type PushSnapshot = {
  version: 1
  source: { spreadsheetId: string; sheetId: number }
  headers: string[]
  rows: string[][]
}
const MAX_PUSH_BYTES = 1_000_000
type Outcome = { state: string; code: string; receipt?: string }
type Runtime = {
  now: () => number
  sleep: (ms: number) => Promise<void>
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}
const defaults: Runtime = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  fetch: (...args) => fetch(...args),
}
const MAX_HTTP = 48,
  MAX_D1 = 48,
  MAX_ROWS = 10,
  MAX_INSPECTED = 100,
  MAX_SOURCES = 5
const NC = 'https://app.nocodb.com/api/v2/'
const HOOK = 'https://euneos.fr/api/hook/google-forms'
const codeOf = (e: unknown) =>
  e instanceof Error && /^[a-z_0-9]+$/.test(e.message) ? e.message : 'source_failed'
const validId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id > 0

/** RFC4180, including quoted newlines and duplicate/empty headers. Reject broken
 * quoting/width rather than accepting a truncated or shifted snapshot. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, ''),
    rows: string[][] = []
  let row: string[] = [],
    cell = '',
    state: 'plain' | 'quoted' | 'closed' = 'plain'
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (state === 'quoted') {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') state = 'closed'
      else cell += c
    } else if (c === ',') {
      row.push(cell)
      cell = ''
      state = 'plain'
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      state = 'plain'
    } else if (c === '"' && state === 'plain' && !cell) state = 'quoted'
    else if (state === 'closed' || c === '"') throw new Error('csv_quote_invalid')
    else cell += c
  }
  if (state === 'quoted') throw new Error('csv_unclosed_quote')
  if (row.length || cell || state === 'closed') {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
export function validateSources(raw: string): Source[] {
  const values = JSON.parse(raw)
  if (!Array.isArray(values) || !values.length || values.length > 30)
    throw new Error('sources_invalid')
  const keys = new Set<string>()
  for (const s of values) {
    if (
      !s ||
      !/^[\w-]{20,128}$/.test(s.spreadsheetId) ||
      !Number.isSafeInteger(s.sheetId) ||
      s.sheetId < 0 ||
      !Number.isSafeInteger(s.firstRow) ||
      s.firstRow < 2 ||
      typeof s.label !== 'string' ||
      !s.label.trim() ||
      s.label.length > 150 ||
      (s.kind !== undefined && !['contact', 'deploiement'].includes(s.kind)) ||
      (s.eventVersion !== undefined && s.eventVersion !== 2) ||
      (s.cohortId !== undefined && s.cohortId !== 2) ||
      (s.projectionFirstRow !== undefined &&
        (!Number.isSafeInteger(s.projectionFirstRow) || s.projectionFirstRow < s.firstRow))
    )
      throw new Error('source_invalid')
    if (s.personProjection) {
      if (s.kind) throw new Error('source_projection_ambiguous')
      validatePersonConfig(s.personProjection)
    }
    const key = `${s.spreadsheetId}:${s.sheetId}`
    if (keys.has(key)) throw new Error('source_duplicate')
    keys.add(key)
  }
  return values
}
/** Each secret is a complete JSON array below Cloudflare's per-variable limit.
 * Validate the joined catalogue too: duplicated identities across parts fail. */
const SOURCE_PARTS = [
  'SOURCES',
  'SOURCES_2',
  'SOURCES_3',
  'SOURCES_4',
  'SOURCES_5',
  'SOURCES_6',
  'SOURCES_7',
  'SOURCES_8',
  'SOURCES_9',
  'SOURCES_10',
  'SOURCES_11',
  'SOURCES_12',
] as const
export function configuredSources(env: Pick<Env, (typeof SOURCE_PARTS)[number]>): Source[] {
  if (typeof env.SOURCES !== 'string' || !env.SOURCES) throw new Error('sources_part_missing')
  const parts: Source[][] = []
  let missing = false
  for (const key of SOURCE_PARTS) {
    if (env[key] === undefined) {
      missing = true
      continue
    }
    if (missing) throw new Error('sources_part_missing')
    parts.push(validateSources(env[key]!))
  }
  return validateSources(JSON.stringify(parts.flat()))
}

export function answerFields(headers: string[], cells: string[]) {
  if (cells.length !== headers.length) throw new Error('csv_width_invalid')
  // Blank values and duplicate labels are part of the source, never filtered out.
  return headers.map((question, i) => ({ column: i + 1, question, answer: cells[i] }))
}

const paris = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
/** Google Sheets French local timestamp, not the polling time. Refuse DST gaps
 * and folds instead of arbitrarily choosing between two possible instants. */
export function googleTimestamp(value: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) throw new Error('timestamp_invalid')
  const [, day, month, year, hour, minute, second = '0'] = m
  const numbers = [year, month, day, hour, minute, second].map(Number)
  if (numbers[0] < 2000 || numbers[0] > 2100) throw new Error('timestamp_invalid')
  const local = Date.UTC(numbers[0], numbers[1] - 1, numbers[2], numbers[3], numbers[4], numbers[5])
  const candidates = [60, 120]
    .map((offset) => local - offset * 60000)
    .filter((ms) => {
      const parts = Object.fromEntries(paris.formatToParts(ms).map((p) => [p.type, p.value]))
      return ['year', 'month', 'day', 'hour', 'minute', 'second'].every(
        (key, i) => Number(parts[key]) === numbers[i],
      )
    })
  if (candidates.length !== 1)
    throw new Error(candidates.length ? 'timestamp_ambiguous' : 'timestamp_invalid')
  return new Date(candidates[0]).toISOString()
}
class RateLimit extends Error {
  constructor(public until: number) {
    super('noco_429')
  }
}
class Budget extends Error {
  constructor() {
    super('run_budget')
  }
}
/** Count actual SQL executions, including failed attempts. One query is always
 * reserved for durable run status + release; a whole row is admitted before any
 * remote mutation so quota exhaustion cannot prevent its receipt being saved. */
class Queries implements SubmissionDatabase {
  count = 0
  constructor(private readonly db: SubmissionDatabase) {}
  ensure(cost = 1) {
    if (this.count + cost > MAX_D1 - 1) throw new Budget()
  }
  private statement(sql: string, closing: boolean) {
    const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (this.count + 1 > MAX_D1 - (closing ? 0 : 1)) throw new Budget()
      this.count++
      return operation()
    }
    return {
      bind: (...values: (string | number | null)[]) => {
        const bound = this.db.prepare(sql).bind(...values)
        return {
          run: () => execute(() => bound.run()),
          first: <T>() => execute(() => bound.first<T>()),
          all: <T>() => execute(() => bound.all<T>()),
        }
      },
    }
  }
  prepare(sql: string) {
    return this.statement(sql, false)
  }
  finalize(sql: string) {
    return this.statement(sql, true)
  }
}

class Requests {
  count = 0
  constructor(
    readonly rt: Runtime,
    readonly deadline: number,
  ) {}
  ensure(count = 1) {
    if (this.count + count > MAX_HTTP || this.rt.now() >= this.deadline) throw new Budget()
  }
  async fetch(url: string, init: RequestInit = {}) {
    this.ensure()
    this.count++
    // Count every redirect ourselves. Secrets can never follow redirects.
    return this.rt.fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) })
  }
}
function retryDelay(value: string | null, now: number, attempt: number) {
  const seconds = value !== null && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : NaN
  const time = Number.isFinite(seconds) ? seconds : value ? Date.parse(value) - now : NaN
  return Math.max(1500 * 2 ** attempt, Number.isFinite(time) ? Math.max(0, time) : 2000)
}
async function nc(env: Env, req: Requests, path: string, method = 'GET', body?: unknown) {
  for (let attempt = 0; attempt < 3; attempt++) {
    req.ensure()
    await req.rt.sleep(650)
    const r = await req.fetch(NC + path, {
      method,
      headers: { 'xc-token': env.NOCODB_TOKEN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (r.status === 429) {
      const delay = retryDelay(r.headers.get('retry-after'), req.rt.now(), attempt)
      await r.body?.cancel()
      if (
        attempt === 2 ||
        delay > 30000 ||
        req.count >= MAX_HTTP ||
        req.rt.now() + delay >= req.deadline
      )
        throw new RateLimit(req.rt.now() + delay)
      await req.rt.sleep(delay)
      continue
    }
    if (!r.ok) {
      await r.body?.cancel()
      throw new Error(`noco_${r.status}`)
    }
    try {
      return (await r.json()) as Record<string, unknown> | Record<string, unknown>[]
    } catch {
      throw new Error('noco_response_invalid')
    }
  }
  throw new Error('noco_unavailable')
}
async function snapshot(s: Source, req: Requests) {
  let url = `https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/export?format=csv&gid=${s.sheetId}`
  for (let redirects = 0; redirects < 4; redirects++) {
    const r = await req.fetch(url)
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get('location')
      await r.body?.cancel()
      if (!location) throw new Error('google_redirect_invalid')
      const next = new URL(location, url)
      if (
        next.protocol !== 'https:' ||
        next.username ||
        next.password ||
        !(next.hostname === 'docs.google.com' || next.hostname.endsWith('.googleusercontent.com'))
      )
        throw new Error('google_redirect_invalid')
      url = next.href
      continue
    }
    if (!r.ok) {
      await r.body?.cancel()
      throw new Error(`google_${r.status}`)
    }
    const reader = r.body?.getReader()
    if (!reader) throw new Error('google_not_csv')
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 4_000_000) {
        await reader.cancel()
        throw new Error('google_too_large')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (/^\s*</.test(raw)) throw new Error('google_not_csv')
    const rows = parseCsv(raw),
      headers = rows[0]
    if (
      !headers?.length ||
      headers.length > 256 ||
      rows.length > 2001 ||
      !headers.some((h) => /^(Horodateur|Horodatage|Timestamp)$/i.test(h.trim()))
    )
      throw new Error('google_shape_invalid')
    // Validate the WHOLE export before advancing any cursor or writing NocoDB.
    for (const row of rows.slice(1))
      if (row.length !== headers.length) throw new Error('csv_width_invalid')
    return rows
  }
  throw new Error('google_redirect_limit')
}
const sourceKey = (s: Source) => `${s.spreadsheetId}:${s.sheetId}`
function pushSource(env: Env, value: unknown): { source: Source; snapshot: PushSnapshot } {
  const p = value as PushSnapshot
  if (
    !p ||
    p.version !== 1 ||
    !p.source ||
    typeof p.source.spreadsheetId !== 'string' ||
    !Number.isSafeInteger(p.source.sheetId) ||
    !Array.isArray(p.headers) ||
    !p.headers.length ||
    p.headers.length > 256 ||
    !p.headers.every((h) => typeof h === 'string') ||
    !Array.isArray(p.rows) ||
    p.rows.length > 2000 ||
    p.rows.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== p.headers.length ||
        !r.every((c) => typeof c === 'string'),
    )
  )
    throw new Error('snapshot_invalid')
  const source = configuredSources(env).find(
    (s) => s.spreadsheetId === p.source.spreadsheetId && s.sheetId === p.source.sheetId,
  )
  if (!source) throw new Error('source_not_allowed')
  // Validate the timestamp header before reserving any receipt, including empty sheets.
  timestampCell(
    source,
    p.headers,
    p.headers.map(() => ''),
  )
  return { source, snapshot: p }
}
async function readPush(request: Request) {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new Error('json_required')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('snapshot_invalid')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_PUSH_BYTES) {
      await reader.cancel()
      throw new Error('snapshot_too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('snapshot_invalid')
  }
}
/** Read-only bootstrap comparison. No lease, cursor, receipt, NocoDB or Google mutation. */
export async function checkPush(env: Env, input: unknown, now = Date.now()) {
  const { source: s, snapshot: p } = pushSource(env, input),
    key = sourceKey(s)
  const active = await env.STATE.prepare(
    "SELECT expires_at FROM google_transition_runs WHERE id='poll'",
  )
    .bind()
    .first<{ expires_at: number }>()
  if (active && active.expires_at > now) return { state: 'busy' }
  const prior = await env.STATE.prepare(
    'SELECT * FROM google_transition_poller WHERE source_key=? ORDER BY source_row,revision LIMIT 20001',
  )
    .bind(key)
    .all<Receipt>()
  if (prior.results.length > 20000) throw new Error('identity_history_limit')
  const reconciled = await reconcileGoogleRows(
    p.rows.flatMap((cells, i) =>
      i + 2 >= s.firstRow && cells.some(Boolean)
        ? [
            {
              row: i + 2,
              timestamp: timestampCell(s, p.headers, cells),
              fields: answerFields(p.headers, cells),
            },
          ]
        : [],
    ),
    prior.results,
    s.firstRow,
  )
  let matched = 0,
    fresh = 0,
    changed = 0,
    pending = 0
  const differences: { row: number; code: string }[] = []
  for (const item of reconciled) {
    const old = item.previous
    if (!old) {
      fresh++
      differences.push({ row: item.row, code: item.ambiguous ? 'identity_ambiguous' : 'new' })
    } else if (old.fingerprint !== item.fingerprint) {
      changed++
      differences.push({ row: item.row, code: 'changed' })
    } else {
      matched++
      if (!old.noco_id || old.capture_state !== 'complete') pending++
    }
  }
  const seen = new Set(reconciled.map((r) => r.logicalRow))
  const missing = new Set(
    prior.results.filter((r) => !seen.has(r.source_row)).map((r) => r.source_row),
  ).size
  return {
    state: 'checked',
    inputMode: 'push',
    projectionEnabled: env.PROJECTION_ENABLED === 'true',
    enabled: env.ENABLED === 'true',
    configured: !!env.NOCODB_TOKEN && /^[a-z0-9]{10,30}$/.test(env.JOURNAL_TABLE),
    matched,
    fresh,
    changed,
    pending,
    missing,
    differences: differences.slice(0, 100),
    differencesTruncated: differences.length > 100,
  }
}
function timestampCell(s: Source, headers: string[], cells: string[]) {
  const selector = s.personProjection?.mapping.timestamp ?? s.mapping?.timestamp
  const label = typeof selector === 'string' ? selector : selector?.label
  const matches = headers.flatMap((h, i) =>
    (label ? h.trim() === label.trim() : /^(Horodateur|Horodatage|Timestamp)$/i.test(h.trim()))
      ? [i]
      : [],
  )
  if (!matches.length || (typeof selector !== 'object' && matches.length !== 1))
    throw new Error('timestamp_header_invalid')
  const index = matches[typeof selector === 'object' ? selector.occurrence - 1 : 0]
  if (index === undefined) throw new Error('timestamp_header_invalid')
  return cells[index]
}

export async function run(env: Env, options: Partial<Runtime> = {}, input?: PushSnapshot) {
  if (env.ENABLED !== 'true') return { state: 'disabled' }
  if (env.INPUT_MODE && !['poll', 'push'].includes(env.INPUT_MODE))
    throw new Error('input_mode_invalid')
  if (env.INPUT_MODE === 'push' && !input) return { state: 'push_idle' }
  if (input && env.INPUT_MODE !== 'push') throw new Error('push_disabled')
  if (!/^[a-z0-9]{10,30}$/.test(env.JOURNAL_TABLE) || !env.NOCODB_TOKEN)
    throw new Error('configuration_invalid')
  const sources = input ? [pushSource(env, input).source] : configuredSources(env),
    rt = { ...defaults, ...options },
    now = rt.now(),
    owner = crypto.randomUUID()
  const projecting = env.PROJECTION_ENABLED === 'true',
    cutover = Date.parse(env.PROJECTION_START_AT ?? '')
  if (
    projecting &&
    (!isoTimestamp(env.PROJECTION_START_AT ?? '') ||
      !Number.isFinite(cutover) ||
      (configuredSources(env).some((s) => s.kind) &&
        (!env.GOOGLE_FORMS_SYNC_SECRET ||
          env.GOOGLE_FORMS_SYNC_SECRET.length < 32 ||
          env.GOOGLE_FORMS_SYNC_SECRET.length > 256)) ||
      !configuredSources(env).some((s) => s.kind || s.personProjection) ||
      configuredSources(env).some((s) => s.personProjection && !s.projectionFirstRow) ||
      configuredSources(env).some(
        (s) =>
          s.kind &&
          (!s.mapping ||
            !s.projectionFirstRow ||
            (env.INPUT_MODE === 'push' &&
              (s.eventVersion !== 2 ||
                s.cohortId !== 2 ||
                !/^[a-f0-9]{64}$/.test(s.policy?.headerDigest ?? '')))),
      ))
  )
    throw new Error('projection_configuration_invalid')
  const d1 = new Queries(env.STATE)
  // Worst-case SQL cost includes error journaling and explicit-429 rollback.
  const deliveryQueries = projecting ? 20 : 6
  // Lease exceeds the platform's 15-minute scheduled execution maximum. Every
  // release/claim is fenced by owner; an old invocation cannot unlock a new run.
  const claimed = await d1
    .prepare(
      `INSERT INTO google_transition_runs(id,owner,expires_at) VALUES('poll',?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<?`,
    )
    .bind(owner, now + 20 * 60000, now)
    .run()
  if (!claimed.meta.changes) return { state: 'busy' }
  // Push is called synchronously by GAS: leave room within its execution limit.
  const req = new Requests(rt, now + (input ? 45000 : 10 * 60000))
  const result = {
    state: 'complete',
    httpRequests: 0,
    d1Queries: 0,
    processed: 0,
    inspected: 0,
    sources: [] as { label: string; rows?: number; captured: number; error?: string }[],
  }
  const summaries = new Map(
    sources.map((s) => [
      sourceKey(s),
      { label: s.label, captured: 0 } as (typeof result.sources)[number],
    ]),
  )
  const report = (s: Source, error?: string) => {
    const summary = summaries.get(sourceKey(s))!
    if (!result.sources.includes(summary)) result.sources.push(summary)
    if (error) {
      summary.error = error
      result.state = 'attention_required'
    }
    return summary
  }
  const catchup = () => {
    if (result.state !== 'attention_required') result.state = 'catching_up'
  }
  const sourceSnapshots = new Map<
    string,
    Promise<{
      rows: string[][]
      history: Receipt[]
      identities: Awaited<ReturnType<typeof reconcileGoogleRows<Receipt>>>
    }>
  >()
  function currentSource(s: Source) {
    const key = sourceKey(s)
    if (!sourceSnapshots.has(key))
      sourceSnapshots.set(
        key,
        (async () => {
          const rows = input ? [input.headers, ...input.rows] : await snapshot(s, req)
          const prior = await d1
            .prepare(
              'SELECT * FROM google_transition_poller WHERE source_key=? ORDER BY source_row,revision LIMIT 20001',
            )
            .bind(key)
            .all<Receipt>()
          if (prior.results.length > 20000) throw new Error('identity_history_limit')
          const identities = await reconcileGoogleRows(
            rows.slice(1).flatMap((cells, i) =>
              i + 2 >= s.firstRow && cells.some(Boolean)
                ? [
                    {
                      row: i + 2,
                      timestamp: timestampCell(s, rows[0], cells),
                      fields: answerFields(rows[0], cells),
                    },
                  ]
                : [],
            ),
            prior.results,
            s.firstRow,
          )
          return { rows, history: prior.results, identities }
        })(),
      )
    return sourceSnapshots.get(key)!
  }
  async function ownership() {
    const row = await d1
      .prepare(
        "SELECT owner FROM google_transition_runs WHERE id='poll' AND owner=? AND expires_at>?",
      )
      .bind(owner, rt.now())
      .first()
    if (!row) throw new Error('run_ownership_lost')
  }
  async function save(key: string, fields: Record<string, string | number | null>) {
    await ownership()
    const entries = Object.entries({ ...fields, updated_at: new Date(rt.now()).toISOString() })
    const changed = await d1
      .prepare(
        `UPDATE google_transition_poller SET ${entries.map(([k]) => k + '=?').join(',')} WHERE response_key=?`,
      )
      .bind(...entries.map(([, v]) => v), key)
      .run()
    if (changed.meta.changes !== 1) throw new Error('receipt_missing')
  }
  function expected(r: Receipt, c: Captured) {
    return {
      cle_reponse: r.response_key,
      formulaire: c.label,
      horodatage_source: c.timestamp,
      ligne_source: c.physicalRow ?? r.source_row,
      revision: r.revision,
      reponses: JSON.stringify(answerFields(c.headers, c.cells)),
      source_url: `https://docs.google.com/spreadsheets/d/${r.source_key.split(':')[0]}/edit#gid=${r.source_key.split(':')[1]}`,
    }
  }
  function verified(record: Record<string, unknown>, fields: Record<string, unknown>) {
    if (!validId(record?.Id) || Object.entries(fields).some(([k, v]) => record[k] !== v))
      throw new Error('noco_receipt_mismatch')
    return record.Id
  }
  async function projectionPayload(r: Receipt, s: Source, captured: Captured) {
    const event = await mapGoogleSheetRowVerified({
      source: { ...s, kind: s.kind!, cohortId: s.cohortId ?? 2 },
      mapping: s.mapping!,
      policy: s.policy,
      headers: captured.headers,
      values: captured.cells,
      row: r.source_row,
      revision: r.revision,
      submittedAt: googleTimestamp(captured.timestamp),
      readAt: captured.readAt,
    })
    const payload = JSON.stringify(event)
    if (new TextEncoder().encode(payload).length > 32768)
      throw new Error('projection_payload_too_large')
    return payload
  }
  async function projectPerson(r: Receipt, s: Source, captured: Captured) {
    const config = s.personProjection!,
      configDigest = await digest(JSON.stringify(config))
    let outcome: Outcome | null = r.projection_outcome ? JSON.parse(r.projection_outcome) : null
    let frozen: { configDigest: string; plan: PersonPlan } | null = r.projection_payload
      ? JSON.parse(r.projection_payload)
      : null
    const read = (path: string) => nc(env, req, path)
    if (!outcome || outcome.state === 'writing') {
      const current = await currentSource(s),
        identity = current.identities.find((i) => i.logicalRow === r.source_row)
      if (frozen && frozen.configDigest !== configDigest)
        outcome = { state: 'review', code: 'projection_configuration_changed' }
      else if (
        !identity ||
        identity.fingerprint !== r.fingerprint ||
        (identity.previous && identity.previous.response_key !== r.response_key)
      )
        outcome = { state: 'review', code: 'source_changed_before_projection' }
      else if (captured.identityAmbiguous) outcome = { state: 'review', code: 'identity_ambiguous' }
      else if (
        r.revision !== 1 ||
        r.source_row < s.projectionFirstRow! ||
        Date.parse(captured.readAt) < cutover ||
        Date.parse(googleTimestamp(captured.timestamp)) < cutover
      )
        outcome = { state: 'review', code: 'before_cutover' }
      if (!outcome && !frozen) {
        let planned
        try {
          planned = await planGooglePerson(
            config,
            captured.headers,
            captured.cells,
            googleTimestamp(captured.timestamp),
            read,
          )
        } catch (e) {
          // Transport failures remain retryable; deterministic schema/identity errors are reviewable.
          if (!(e instanceof Error) || !/^(person_|sheet_|identity_)/.test(e.message)) throw e
          planned = { state: 'review' as const, code: codeOf(e) }
        }
        if (planned.state === 'review') outcome = planned
        else {
          frozen = { configDigest, plan: planned.plan }
          await save(r.response_key, { projection_payload: JSON.stringify(frozen) })
        }
      }
      if (frozen && (!outcome || outcome.state === 'writing')) {
        // Reserve HTTP headroom BEFORE marking or issuing any business mutation.
        req.ensure(10)
        let claim: { response_key: string } | null = null
        if (frozen.plan.create) {
          await ownership()
          await d1
            .prepare(
              `INSERT INTO google_transition_person_claims(identity_key,response_key,created_at) VALUES(?,?,?) ON CONFLICT(identity_key) DO NOTHING`,
            )
            .bind(frozen.plan.create.key, r.response_key, new Date(rt.now()).toISOString())
            .run()
          claim = await d1
            .prepare(
              'SELECT response_key FROM google_transition_person_claims WHERE identity_key=?',
            )
            .bind(frozen.plan.create.key)
            .first<{ response_key: string }>()
          if (!claim) throw new Error('person_claim_missing')
        }
        const actual = await checkGooglePersonPlan(frozen.plan, read)
        if (frozen.plan.create && actual === 'after')
          await save(r.response_key, { projection_payload: JSON.stringify(frozen) })
        if (actual === 'after')
          outcome = {
            state: 'complete',
            code: frozen.plan.linkOnly
              ? 'linked_raw_only'
              : frozen.plan.remaining
                ? 'saved_raw_remaining'
                : 'saved',
          }
        else if (claim && claim.response_key !== r.response_key)
          outcome = { state: 'review', code: 'person_creation_already_claimed' }
        else if (outcome?.state === 'writing')
          outcome = { state: 'review', code: 'business_write_uncertain' }
        else if (actual !== 'before') outcome = { state: 'review', code: 'existing_value_conflict' }
        else {
          await ownership()
          await save(r.response_key, {
            projection_outcome: JSON.stringify({
              state: 'writing',
              code: 'business_write_pending',
            }),
          })
          try {
            await nc(
              env,
              req,
              `tables/${frozen.plan.table}/records`,
              frozen.plan.create ? 'POST' : 'PATCH',
              {
                ...(frozen.plan.create ? {} : { Id: frozen.plan.id }),
                ...frozen.plan.after,
              },
            )
          } catch (e) {
            if (e instanceof RateLimit) await save(r.response_key, { projection_outcome: null })
            throw e
          }
          outcome =
            (await checkGooglePersonPlan(frozen.plan, read)) === 'after'
              ? {
                  state: 'complete',
                  code: frozen.plan.linkOnly
                    ? 'linked_raw_only'
                    : frozen.plan.remaining
                      ? 'saved_raw_remaining'
                      : 'saved',
                }
              : { state: 'review', code: 'business_write_uncertain' }
        }
      }
      if (!outcome) throw new Error('projection_uncertain')
      if (frozen?.plan.create && outcome.state === 'complete')
        await save(r.response_key, { projection_payload: JSON.stringify(frozen) })
      await save(r.response_key, { projection_outcome: JSON.stringify(outcome) })
    }
    return { outcome, plan: frozen?.plan }
  }
  async function deliver(r: Receipt, s: Source) {
    req.ensure(3)
    d1.ensure(deliveryQueries + 1) // leave the current source cursor durable too
    result.processed++
    const captured = JSON.parse(r.raw_payload) as Captured,
      fields = expected(r, captured),
      path = `tables/${env.JOURNAL_TABLE}/records`
    try {
      if (!r.noco_id) {
        const found = (await nc(
          env,
          req,
          `${path}?where=${encodeURIComponent(`(cle_reponse,eq,${r.response_key})`)}&limit=2`,
        )) as { list?: Record<string, unknown>[]; pageInfo?: { isLastPage?: boolean } }
        if (
          !Array.isArray(found.list) ||
          found.list.length > 1 ||
          found.pageInfo?.isLastPage === false
        )
          throw new Error('duplicate_receipt')
        let record = found.list[0]
        if (!record) {
          // A lost POST might still commit later. An empty lookup is NOT proof
          // that it failed: never automatically create a second row.
          if (r.capture_state === 'writing') throw new Error('write_uncertain')
          req.ensure(2)
          await save(r.response_key, { capture_state: 'writing' })
          r.capture_state = 'writing'
          let response: Record<string, unknown> | Record<string, unknown>[]
          try {
            response = await nc(env, req, path, 'POST', {
              ...fields,
              statut_reprise: 'À rapprocher',
              date_reprise: captured.readAt,
              detail_reprise: googleReconciliationDetail(
                r.source_key,
                {
                  state: 'review',
                  code: captured.identityAmbiguous
                    ? 'identity_ambiguous'
                    : s.kind || s.personProjection
                      ? 'projection_pending'
                      : 'mapping_not_configured',
                },
                captured.readAt,
              ),
            })
          } catch (e) {
            // Explicit 429 is a rejected write; other failures retain 'writing'.
            if (e instanceof RateLimit) {
              await save(r.response_key, { capture_state: 'pending' })
              r.capture_state = 'pending'
            }
            throw e
          }
          const created = Array.isArray(response) && response.length === 1 ? response[0] : response
          if (!validId((created as Record<string, unknown>)?.Id))
            throw new Error('noco_receipt_missing')
          record = (await nc(
            env,
            req,
            `${path}/${(created as Record<string, unknown>).Id}`,
          )) as Record<string, unknown>
        }
        r.noco_id = verified(record, fields)
        await save(r.response_key, {
          noco_id: r.noco_id,
          capture_state: 'complete',
          attempts: 0,
          next_attempt_at: 0,
          last_error: null,
        })
        r.capture_state = 'complete'
        report(s).captured++
      }
      if (projecting && r.projection_eligible && !r.projection_complete) {
        let personPlan: PersonPlan | undefined
        let outcome: Outcome | null = r.projection_outcome ? JSON.parse(r.projection_outcome) : null
        if (s.personProjection) {
          const projected = await projectPerson(r, s, captured)
          outcome = projected.outcome
          personPlan = projected.plan
        }
        if (!outcome) {
          const current = await currentSource(s)
          const identity = current.identities.find((i) => i.logicalRow === r.source_row)
          if (
            !identity ||
            identity.fingerprint !== r.fingerprint ||
            (identity.previous && identity.previous.response_key !== r.response_key)
          )
            outcome = { state: 'review', code: 'source_changed_before_projection' }
          else if (captured.identityAmbiguous)
            outcome = { state: 'review', code: 'identity_ambiguous' }
          else if (
            input &&
            (!s.kind ||
              s.eventVersion !== 2 ||
              s.cohortId !== 2 ||
              r.revision !== 1 ||
              r.source_row < s.projectionFirstRow! ||
              Date.parse(captured.readAt) < cutover ||
              Date.parse(googleTimestamp(captured.timestamp)) < cutover)
          )
            outcome = { state: 'review', code: 'before_cutover' }
          else if (
            input &&
            (await digest(JSON.stringify(captured.headers))) !== s.policy?.headerDigest
          )
            outcome = { state: 'review', code: 'sheet_headers_changed' }
          else if (r.projection_payload) {
            try {
              if ((await projectionPayload(r, s, captured)) !== r.projection_payload)
                outcome = { state: 'review', code: 'projection_configuration_changed' }
            } catch {
              outcome = { state: 'review', code: 'projection_configuration_changed' }
            }
          }
          if (!outcome && !r.projection_payload) {
            try {
              r.projection_payload = await projectionPayload(r, s, captured)
            } catch (e) {
              outcome = { state: 'review', code: codeOf(e) }
            }
            // A storage failure is retryable; do not misclassify it as invalid input.
            if (!outcome) await save(r.response_key, { projection_payload: r.projection_payload })
          }
          if (!outcome) {
            await ownership()
            const response = await req.fetch(HOOK, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-google-forms-secret': env.GOOGLE_FORMS_SYNC_SECRET!,
              },
              body: r.projection_payload!,
            })
            if (response.status !== 200) {
              await response.body?.cancel()
              throw new Error(`projection_${response.status}`)
            }
            const body = (await response.json()) as Outcome
            if (
              !['complete', 'review'].includes(body.state) ||
              !/^[a-f0-9]{64}$/.test(body.receipt ?? '') ||
              !/^[a-z_0-9]+$/.test(body.code ?? '')
            )
              throw new Error('projection_uncertain')
            outcome = body
          }
          await save(r.response_key, { projection_outcome: JSON.stringify(outcome) })
        }
        // Read immediately before the journal patch, retaining operator annotations
        // and prior business evidence rather than replacing detail_reprise.
        req.ensure(3)
        const journalBefore = (await nc(env, req, `${path}/${r.noco_id}`)) as Record<
          string,
          unknown
        >
        verified(journalBefore, fields)
        const patch = {
          Id: r.noco_id,
          statut_reprise:
            outcome.state === 'complete' && outcome.code === 'saved'
              ? 'Repris dans le dossier'
              : 'À rapprocher',
          detail_reprise: googleReconciliationDetail(
            r.source_key,
            outcome,
            new Date(rt.now()).toISOString(),
            personPlan,
          ),
        }
        patch.detail_reprise = mergeGoogleReconciliationDetail(
          journalBefore.detail_reprise,
          patch.detail_reprise,
        )
        if (hasPendingGoogleReconciliation(patch.detail_reprise))
          patch.statut_reprise = 'À rapprocher'
        await ownership()
        await nc(env, req, path, 'PATCH', patch)
        const checked = (await nc(env, req, `${path}/${r.noco_id}`)) as Record<string, unknown>
        verified(checked, { ...fields, ...patch })
        await save(r.response_key, {
          projection_complete: 1,
          attempts: 0,
          next_attempt_at: 0,
          last_error: null,
        })
      }
    } catch (e) {
      if (e instanceof Budget) {
        catchup()
        throw e
      }
      const code = codeOf(e),
        delay = Math.min(3600000, 60000 * 2 ** Math.min(r.attempts, 6))
      await save(r.response_key, {
        attempts: r.attempts + 1,
        next_attempt_at:
          e instanceof RateLimit ? Math.max(e.until, rt.now() + delay) : rt.now() + delay,
        last_error: code,
      })
      report(s, code)
    }
  }
  try {
    // Drain reserved source evidence even if a later export edits/removes a row.
    const pending = await d1
      .prepare(
        `SELECT * FROM google_transition_poller WHERE next_attempt_at<=? AND
      (noco_id IS NULL OR (?=1 AND projection_eligible=1 AND projection_complete=0))
      AND (? IS NULL OR source_key=?) ORDER BY updated_at,response_key LIMIT 10`,
      )
      .bind(
        now,
        projecting ? 1 : 0,
        input ? sourceKey(sources[0]) : null,
        input ? sourceKey(sources[0]) : null,
      )
      .all<Receipt>()
    const attempted = new Set<string>()
    for (const receipt of pending.results) {
      const s = sources.find((s) => sourceKey(s) === receipt.source_key)
      if (!s) continue
      // Pending work cannot consume the budget needed to inspect fresh sources.
      if (d1.count + deliveryQueries > 24) {
        catchup()
        break
      }
      attempted.add(receipt.response_key)
      await deliver(receipt, s)
    }
    const rotation = await d1
      .prepare("SELECT next_source FROM google_transition_runs WHERE id='poll'")
      .bind()
      .first<{ next_source: number }>()
    for (let n = 0; n < Math.min(sources.length, MAX_SOURCES); n++) {
      if (result.processed >= MAX_ROWS || result.inspected >= MAX_INSPECTED) {
        catchup()
        break
      }
      req.ensure(4)
      d1.ensure(3 + 3 + deliveryQueries + 1)
      const index = ((rotation?.next_source ?? 0) + n) % sources.length,
        s = sources[index],
        key = sourceKey(s)
      await d1
        .prepare("UPDATE google_transition_runs SET next_source=? WHERE id='poll' AND owner=?")
        .bind((index + 1) % sources.length, owner)
        .run()
      try {
        const current = await currentSource(s),
          rows = current.rows,
          headers = rows[0],
          summary = report(s)
        summary.rows = rows.slice(s.firstRow - 1).filter((r) => r.some(Boolean)).length
        const cursor = await d1
          .prepare('SELECT next_row FROM google_transition_sources WHERE source_key=?')
          .bind(key)
          .first<{ next_row: number }>()
        let row = Math.max(s.firstRow, cursor?.next_row ?? s.firstRow)
        if (row > rows.length) row = s.firstRow
        const available = Math.min(
          Math.max(0, rows.length - row + 1),
          MAX_INSPECTED - result.inspected,
        )
        const identities = new Map(current.identities.map((identity) => [identity.row, identity]))
        try {
          for (let step = 0; step < available; step++) {
            if (result.inspected >= MAX_INSPECTED || result.processed >= MAX_ROWS) {
              catchup()
              break
            }
            req.ensure(3)
            const cells = rows[row - 1]
            result.inspected++
            if (cells.some(Boolean)) {
              const fingerprint = await digest(JSON.stringify(answerFields(headers, cells)))
              const identity = identities.get(row)!
              let receipt: Receipt | null | undefined = identity.previous
              if (!receipt || receipt.fingerprint !== fingerprint) {
                d1.ensure(3 + deliveryQueries + 1) // reserve, deliver, checkpoint
                const revision = identity.maxRevision + 1,
                  logicalRow = identity.logicalRow,
                  responseKey = await digest(
                    JSON.stringify([key, logicalRow, revision, fingerprint]),
                  )
                const captured: Captured = {
                  headers,
                  cells,
                  physicalRow: row,
                  identityAmbiguous: identity.ambiguous,
                  label: s.label,
                  timestamp: timestampCell(s, headers, cells),
                  readAt: new Date(rt.now()).toISOString(),
                }
                let eligible = false
                if (
                  projecting &&
                  revision === 1 &&
                  (s.kind || s.personProjection) &&
                  identity.logicalRow >= s.projectionFirstRow!
                ) {
                  try {
                    eligible =
                      Date.parse(googleTimestamp(captured.timestamp)) >= cutover &&
                      rt.now() >= cutover
                  } catch {
                    /* raw capture still required */
                  }
                }
                await ownership()
                await d1
                  .prepare(
                    `INSERT INTO google_transition_poller(response_key,source_key,source_row,fingerprint,revision,raw_payload,projection_eligible,updated_at)
                VALUES(?,?,?,?,?,?,?,?)`,
                  )
                  .bind(
                    responseKey,
                    key,
                    logicalRow,
                    fingerprint,
                    revision,
                    JSON.stringify(captured),
                    eligible ? 1 : 0,
                    captured.readAt,
                  )
                  .run()
                receipt = await d1
                  .prepare('SELECT * FROM google_transition_poller WHERE response_key=?')
                  .bind(responseKey)
                  .first<Receipt>()
                if (!receipt) throw new Error('receipt_missing')
                identity.previous = receipt
              }
              if (
                !attempted.has(receipt.response_key) &&
                receipt.next_attempt_at <= rt.now() &&
                (!receipt.noco_id ||
                  (projecting && receipt.projection_eligible && !receipt.projection_complete))
              ) {
                attempted.add(receipt.response_key)
                await deliver(receipt, s)
              }
            }
            row = row >= rows.length ? s.firstRow : row + 1
          }
        } finally {
          // Persist progress even when a later row hits either budget. A crash
          // before this checkpoint merely rereads already idempotent receipts.
          await d1
            .prepare(
              "INSERT INTO google_transition_sources(source_key,next_row) SELECT ?,? WHERE EXISTS (SELECT 1 FROM google_transition_runs WHERE id='poll' AND owner=?) ON CONFLICT(source_key) DO UPDATE SET next_row=excluded.next_row",
            )
            .bind(key, row, owner)
            .run()
        }
      } catch (e) {
        if (e instanceof Budget) throw e
        report(s, codeOf(e))
      }
    }
  } catch (e) {
    if (e instanceof Budget) catchup()
    else {
      result.state = 'attention_required'
      throw e
    }
  } finally {
    result.httpRequests = req.count
    result.d1Queries = d1.count + 1 // include the reserved final query below
    // Ownership fencing prevents a timed-out older invocation releasing a new one.
    await d1
      .finalize(
        "UPDATE google_transition_runs SET last_result=?,expires_at=0 WHERE id='poll' AND owner=?",
      )
      .bind(JSON.stringify({ at: new Date(rt.now()).toISOString(), ...result }), owner)
      .run()
  }
  return result
}
export async function handleRequest(request: Request, env: Env, options: Partial<Runtime> = {}) {
  const path = new URL(request.url).pathname
  const ingest = path === '/ingest' || path === '/check'
  const auth = request.headers.get('authorization') ?? ''
  const secret = ingest ? (env.INGEST_SECRET ?? env.RUN_SECRET) : env.RUN_SECRET
  if (
    !secret ||
    secret.length < 32 ||
    auth.length > 512 ||
    (await digest(auth)) !== (await digest(`Bearer ${secret}`))
  )
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const reply = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  if (ingest) {
    if (request.method !== 'POST') return reply({ code: 'post_required' }, 405)
    if (env.INPUT_MODE !== 'push') return reply({ code: 'push_disabled' }, 409)
    if (path === '/ingest' && env.ENABLED !== 'true') return reply({ state: 'disabled' }, 503)
    try {
      const parsed = pushSource(env, await readPush(request)).snapshot
      if (path === '/check') return reply(await checkPush(env, parsed, (options.now ?? Date.now)()))
      const result = await run(env, options, parsed)
      return reply(result, result.state === 'busy' ? 409 : 200)
    } catch (e) {
      const code = codeOf(e)
      const status =
        code === 'snapshot_too_large'
          ? 413
          : code === 'json_required'
            ? 415
            : code === 'source_not_allowed'
              ? 403
              : ['snapshot_invalid', 'timestamp_header_invalid'].includes(code)
                ? 400
                : 503
      return reply({ code }, status)
    }
  }
  if (path !== '/') return new Response('Not found', { status: 404 })
  if (request.method === 'POST') {
    if (env.INPUT_MODE === 'push') return reply({ code: 'snapshot_required' }, 409)
    return reply(await run(env, options))
  }
  if (request.method !== 'GET') return new Response('', { status: 405 })
  const state = await env.STATE.prepare(
    "SELECT last_result FROM google_transition_runs WHERE id='poll'",
  )
    .bind()
    .first<{ last_result: string | null }>()
  return Response.json(
    {
      enabled: env.ENABLED === 'true',
      projectionEnabled: env.PROJECTION_ENABLED === 'true',
      last: state?.last_result ? JSON.parse(state.last_result) : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    // A deployed cron is inert in push mode; it must never fetch Google.
    if (env.INPUT_MODE === 'push') return
    ctx.waitUntil(run(env))
  },
  fetch(request: Request, env: Env) {
    return handleRequest(request, env)
  },
}
