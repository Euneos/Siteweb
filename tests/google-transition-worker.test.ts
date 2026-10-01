import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import worker, {
  answerFields,
  googleTimestamp,
  handleRequest,
  parseCsv,
  run,
  validateSources,
  configuredSources,
  type Env,
  type Source,
  type PushSnapshot,
} from '../workers/google-transition/worker'
import type { SubmissionDatabase } from '../src/lib/candidature-store'
import { digest } from '../src/lib/google-form-sync'
import { futureSheet } from './fixtures/google-future'

const source = (overrides: Partial<Source> = {}): Source => ({
  label: 'Formulaire fictif',
  spreadsheetId: 'fictional_sheet_id_00001',
  sheetId: 0,
  firstRow: 2,
  ...overrides,
})
const headers = [
  'Horodateur',
  'Établissement',
  'Ville',
  'CP',
  'Email',
  'Début',
  'Fin',
  'Participants',
  'Question',
  'Question',
]
const answer = (name = 'Collège fictif', stamp = '29/09/2026 10:00:00') => [
  stamp,
  name,
  'Ville fictive',
  '01234',
  'fictif@example.invalid',
  '01/10/2026',
  '01/02/2027',
  'Une personne',
  'Réponse A',
  '',
]
const csv = (rows: string[][]) =>
  rows.map((row) => row.map((c) => '"' + c.replaceAll('"', '""') + '"').join(',')).join('\r\n')
let sql: Database,
  env: Env,
  clock: number,
  sheets: Map<string, string>,
  remote: Record<string, unknown>[],
  calls: { url: string; init: RequestInit }[],
  sleeps: number[],
  queryRuns: string[][]
let fault: ((url: string, init: RequestInit) => Response | Promise<Response | void> | void) | null
let storeFault: ((query: string, values: unknown[]) => void) | null
function db(onQuery: (query: string) => void = () => {}): SubmissionDatabase {
  return {
    prepare: (query) => ({
      bind: (...values) => ({
        run: async () => {
          onQuery(query)
          storeFault?.(query, values)
          return { meta: { changes: sql.query(query).run(...values).changes } }
        },
        first: async <T>() => {
          onQuery(query)
          storeFault?.(query, values)
          return sql.query(query).get(...values) as T | null
        },
        all: async <T>() => {
          onQuery(query)
          storeFault?.(query, values)
          return { results: sql.query(query).all(...values) as T[] }
        },
      }),
    }),
  }
}
const fakeFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input)
  calls.push({ url, init })
  if (fault) {
    const result = await fault(url, init)
    if (result) return result
  }
  const u = new URL(url)
  if (u.hostname === 'docs.google.com' || u.hostname.endsWith('.googleusercontent.com'))
    return new Response(
      sheets.get(u.pathname.split('/')[3]) ?? sheets.values().next().value ?? '',
      { headers: { 'content-type': 'text/csv' } },
    )
  if (url === 'https://euneos.fr/api/hook/google-forms')
    return Response.json({ state: 'review', code: 'existing_projection', receipt: 'a'.repeat(64) })
  expect(u.origin).toBe('https://app.nocodb.com')
  expect(init.redirect).toBe('manual')
  expect((init.headers as Record<string, string>)['xc-token']).toBe('fake-token')
  const method = init.method ?? 'GET',
    body = init.body ? JSON.parse(String(init.body)) : null
  if (method === 'POST') {
    const row = { Id: remote.length + 1, ...body }
    remote.push(row)
    return Response.json(row)
  }
  if (method === 'PATCH') {
    Object.assign(
      remote.find((r) => r.Id === body.Id)!,
      body,
    )
    return Response.json(body)
  }
  expect(method).toBe('GET')
  const id = /\/records\/(\d+)$/.exec(u.pathname)?.[1]
  if (id) return Response.json(remote.find((r) => r.Id === Number(id)))
  const key = /\(cle_reponse,eq,([a-f0-9]+)\)/.exec(u.searchParams.get('where') ?? '')?.[1]
  return Response.json({
    list: remote.filter((r) => r.cle_reponse === key),
    pageInfo: { isLastPage: true },
  })
}) as typeof fetch
const runtime = () => ({
  now: () => clock,
  sleep: async (ms: number) => {
    sleeps.push(ms)
    clock += ms
  },
  fetch: fakeFetch,
})
const poll = async (input?: PushSnapshot) => {
  // Independent instrumentation at the actual D1 boundary, scoped per invocation
  // (including overlapping polls). Failed SQL executions count too.
  const queries: string[] = []
  queryRuns.push(queries)
  try {
    const result = await run(
      {
        ...env,
        STATE: db((query) => {
          queries.push(query)
          if (queries.length > 50) throw new Error('free_d1_limit')
        }),
      },
      runtime(),
      input,
    )
    if ('d1Queries' in result) expect(result.d1Queries).toBe(queries.length)
    return result
  } finally {
    expect(queries.length).toBeLessThanOrEqual(48)
  }
}
const ledger = () =>
  sql
    .query('SELECT * FROM google_transition_poller ORDER BY source_key,source_row,revision')
    .all() as Record<string, unknown>[]
const writes = () =>
  calls.filter((c) => c.url.startsWith('https://app.nocodb.com') && c.init.method === 'POST')
const hooks = () => calls.filter((c) => c.url === 'https://euneos.fr/api/hook/google-forms')
async function seed(s: Source, rows: string[][]) {
  // Same stable bootstrap contract as production, with entirely fictional data.
  const key = `${s.spreadsheetId}:${s.sheetId}`
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i],
      row = i + 1,
      fields = answerFields(rows[0], cells),
      fingerprint = await digest(JSON.stringify(fields)),
      responseKey = await digest(JSON.stringify([key, row, 1, fingerprint])),
      readAt = new Date(clock).toISOString(),
      id = remote.length + 1
    sql
      .query(
        `INSERT INTO google_transition_poller
      (response_key,source_key,source_row,fingerprint,revision,raw_payload,capture_state,noco_id,updated_at)
      VALUES(?,?,?,?,1,?,'complete',?,?)`,
      )
      .run(
        responseKey,
        key,
        row,
        fingerprint,
        JSON.stringify({ headers: rows[0], cells, label: s.label, timestamp: cells[0], readAt }),
        id,
        readAt,
      )
    remote.push({ Id: id, cle_reponse: responseKey })
  }
  sheets.set(s.spreadsheetId, csv(rows))
}
function projection() {
  env.PROJECTION_ENABLED = 'true'
  env.PROJECTION_START_AT = '2026-09-29T06:00:00Z'
  env.GOOGLE_FORMS_SYNC_SECRET = 'fictional-bridge-secret-over-32-characters'
  env.SOURCES = JSON.stringify([
    source({
      kind: 'contact',
      projectionFirstRow: 2,
      mapping: {
        timestamp: 'Horodateur',
        name: 'Établissement',
        city: 'Ville',
        postcode: 'CP',
        referenceEmail: 'Email',
        start: 'Début',
        end: 'Fin',
        participants: 'Participants',
      },
    }),
  ])
}
beforeEach(() => {
  sql = new Database(':memory:')
  sql.exec(
    readFileSync(new URL('../workers/google-transition/schema.sql', import.meta.url), 'utf8'),
  )
  clock = Date.parse('2026-09-29T08:30:00Z')
  sheets = new Map([[source().spreadsheetId, csv([headers, answer()])]])
  remote = []
  calls = []
  sleeps = []
  queryRuns = []
  fault = null
  storeFault = null
  env = {
    STATE: db(),
    NOCODB_TOKEN: 'fake-token',
    JOURNAL_TABLE: 'fictionaltable001',
    SOURCES: JSON.stringify([source()]),
    ENABLED: 'true',
    PROJECTION_ENABLED: 'false',
    RUN_SECRET: 'fictional-run-secret-over-32-characters',
  }
})

const pushed = (s = source(), rows = [answer()]): PushSnapshot => ({
  version: 1,
  source: { spreadsheetId: s.spreadsheetId, sheetId: s.sheetId },
  headers,
  rows,
})
const pushRequest = (path: string, body: unknown, token = env.INGEST_SECRET ?? env.RUN_SECRET) =>
  new Request('https://worker.invalid' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  })
const ingest = (body: unknown, path = '/ingest') =>
  handleRequest(pushRequest(path, body), env, runtime())

test('push uses bootstrap receipts, captures changed/raw fields and never fetches Google or hook', async () => {
  env.INPUT_MODE = 'push'
  await seed(source(), [headers, answer()])
  const result = await poll(pushed())
  expect(result.state).toBe('complete')
  expect(writes()).toHaveLength(0)
  expect(calls).toHaveLength(0)
  const edited = answer()
  edited[9] = 'Ancienne colonne remplie'
  await poll(pushed(source(), [edited, answer('Nouvelle réponse', '29/09/2026 10:01:00')]))
  expect(writes()).toHaveLength(2)
  expect(ledger().map((r) => r.revision)).toEqual([1, 2, 1])
  expect(calls.every((c) => c.url.startsWith('https://app.nocodb.com'))).toBe(true)
  expect(JSON.parse(String(remote[1].reponses)).at(-1).answer).toBe('Ancienne colonne remplie')
})
test('push cron and operator POST cannot poll sources, even enabled', async () => {
  env.INPUT_MODE = 'push'
  let waited = false
  await worker.scheduled({}, env, {
    waitUntil: () => {
      waited = true
    },
  })
  expect(waited).toBe(false)
  expect(await poll()).toEqual({ state: 'push_idle' })
  expect((await ingest({}, '/')).status).toBe(409)
  expect(calls).toHaveLength(0)
  expect(sql.query('SELECT * FROM google_transition_runs').all()).toHaveLength(0)
})
test('push authentication, allowlist, complete shape, body limit and JSON encoding checked before writes', async () => {
  env.INPUT_MODE = 'push'
  env.INGEST_SECRET = 'separate-fictional-ingest-secret-over32'
  expect(
    (await handleRequest(pushRequest('/ingest', pushed(), env.RUN_SECRET), env, runtime())).status,
  ).toBe(404)
  expect((await ingest(pushed(source({ sheetId: 99 })))).status).toBe(403)
  expect((await ingest({ ...pushed(), rows: [['truncated']] })).status).toBe(400)
  expect((await ingest({ ...pushed(), rows: [[123, ...answer().slice(1)]] })).status).toBe(400)
  expect((await ingest({ ...pushed(), headers: headers.map(() => 'Ambiguous') })).status).toBe(400)
  const huge = answer()
  huge[9] = 'x'.repeat(1000000)
  expect((await ingest(pushed(source(), [huge]))).status).toBe(413)
  const malformed = new Request('https://worker.invalid/ingest', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.INGEST_SECRET, 'Content-Type': 'application/json' },
    body: new Uint8Array([0xc3, 0x28]),
  })
  expect((await handleRequest(malformed, env, runtime())).status).toBe(400)
  expect(ledger()).toHaveLength(0)
  expect(sql.query('SELECT * FROM google_transition_runs').all()).toHaveLength(0)
  expect(calls).toHaveLength(0)
})
test('check is read-only while disabled, reports CSV/display differences and refuses unrelated source', async () => {
  env.INPUT_MODE = 'push'
  env.ENABLED = 'false'
  await seed(source(), [headers, answer(), answer('Historique absent', '29/09/2026 10:01:00')])
  const before = JSON.stringify(ledger()),
    changed = answer()
  changed[0] = '29/09/2026 10:00' // formatting differences must not silently duplicate bootstrap
  const exact = await (
    await ingest(
      pushed(source(), [answer(), answer('Historique absent', '29/09/2026 10:01:00')]),
      '/check',
    )
  ).json()
  expect(exact).toMatchObject({
    state: 'checked',
    matched: 2,
    fresh: 0,
    changed: 0,
    missing: 0,
    enabled: false,
  })
  const diff = await (await ingest(pushed(source(), [changed]), '/check')).json()
  expect(diff).toMatchObject({
    matched: 0,
    changed: 1,
    missing: 1,
    differences: [{ row: 2, code: 'changed' }],
  })
  expect((await ingest(pushed(source({ sheetId: 1 })), '/check')).status).toBe(403)
  expect((await ingest(pushed())).status).toBe(503)
  expect(JSON.stringify(ledger())).toBe(before)
  expect(sql.query('SELECT * FROM google_transition_sources').all()).toHaveLength(0)
  expect(sql.query('SELECT * FROM google_transition_runs').all()).toHaveLength(0)
  expect(calls).toHaveLength(0)
})
test('push requires its input mode and explicit future projection configuration', async () => {
  expect((await ingest(pushed())).status).toBe(409)
  env.INPUT_MODE = 'push'
  env.PROJECTION_ENABLED = 'true'
  expect((await ingest(pushed())).status).toBe(503)
  const checked = await ingest(pushed(), '/check')
  expect(checked.status).toBe(200)
  expect(await checked.json()).toMatchObject({ state: 'checked', projectionEnabled: true })
  expect(calls).toHaveLength(0)
  expect(ledger()).toHaveLength(0)
})
test('273 bootstrap snapshots in push mode are exact replays; source cursors and new rows progress', async () => {
  env.INPUT_MODE = 'push'
  const sources = Array.from({ length: 11 }, (_, i) =>
    source({
      spreadsheetId: 'fictional_push_' + String(i).padStart(10, '0'),
    }),
  )
  env.SOURCES = JSON.stringify(sources)
  for (let i = 0; i < sources.length; i++) {
    const rows = Array.from({ length: i === 10 ? 23 : 25 }, (_, j) => answer('Fictif ' + j))
    await seed(sources[i], [headers, ...rows])
    expect((await (await ingest(pushed(sources[i], rows), '/check')).json()).matched).toBe(
      rows.length,
    )
    await poll(pushed(sources[i], rows))
  }
  expect(remote).toHaveLength(273)
  expect(calls).toHaveLength(0)
  const future = [
    ...Array.from({ length: 25 }, (_, j) => answer('Fictif ' + j)),
    ...Array.from({ length: 12 }, (_, j) => answer('Future ' + j)),
  ]
  for (let n = 0; n < 4; n++) await poll(pushed(sources[0], future))
  expect(remote).toHaveLength(285)
  expect(new Set(remote.map((r) => r.cle_reponse)).size).toBe(285)
})
test('push lost POST and concurrent delivery reuse the same durable lease and receipt', async () => {
  env.INPUT_MODE = 'push'
  let entered!: () => void, release!: () => void
  const blocked = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r))
  let held = false
  fault = async (_url, init) => {
    if (init.method === 'POST' && !held) {
      held = true
      remote.push({ Id: 7, ...JSON.parse(String(init.body)) })
      entered()
      await gate
      throw new Error('lost_response')
    }
  }
  const first = ingest(pushed())
  await blocked
  expect((await ingest(pushed())).status).toBe(409)
  expect((await (await ingest(pushed(), '/check')).json()).state).toBe('busy')
  release()
  await first
  clock += 120000
  fault = null
  await ingest(pushed())
  expect(writes()).toHaveLength(1)
  expect(ledger()[0].capture_state).toBe('complete')
  expect(calls.some((c) => c.url.includes('google'))).toBe(false)
})
afterEach(() => sql.close())

test.each([
  ['29/09/2026 16:05:12', '2026-09-29T14:05:12.000Z'],
  ['15/01/2026 09:03:00', '2026-01-15T08:03:00.000Z'],
  ['29/03/2026 01:59:59', '2026-03-29T00:59:59.000Z'],
  ['29/03/2026 03:00:00', '2026-03-29T01:00:00.000Z'],
  ['25/10/2026 03:00:00', '2026-10-25T02:00:00.000Z'],
  ['1/2/2026 9:03', '2026-02-01T08:03:00.000Z'],
])('converts genuine Europe/Paris source %s', (raw, expected) =>
  expect(googleTimestamp(raw)).toBe(expected),
)
test.each([
  '29/03/2026 02:30:00',
  '25/10/2026 02:30:00',
  '31/02/2026 12:00:00',
  '29/09/2026 25:00:00',
  '09/29/2026 12:00:00',
  '',
])('refuses nonexistent, ambiguous or malformed timestamp %s', (raw) =>
  expect(() => googleTimestamp(raw)).toThrow(),
)
test('RFC4180 preserves quoted newlines, duplicate headers, empty answers and BOM', () => {
  expect(parseCsv('\uFEFFA,A,B\r\n"a\nb","c""d",\r\n')).toEqual([
    ['A', 'A', 'B'],
    ['a\nb', 'c"d', ''],
  ])
  expect(answerFields(['A', 'A'], ['', '  texte  '])).toEqual([
    { column: 1, question: 'A', answer: '' },
    { column: 2, question: 'A', answer: '  texte  ' },
  ])
  expect(() => parseCsv('A\n"unclosed')).toThrow()
  expect(() => parseCsv('A\n"x"suffix')).toThrow()
})
test('disabled worker does not read credentials or D1', async () => {
  expect(await run({ ENABLED: 'false' } as Env)).toEqual({ state: 'disabled' })
  expect(calls).toHaveLength(0)
})
test('all fields durably captured and verified, unknown forms remain À rapprocher, replay does not create', async () => {
  const first = await poll()
  expect(first.state).toBe('complete')
  expect(remote).toHaveLength(1)
  expect(hooks()).toHaveLength(0)
  expect(remote[0].statut_reprise).toBe('À rapprocher')
  expect(JSON.parse(String(remote[0].reponses))).toHaveLength(headers.length)
  expect(JSON.parse(String(remote[0].reponses)).at(-1).answer).toBe('')
  expect(ledger()[0].capture_state).toBe('complete')
  await poll()
  expect(writes()).toHaveLength(1)
})
test('A -> B -> A creates three revisions rather than recycling first content key', async () => {
  await poll()
  const edited = answer()
  edited[8] = 'Réponse B'
  sheets.set(source().spreadsheetId, csv([headers, edited]))
  await poll()
  sheets.set(source().spreadsheetId, csv([headers, answer()]))
  await poll()
  expect(ledger().map((r) => r.revision)).toEqual([1, 2, 3])
  expect(new Set(remote.map((r) => r.cle_reponse)).size).toBe(3)
})
test('loss AFTER Noco commit reconciles existing row without repeated POST', async () => {
  let lost = false
  fault = (_url, init) => {
    if (init.method === 'POST' && !lost) {
      lost = true
      remote.push({ Id: 7, ...JSON.parse(String(init.body)) })
      throw new Error('lost_response')
    }
  }
  expect((await poll()).state).toBe('attention_required')
  expect(ledger()[0].capture_state).toBe('writing')
  expect(writes()).toHaveLength(1)
  clock += 120000
  fault = null
  await poll()
  expect(writes()).toHaveLength(1)
  expect(ledger()[0].noco_id).toBe(7)
})
test('uncertain write with empty lookup is never recreated, even on another invocation', async () => {
  fault = (_url, init) => {
    if (init.method === 'POST') throw new Error('timeout_before_or_after_commit')
  }
  await poll()
  clock += 120000
  fault = null
  await poll()
  expect(writes()).toHaveLength(1)
  expect(ledger()[0].last_error).toBe('write_uncertain')
  expect(ledger()[0].noco_id).toBeNull()
})
test('durable raw evidence survives source edit before failed capture retry', async () => {
  let failed = false
  fault = (_url, init) => {
    if (init.method === 'GET' && _url.startsWith('https://app.nocodb.com') && !failed) {
      failed = true
      return new Response('', { status: 503 })
    }
  }
  await poll()
  const edited = answer()
  edited[8] = 'Nouvelle version'
  sheets.set(source().spreadsheetId, csv([headers, edited]))
  clock += 120000
  fault = null
  await poll()
  expect(remote).toHaveLength(2)
  expect(remote.map((r) => r.revision).sort()).toEqual([1, 2])
  expect(JSON.parse(String(remote[0].reponses))[8].answer).toBe('Réponse A')
})
test('success response without actual persisted fields is not falsely acknowledged', async () => {
  fault = (url, init) => {
    if (init.method === 'GET' && /\/records\/1$/.test(url))
      return Response.json({ Id: 1, cle_reponse: 'wrong' })
  }
  await poll()
  expect(ledger()[0].noco_id).toBeNull()
  expect(ledger()[0].last_error).toBe('noco_receipt_mismatch')
})
test('D1 failure after Noco verified write keeps prewrite marker and next run reconciles', async () => {
  let failed = false
  storeFault = (q) => {
    if (q.startsWith('UPDATE google_transition_poller SET noco_id=') && !failed) {
      failed = true
      throw new Error('d1_failed')
    }
  }
  await poll()
  expect(ledger()[0].capture_state).toBe('writing')
  clock += 120000
  storeFault = null
  await poll()
  expect(writes()).toHaveLength(1)
  expect(ledger()[0].noco_id).toBe(1)
})
test('429 rejected POST backs off sequentially; successful retry is verified', async () => {
  let throttles = 0
  fault = (_url, init) =>
    init.method === 'POST' && throttles++ < 2
      ? new Response('', { status: 429, headers: { 'retry-after': '2' } })
      : undefined
  await poll()
  expect(remote).toHaveLength(1)
  expect(writes()).toHaveLength(3)
  expect(sleeps).toContain(2000)
  expect(sleeps).toContain(3000)
  expect(ledger()[0].capture_state).toBe('complete')
})
test('persistent 429 keeps receipt retryable with next_attempt_at and respects HTTP-date Retry-After', async () => {
  fault = (_url, init) =>
    init.method === 'POST'
      ? new Response('', {
          status: 429,
          headers: { 'retry-after': new Date(clock + 120000).toUTCString() },
        })
      : undefined
  await poll()
  expect(ledger()[0].capture_state).toBe('pending')
  expect(ledger()[0].next_attempt_at).toBeGreaterThan(clock)
  const previous = writes().length
  await poll()
  expect(writes()).toHaveLength(previous)
  clock += 180000
  fault = null
  await poll()
  expect(remote).toHaveLength(1)
})
test('projection uses actual Google timestamp, immutable payload and receipt validation', async () => {
  projection()
  await poll()
  expect(hooks()).toHaveLength(1)
  const event = JSON.parse(String(hooks()[0].init.body))
  expect(event.source.submittedAt).toBe('2026-09-29T08:00:00.000Z')
  expect(event.source.readAt).not.toBe(event.source.submittedAt)
  expect(event.sheetSnapshot.headers).toEqual(headers)
  expect(event.sheetSnapshot.values).toEqual(answer())
  expect(remote[0].statut_reprise).toBe('À rapprocher')
  expect(ledger()[0].projection_complete).toBe(1)
})
test('capture-first backlog, historical timestamps and corrections never become future projections', async () => {
  await poll()
  projection()
  await poll()
  expect(hooks()).toHaveLength(0)
  const edited = answer()
  edited[8] = 'Correction'
  sheets.set(
    source().spreadsheetId,
    csv([
      headers,
      edited,
      answer('Ancien', '28/09/2026 16:00:00'),
      answer('Nouveau', '29/09/2026 10:01:00'),
    ]),
  )
  await poll()
  expect(hooks()).toHaveLength(1)
  expect(JSON.parse(String(hooks()[0].init.body)).source.row).toBe(4)
  expect(ledger().filter((r) => r.projection_eligible === 1)).toHaveLength(1)
})
test('projection cannot be enabled without explicit timestamp and row cutover', async () => {
  env.PROJECTION_ENABLED = 'true'
  await expect(poll()).rejects.toThrow('projection_configuration_invalid')
  expect(calls).toHaveLength(0)
})
test('lost hook response resends exactly frozen payload; plan response is not acknowledged', async () => {
  projection()
  let lost = false
  fault = (url) => {
    if (url === 'https://euneos.fr/api/hook/google-forms' && !lost) {
      lost = true
      throw new Error('hook_timeout')
    }
  }
  await poll()
  const payload = hooks()[0].init.body
  clock += 120000
  fault = (url) =>
    url === 'https://euneos.fr/api/hook/google-forms'
      ? Response.json({ state: 'plan', code: 'ready' })
      : undefined
  await poll()
  expect(hooks()[1].init.body).toBe(payload)
  expect(ledger()[0].projection_complete).toBe(0)
  clock += 300000
  fault = null
  await poll()
  expect(hooks()[2].init.body).toBe(payload)
  expect(ledger()[0].projection_complete).toBe(1)
})
test('hook outcome is durable before status PATCH, so failed PATCH does not repeat hook', async () => {
  projection()
  fault = (_url, init) => (init.method === 'PATCH' ? new Response('', { status: 503 }) : undefined)
  await poll()
  expect(ledger()[0].projection_outcome).not.toBeNull()
  clock += 120000
  fault = null
  await poll()
  expect(hooks()).toHaveLength(1)
  expect(ledger()[0].projection_complete).toBe(1)
})
test('HTTP budget below 50 includes all sources, writes, verification, retries and redirects', async () => {
  const sources = Array.from({ length: 8 }, (_, i) =>
    source({
      spreadsheetId: 'fictional_sheet_' + String(i).padStart(10, '0'),
      label: 'Source ' + i,
    }),
  )
  env.SOURCES = JSON.stringify(sources)
  for (const s of sources)
    sheets.set(
      s.spreadsheetId,
      csv([headers, ...Array.from({ length: 35 }, (_, i) => answer('Collège ' + i))]),
    )
  const result = await poll()
  expect(calls.length).toBeLessThan(50)
  expect((result as { httpRequests: number }).httpRequests).toBe(calls.length)
  expect((result as { processed: number }).processed).toBeLessThanOrEqual(10)
  expect(result.state).toBe('catching_up')
  const lastSources = sql
    .query("SELECT next_source FROM google_transition_runs WHERE id='poll'")
    .get() as { next_source: number }
  expect(lastSources.next_source).toBe(1)
  calls = []
  await poll()
  expect(calls.filter((c) => c.url.startsWith('https://docs.google.com'))[0].url).toContain(
    sources[1].spreadsheetId,
  )
})
test('Google redirects counted manually and forbidden destinations never followed', async () => {
  let redirected = false
  fault = (url) => {
    if (url.startsWith('https://docs.google.com') && !redirected) {
      redirected = true
      return new Response('', {
        status: 302,
        headers: { location: 'https://download-sheets.googleusercontent.com/file' },
      })
    }
  }
  let result = await poll()
  expect((result as { httpRequests: number }).httpRequests).toBe(calls.length)
  expect(calls.some((c) => c.url.startsWith('https://download-sheets.googleusercontent.com'))).toBe(
    true,
  )
  fault = (url) =>
    url.startsWith('https://docs.google.com')
      ? new Response('', { status: 302, headers: { location: 'https://evil.invalid/collect' } })
      : undefined
  result = await poll()
  expect(result.state).toBe('attention_required')
  expect(calls.some((c) => c.url.includes('evil.invalid'))).toBe(false)
})
test('large unchanged history is scanned with bounded cursors; later edits cannot starve', async () => {
  sheets.set(
    source().spreadsheetId,
    csv([headers, ...Array.from({ length: 150 }, (_, i) => answer('Collège ' + i))]),
  )
  for (let n = 0; n < 34; n++) await poll()
  expect(remote).toHaveLength(150)
  const initial = writes().length
  const result = await poll()
  expect((result as { inspected: number }).inspected).toBeLessThanOrEqual(100)
  expect(writes()).toHaveLength(initial)
  const rows = [headers, ...Array.from({ length: 150 }, (_, i) => answer('Collège ' + i))]
  rows[150][8] = 'Changed last row'
  sheets.set(source().spreadsheetId, csv(rows))
  for (let n = 0; n < 3; n++) await poll()
  expect(remote).toHaveLength(151)
})
test('overlapping invocations do not create duplicates; stale invocation cannot release new owner', async () => {
  let entered!: () => void, release!: () => void
  const blocked = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r))
  let held = false
  fault = async (url) => {
    if (url.startsWith('https://docs.google.com') && !held) {
      held = true
      entered()
      await gate
    }
    return undefined
  }
  const first = poll()
  await blocked
  expect(await poll()).toEqual({ state: 'busy' })
  release()
  await first
  expect(writes()).toHaveLength(1)
  fault = (url) => {
    if (url.startsWith('https://docs.google.com'))
      sql
        .query("UPDATE google_transition_runs SET owner='replacement',expires_at=? WHERE id='poll'")
        .run(clock + 999999)
    return undefined
  }
  sheets.set(source().spreadsheetId, csv([headers, answer('Updated')]))
  await poll()
  const lease = sql
    .query("SELECT owner,expires_at FROM google_transition_runs WHERE id='poll'")
    .get() as { owner: string; expires_at: number }
  expect(lease.owner).toBe('replacement')
  expect(lease.expires_at).toBeGreaterThan(clock)
  expect(writes()).toHaveLength(1)
})
test('invalid complete CSV is rejected before any source receipt or remote mutation', async () => {
  sheets.set(source().spreadsheetId, csv([headers, answer(), ['truncated', 'row']]))
  expect((await poll()).state).toBe('attention_required')
  expect(ledger()).toHaveLength(0)
  expect(writes()).toHaveLength(0)
})
test('run/status endpoint hides state from unauthenticated callers and handles absent status', async () => {
  expect((await worker.fetch(new Request('https://worker.invalid'), env)).status).toBe(404)
  const res = await worker.fetch(
    new Request('https://worker.invalid', {
      headers: { authorization: 'Bearer ' + env.RUN_SECRET },
    }),
    env,
  )
  expect(await res.json()).toEqual({ enabled: true, projectionEnabled: false, last: null })
})
test('source allowlist refuses duplicates, unknown business kinds and invalid cutoff', () => {
  expect(() => validateSources(JSON.stringify([source(), source()]))).toThrow('source_duplicate')
  expect(() =>
    validateSources(JSON.stringify([source({ kind: 'generic' as Source['kind'] })])),
  ).toThrow('source_invalid')
  expect(() => validateSources(JSON.stringify([source({ projectionFirstRow: 1 })]))).toThrow(
    'source_invalid',
  )
})

test('48-request ceiling still holds with repeated 429 and Google redirects', async () => {
  sheets.set(
    source().spreadsheetId,
    csv([headers, ...Array.from({ length: 20 }, (_, i) => answer('Collège ' + i))]),
  )
  const throttled = new Map<string, number>()
  fault = (url, init) => {
    if (url.startsWith('https://docs.google.com'))
      return new Response('', {
        status: 302,
        headers: { location: 'https://download-sheets.googleusercontent.com/file' },
      })
    if (
      url.startsWith('https://app.nocodb.com') &&
      (init.method ?? 'GET') === 'GET' &&
      url.includes('?where=')
    ) {
      const count = throttled.get(url) ?? 0
      throttled.set(url, count + 1)
      if (count < 2) return new Response('', { status: 429, headers: { 'retry-after': '1' } })
    }
    return undefined
  }
  const result = await poll()
  expect(result.state).toBe('catching_up')
  expect(calls.length).toBeLessThan(50)
  expect((result as { httpRequests: number }).httpRequests).toBe(calls.length)
  expect((result as { processed: number }).processed).toBeLessThanOrEqual(10)
})
test('pending queue also obeys ten-row cap independently of fresh snapshot scanning', async () => {
  const rows = [headers, ...Array.from({ length: 21 }, (_, i) => answer('Collège ' + i))]
  sheets.set(source().spreadsheetId, csv(rows))
  fault = (url) =>
    url.startsWith('https://app.nocodb.com') ? new Response('', { status: 503 }) : undefined
  await poll()
  await poll()
  await poll()
  expect(ledger()).toHaveLength(21)
  clock += 120000
  fault = null
  const result = await poll()
  expect((result as { processed: number }).processed).toBeGreaterThan(0)
  expect((result as { processed: number }).processed).toBeLessThanOrEqual(10)
  expect(remote).toHaveLength((result as { processed: number }).processed)
  for (let n = 0; n < 4; n++) await poll()
  expect(remote).toHaveLength(21)
  expect(new Set(remote.map((r) => r.cle_reponse)).size).toBe(21)
})

test('273 seeded receipts across 11 sources stay bounded and edits/new rows cannot starve', async () => {
  const sources = Array.from({ length: 11 }, (_, i) =>
    source({
      spreadsheetId: 'fictional_seed_' + String(i).padStart(10, '0'),
      label: 'Source fictive ' + i,
    }),
  )
  env.SOURCES = JSON.stringify(sources)
  const snapshots = sources.map((_, i) => [
    headers,
    ...Array.from({ length: i === 10 ? 23 : 25 }, (_, j) => answer('Collège fictif ' + j)),
  ])
  for (let i = 0; i < sources.length; i++) await seed(sources[i], snapshots[i])
  expect(ledger()).toHaveLength(273)
  for (let n = 0; n < 3; n++) await poll()
  expect(writes()).toHaveLength(0)
  for (const s of sources) expect(calls.some((c) => c.url.includes(s.spreadsheetId))).toBe(true)
  // At most one read of the receipt window per source, not per row.
  for (const queries of queryRuns) {
    expect(queries.length).toBeLessThanOrEqual(24)
    expect(queries.filter((q) => q.startsWith('SELECT p.*')).length).toBeLessThanOrEqual(5)
  }
  snapshots[0][25][8] = 'Correction historique'
  snapshots[10].push(answer('Nouvelle réponse fictive'))
  sheets.set(sources[0].spreadsheetId, csv(snapshots[0]))
  sheets.set(sources[10].spreadsheetId, csv(snapshots[10]))
  for (let n = 0; n < 4; n++) await poll()
  expect(writes()).toHaveLength(2)
  expect(ledger()).toHaveLength(275)
  expect(ledger().filter((r) => r.revision === 2)).toHaveLength(1)
  const last = sql
    .query("SELECT last_result,expires_at FROM google_transition_runs WHERE id='poll'")
    .get() as { last_result: string; expires_at: number }
  expect(last.expires_at).toBe(0)
  expect(JSON.parse(last.last_result).d1Queries).toBe(queryRuns.at(-1)!.length)
})

test('failed pending queue leaves SQL capacity for a newly arrived source', async () => {
  sheets.set(
    source().spreadsheetId,
    csv([headers, ...Array.from({ length: 21 }, (_, i) => answer('Attente ' + i))]),
  )
  fault = (url) =>
    url.startsWith('https://app.nocodb.com') ? new Response('', { status: 503 }) : undefined
  for (let n = 0; n < 3; n++) await poll()
  const pendingKeys = new Set(ledger().map((r) => r.response_key))
  expect(pendingKeys.size).toBe(21)
  const fresh = source({ spreadsheetId: 'fictional_fresh_sheet_00001' })
  env.SOURCES = JSON.stringify([source(), fresh])
  sheets.set(fresh.spreadsheetId, csv([headers, answer('Nouveau formulaire')]))
  clock += 120000
  fault = (url) =>
    [...pendingKeys].some((key) => url.includes(String(key)))
      ? new Response('', { status: 503 })
      : undefined
  for (let n = 0; n < 2; n++) await poll()
  expect(remote).toHaveLength(1)
  expect(ledger().filter((r) => r.noco_id)).toHaveLength(1)
  expect(ledger().find((r) => r.noco_id)?.source_key).toBe(`${fresh.spreadsheetId}:0`)
})

test('projection, failed SQL and 429 rollback fit D1 budget including final release', async () => {
  projection()
  sheets.set(
    source().spreadsheetId,
    csv([headers, ...Array.from({ length: 12 }, (_, i) => answer('Projection fictive ' + i))]),
  )
  let failed = false
  storeFault = (query) => {
    if (!failed && query.startsWith('UPDATE google_transition_poller SET noco_id=')) {
      failed = true
      throw new Error('d1_transient')
    }
  }
  await poll()
  expect(failed).toBe(true)
  // These are SQL failures too, and the independent counter includes them.
  expect(ledger().some((r) => r.last_error === 'd1_transient')).toBe(true)
  clock += 120000
  storeFault = null
  fault = (_url, init) =>
    init.method === 'POST'
      ? new Response('', { status: 429, headers: { 'retry-after': '60' } })
      : undefined
  await poll()
  expect(ledger().some((r) => r.capture_state === 'pending' && r.last_error === 'noco_429')).toBe(
    true,
  )
  const lease = sql
    .query("SELECT expires_at FROM google_transition_runs WHERE id='poll'")
    .get() as { expires_at: number }
  expect(lease.expires_at).toBe(0)
})

async function futurePush(kind: 'contact' | 'deploiement' = 'contact') {
  const f = await futureSheet(kind)
  projection()
  env.INPUT_MODE = 'push'
  const s = source({
    kind,
    eventVersion: 2,
    cohortId: 2,
    projectionFirstRow: 2,
    mapping: f.mapping,
    policy: f.policy,
  })
  env.SOURCES = JSON.stringify([s])
  return {
    f,
    s,
    snapshot: {
      version: 1,
      source: { spreadsheetId: s.spreadsheetId, sheetId: s.sheetId },
      headers: f.headers,
      rows: [f.values],
    } as PushSnapshot,
  }
}
test('authenticated v2 push projects only new rows, keeps raw status À rapprocher on partial declaration', async () => {
  const { snapshot } = await futurePush()
  fault = (url, init) => {
    if (url !== 'https://euneos.fr/api/hook/google-forms') return
    expect((init.headers as Record<string, string>)['x-google-forms-secret']).toBe(
      env.GOOGLE_FORMS_SYNC_SECRET!,
    )
    const payload = JSON.parse(String(init.body))
    expect(payload.version).toBe(2)
    expect(payload.formation.start).toBe('')
    expect(payload.source.submittedAt).toBe('2026-09-29T08:00:00.000Z')
    return Response.json({
      state: 'complete',
      code: 'saved_raw_remaining',
      receipt: 'a'.repeat(64),
    })
  }
  expect((await ingest(snapshot)).status).toBe(200)
  await poll(snapshot)
  expect(hooks()).toHaveLength(1)
  expect(ledger()[0].projection_complete).toBe(1)
  expect(remote[0].statut_reprise).toBe('À rapprocher')
  expect(remote[0].detail_reprise).toContain('saved_raw_remaining')
  expect(calls.every((c) => !new URL(c.url).hostname.includes('google'))).toBe(true)
})
test('v2 push cutover never promotes bootstrapped stock, edited stock, capture-disabled discoveries or old timestamps', async () => {
  const { s, snapshot } = await futurePush()
  const oldRows = Array.from({ length: 273 }, () => [...snapshot.rows[0]])
  await seed(s, [snapshot.headers, ...oldRows])
  s.projectionFirstRow = 275
  env.SOURCES = JSON.stringify([s])
  snapshot.rows = oldRows
  snapshot.rows[0][1] = 'Historique corrigé'
  const historical = [...oldRows[1]]
  historical[0] = '28/09/2026 10:00:00'
  snapshot.rows.push(historical, ['29/09/2026 10:01:00', ...oldRows[1].slice(1)])
  for (let i = 0; i < 6; i++) await poll(snapshot)
  expect(hooks()).toHaveLength(1)
  expect(JSON.parse(String(hooks()[0].init.body)).source.row).toBe(276)
  expect(ledger().filter((r) => r.projection_eligible === 1)).toHaveLength(1)
  env.PROJECTION_ENABLED = 'false'
  snapshot.rows.push(['29/09/2026 10:02:00', ...oldRows[1].slice(1)])
  for (let i = 0; i < 4; i++) await poll(snapshot)
  env.PROJECTION_ENABLED = 'true'
  for (let i = 0; i < 4; i++) await poll(snapshot)
  expect(hooks()).toHaveLength(1)
})
for (const scenario of ['edited', 'deleted', 'header drift', 'later cutover', 'later first row']) {
  test(`pending v2 snapshot evidence is rechecked before hook retry: ${scenario}`, async () => {
    const { s, snapshot } = await futurePush()
    fault = (url) =>
      url === 'https://euneos.fr/api/hook/google-forms'
        ? new Response('', { status: 503 })
        : undefined
    await poll(snapshot)
    expect(hooks()).toHaveLength(1)
    if (scenario === 'edited') snapshot.rows[0][12] = 'Oui'
    if (scenario === 'deleted') snapshot.rows = []
    if (scenario === 'header drift') snapshot.headers[14] = 'Question modifiée'
    if (scenario === 'later cutover') env.PROJECTION_START_AT = '2026-09-29T09:00:00Z'
    if (scenario === 'later first row') {
      s.projectionFirstRow = 3
      env.SOURCES = JSON.stringify([s])
    }
    clock += 120000
    fault = null
    await poll(snapshot)
    expect(hooks()).toHaveLength(1)
    expect(ledger()[0].projection_complete).toBe(1)
    expect(JSON.parse(String(ledger()[0].projection_outcome)).state).toBe('review')
    expect(remote[0].statut_reprise).toBe('À rapprocher')
  })
}
test('v2 failed outcome persistence retries the identical request, but disabled projection stops hooks', async () => {
  const { snapshot } = await futurePush('deploiement')
  let failed = false
  storeFault = (query) => {
    if (query.startsWith('UPDATE google_transition_poller SET projection_outcome=') && !failed) {
      failed = true
      throw new Error('storage_unavailable')
    }
  }
  await poll(snapshot)
  const body = hooks()[0].init.body
  expect(ledger()[0].projection_outcome).toBeNull()
  env.PROJECTION_ENABLED = 'false'
  clock += 120000
  storeFault = null
  await poll(snapshot)
  expect(hooks()).toHaveLength(1)
  env.PROJECTION_ENABLED = 'true'
  await poll(snapshot)
  expect(hooks()).toHaveLength(2)
  expect(hooks()[1].init.body).toBe(body)
})
test('v2 unapproved headers or populated retired field stays captured and reviewed, no hook on header drift', async () => {
  const { snapshot } = await futurePush()
  snapshot.headers.push('New question')
  snapshot.rows[0].push('New answer')
  await poll(snapshot)
  expect(hooks()).toHaveLength(0)
  expect(remote[0].statut_reprise).toBe('À rapprocher')
  expect(remote[0].detail_reprise).toContain('sheet_headers_changed')
  expect(JSON.parse(String(remote[0].reponses)).at(-1).answer).toBe('New answer')
})
test('push projection validates all configured business sources, not just the currently posted one', async () => {
  const { s, snapshot } = await futurePush()
  env.SOURCES = JSON.stringify([
    s,
    source({ spreadsheetId: 'fictional_other_sheet_00002', kind: 'deploiement' }),
  ])
  await expect(poll(snapshot)).rejects.toThrow('projection_configuration_invalid')
  expect(calls).toHaveLength(0)
})

test('a changed private mapping cannot alter or resend a previously frozen v2 event', async () => {
  const { s, snapshot } = await futurePush()
  fault = (url) =>
    url === 'https://euneos.fr/api/hook/google-forms'
      ? new Response('', { status: 503 })
      : undefined
  await poll(snapshot)
  const payload = ledger()[0].projection_payload
  s.mapping!.contactName = 'Établissement'
  env.SOURCES = JSON.stringify([s])
  fault = null
  clock += 120000
  await poll(snapshot)
  expect(hooks()).toHaveLength(1)
  expect(ledger()[0].projection_payload).toBe(payload)
  expect(remote[0].detail_reprise).toContain('projection_configuration_changed')
  expect(remote[0].statut_reprise).toBe('À rapprocher')
})
test('projection flag with a capture-only catalogue cannot claim configured projection', async () => {
  const { snapshot } = await futurePush()
  env.SOURCES = JSON.stringify([source()])
  await expect(poll(snapshot)).rejects.toThrow('projection_configuration_invalid')
  expect(calls).toHaveLength(0)
})

test('private source catalogue spans complete secret arrays without changing order or identity guards', () => {
  const s1 = source(),
    s2 = source({ spreadsheetId: 'fictional_sheet_id_00002' }),
    s3 = source({ spreadsheetId: 'fictional_sheet_id_00003' })
  const config = {
    SOURCES: JSON.stringify([s1]),
    SOURCES_2: JSON.stringify([s2]),
    SOURCES_3: JSON.stringify([s3]),
  }
  expect(configuredSources(config)).toEqual([s1, s2, s3])
  expect(configuredSources({ SOURCES: config.SOURCES })).toEqual([s1])
  expect(() => configuredSources({ ...config, SOURCES_2: undefined })).toThrow(
    'sources_part_missing',
  )
  expect(() => configuredSources({ ...config, SOURCES: '' })).toThrow('sources_part_missing')
  expect(() => configuredSources({ ...config, SOURCES_2: config.SOURCES })).toThrow(
    'source_duplicate',
  )
  expect(() => configuredSources({ ...config, SOURCES_2: '{}' })).toThrow('sources_invalid')
})

test('authenticated push accepts a source from the second private part and still journals idempotently', async () => {
  env.INPUT_MODE = 'push'
  const second = source({ spreadsheetId: 'fictional_sheet_id_00002' })
  env.SOURCES_2 = JSON.stringify([second])
  const snapshot: PushSnapshot = {
    version: 1,
    source: { spreadsheetId: second.spreadsheetId, sheetId: 0 },
    headers,
    rows: [answer()],
  }
  await run(
    env,
    {
      fetch: fakeFetch,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    },
    snapshot,
  )
  await run(
    env,
    {
      fetch: fakeFetch,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    },
    snapshot,
  )
  expect(remote).toHaveLength(1)
  expect(ledger()).toHaveLength(1)
  expect(calls.filter((c) => c.url === 'https://euneos.fr/api/hook/google-forms')).toHaveLength(0)
})

test('sorting forty historical responses and inserting above the cutoff keeps their receipt identities', async () => {
  env.INPUT_MODE = 'push'
  const rows = Array.from({ length: 40 }, (_, i) =>
    answer(`Réponse ${i}`, `29/09/2026 10:${String(i).padStart(2, '0')}:00`),
  )
  await seed(source(), [headers, ...rows])
  const before = JSON.stringify(ledger())
  for (let i = 0; i < 4; i++) await poll(pushed(source(), [...rows].reverse()))
  expect(JSON.stringify(ledger())).toBe(before)
  expect(writes()).toHaveLength(0)
  const checked = await (await ingest(pushed(source(), [...rows].reverse()), '/check')).json()
  expect(checked).toMatchObject({ matched: 40, fresh: 0, changed: 0, missing: 0 })
  await poll(pushed(source(), [answer('Insertion', '01/10/2026 12:00:00'), ...rows].reverse()))
  expect(writes()).toHaveLength(1)
  expect(ledger()).toHaveLength(41)
})

test('legacy sort-created revisions stay preserved but are not counted as new responses', async () => {
  env.INPUT_MODE = 'push'
  const rows = Array.from({ length: 40 }, (_, i) =>
    answer(`Réponse ${i}`, `29/09/2026 10:${String(i).padStart(2, '0')}:00`),
  )
  await seed(source(), [headers, ...rows])
  for (let i = 0; i < 4; i++) {
    const cells = rows[39 - i],
      fingerprint = await digest(JSON.stringify(answerFields(headers, cells)))
    const responseKey = await digest(JSON.stringify(['legacy-sort', i, fingerprint]))
    const raw = JSON.stringify({
      headers,
      cells,
      label: source().label,
      timestamp: cells[0],
      readAt: new Date(clock).toISOString(),
    })
    sql
      .query(
        `INSERT INTO google_transition_poller(response_key,source_key,source_row,fingerprint,revision,raw_payload,capture_state,noco_id,updated_at) VALUES(?,?,?,?,2,?,'complete',?,?)`,
      )
      .run(
        responseKey,
        `${source().spreadsheetId}:0`,
        i + 2,
        fingerprint,
        raw,
        100 + i,
        new Date(clock).toISOString(),
      )
  }
  const before = JSON.stringify(ledger())
  for (let i = 0; i < 4; i++) await poll(pushed(source(), [...rows].reverse()))
  expect(JSON.stringify(ledger())).toBe(before)
  expect(writes()).toHaveLength(0)
  expect(
    (await (await ingest(pushed(source(), [...rows].reverse()), '/check')).json()).matched,
  ).toBe(40)
  const edited = [...rows[0]]
  edited[9] = 'Vraie édition après tri'
  await poll(pushed(source(), [...rows.slice(1).reverse(), edited]))
  expect(
    ledger()
      .filter((r) => r.source_row === 2)
      .map((r) => r.revision),
  ).toEqual([1, 2, 3])
  expect(writes()).toHaveLength(1)
})

test('identical multiple responses are a multiset, not one content hash; ambiguous collision never projects', async () => {
  const { s, snapshot } = await futurePush()
  await seed(s, [snapshot.headers, [...snapshot.rows[0]], [...snapshot.rows[0]]])
  s.projectionFirstRow = 4
  env.SOURCES = JSON.stringify([s])
  snapshot.rows = [...snapshot.rows, [...snapshot.rows[0]], [...snapshot.rows[0]]]
  for (let i = 0; i < 4; i++) await poll(snapshot)
  expect(ledger()).toHaveLength(3)
  expect(writes()).toHaveLength(1)
  expect(hooks()).toHaveLength(0)
  expect(remote.at(-1)?.statut_reprise).toBe('À rapprocher')
  expect(remote.at(-1)?.detail_reprise).toContain('identity_ambiguous')
})

async function personFixture(family: 'preformation_a' | 'accord_formateur' = 'preformation_a') {
  const h = [
    'Horodateur',
    'Email',
    'Nom complet',
    'Année',
    ...(family === 'preformation_a' ? ['École'] : ['Accord', 'Date accord']),
  ]
  const cells = [
    '30/09/2026 00:15:00',
    'alex@example.invalid',
    'Exemple Alex',
    '2026–2027',
    ...(family === 'preformation_a' ? ['École fictive'] : ['Oui, accord confirmé', '29/09/2026']),
  ]
  const peopleTable = 'fictionalpeople00001',
    recordsTable = 'fictionalrecords0001'
  const person = {
    Id: 50,
    prenom: 'Alex',
    nom: 'Exemple',
    email: 'alex@example.invalid',
    email_2: null,
    participations_id: 7,
    date_pre_recu: null as string | null,
    statut: 'Inchangé',
  }
  const record =
    family === 'preformation_a'
      ? { Id: 7, cohortes_id: 2, etablissements_id: 9, fusionne_vers: null }
      : {
          Id: 7,
          cohortes_id: 2,
          formateurs_id: 50,
          fusionne_vers: null,
          accord_signe: false,
          date_accord: null,
          statut: 'À qualifier',
        }
  const config: NonNullable<Source['personProjection']> = {
    family,
    headerDigest: await digest(JSON.stringify(h)),
    mapping: {
      timestamp: 'Horodateur',
      email: 'Email',
      name: 'Nom complet',
      cohort: 'Année',
      ...(family === 'preformation_a'
        ? { establishment: 'École' }
        : { agreement: 'Accord', agreementDate: 'Date accord' }),
    },
    captureOnly: [],
    tables: { people: peopleTable, records: recordsTable },
    cohorts: [
      {
        id: 2,
        answer: '2026–2027',
        ...(family === 'preformation_a'
          ? { establishments: [{ answer: 'École fictive', participationId: 7, schoolId: 9 }] }
          : {}),
      },
    ],
    ...(family === 'accord_formateur' ? { agreementAnswer: 'Oui, accord confirmé' } : {}),
  }
  const s = source({ personProjection: config, projectionFirstRow: 2 })
  env.INPUT_MODE = 'push'
  env.PROJECTION_ENABLED = 'true'
  env.PROJECTION_START_AT = '2026-09-29T06:00:00Z'
  env.SOURCES = JSON.stringify([s])
  const baseFault = (url: string, init: RequestInit) => {
    const table = new URL(url).pathname.split('/')[4]
    if (![peopleTable, recordsTable].includes(table)) return
    expect(new URL(url).origin).toBe('https://app.nocodb.com')
    const row = table === peopleTable ? person : record
    if (init.method === 'PATCH') {
      Object.assign(row, JSON.parse(String(init.body)))
      return Response.json(row)
    }
    expect(init.method).toBe('GET') // business creates, mail, arbitrary tools fail
    return /\/records\/\d+$/.test(url)
      ? Response.json(row)
      : Response.json({ list: [row], pageInfo: { isLastPage: true } })
  }
  fault = baseFault
  return {
    s,
    config,
    person,
    record,
    baseFault,
    peopleTable,
    recordsTable,
    snapshot: {
      version: 1,
      source: { spreadsheetId: s.spreadsheetId, sheetId: 0 },
      headers: h,
      rows: [cells],
    } as PushSnapshot,
  }
}
const businessPatches = () =>
  calls.filter((c) => c.init.method === 'PATCH' && /fictional(people|records)/.test(c.url))
for (const family of ['preformation_a', 'accord_formateur'] as const) {
  test(`future ${family}: capture, unique exact identity/cohort, verified minimal patch, replay and journal proof`, async () => {
    const f = await personFixture(family)
    for (let i = 0; i < 3; i++) await poll(f.snapshot)
    expect(businessPatches()).toHaveLength(1)
    if (family === 'preformation_a') {
      expect(f.person.date_pre_recu).toBe('2026-09-30')
      expect(f.person.statut).toBe('Inchangé')
    } else {
      expect(f.record).toMatchObject({
        accord_signe: true,
        date_accord: '2026-09-29',
        statut: 'À qualifier',
      })
    }
    expect(remote[0].statut_reprise).toBe('Repris dans le dossier')
    expect(String(remote[0].detail_reprise)).toContain('"state":"integrated"')
    expect(String(remote[0].detail_reprise)).toContain('"targets":[{')
    expect(hooks()).toHaveLength(0)
  })
  test(`future ${family}: lost write response is reconciled, never patched twice`, async () => {
    const f = await personFixture(family)
    let once = true
    fault = (url, init) => {
      const res = f.baseFault(url, init)
      if (once && init.method === 'PATCH' && /fictional(people|records)/.test(url)) {
        once = false
        throw new Error('network_lost')
      }
      return res
    }
    await poll(f.snapshot)
    clock += 120000
    for (let i = 0; i < 3; i++) await poll(f.snapshot)
    expect(businessPatches()).toHaveLength(1)
    expect(remote[0].statut_reprise).toBe('Repris dans le dossier')
  })
}

for (const conflict of [
  'duplicate',
  'name',
  'cohort',
  'date',
  'school',
  'unknown-school',
  'unmapped',
  'changed-headers',
  'missing-person',
  'year-typo',
] as const) {
  test(`preformation blocks ${conflict}, keeps raw evidence and explicit pending status`, async () => {
    const f = await personFixture()
    if (conflict === 'duplicate')
      fault = (url, init) =>
        url.includes('fictionalpeople') && url.includes('?')
          ? Response.json({
              list: [f.person, { ...f.person, Id: 51 }],
              pageInfo: { isLastPage: true },
            })
          : f.baseFault(url, init)
    if (conflict === 'name') f.snapshot.rows[0][2] = 'Autre personne'
    if (conflict === 'cohort') f.record.cohortes_id = 1
    if (conflict === 'date') f.person.date_pre_recu = '2026-09-12' as never
    if (conflict === 'school') f.record.etablissements_id = 10
    if (conflict === 'unknown-school') f.snapshot.rows[0][4] = 'École inconnue'
    if (conflict === 'year-typo') f.snapshot.rows[0][3] = '2006–2007'
    if (conflict === 'unmapped' || conflict === 'changed-headers') {
      f.snapshot.headers.push('Nouvelle question')
      f.snapshot.rows[0].push('Réponse')
      if (conflict === 'unmapped')
        f.config.headerDigest = await digest(JSON.stringify(f.snapshot.headers))
    }
    if (conflict === 'missing-person')
      fault = (url, init) =>
        url.includes('fictionalpeople') && url.includes('?')
          ? Response.json({ list: [], pageInfo: { isLastPage: true } })
          : f.baseFault(url, init)
    env.SOURCES = JSON.stringify([f.s])
    for (let i = 0; i < 3; i++) await poll(f.snapshot)
    expect(businessPatches()).toHaveLength(0)
    expect(writes()).toHaveLength(1)
    expect(remote[0].statut_reprise).toBe('À rapprocher')
    expect(String(remote[0].detail_reprise)).toContain('"state":"pending"')
  })
}

test('combined stored name is compared whole without splitting or rewriting; capture-only answers stay explicit partial', async () => {
  const f = await personFixture()
  f.person.prenom = ''
  f.person.nom = 'Exemple Alex'
  f.snapshot.headers.push('Question pédagogique')
  f.snapshot.rows[0].push('Réponse privée fictive')
  f.config.captureOnly.push('Question pédagogique')
  f.config.headerDigest = await digest(JSON.stringify(f.snapshot.headers))
  env.SOURCES = JSON.stringify([f.s])
  for (let i = 0; i < 3; i++) await poll(f.snapshot)
  expect(businessPatches()).toHaveLength(1)
  expect(f.person.prenom).toBe('')
  expect(f.person.nom).toBe('Exemple Alex')
  expect(String(remote[0].detail_reprise)).toContain('"state":"partial"')
  expect(remote[0].statut_reprise).toBe('À rapprocher')
})

test('uncertain write without persisted result remains reviewable and is never blindly retried', async () => {
  const f = await personFixture()
  fault = (url, init) => {
    if (init.method === 'PATCH' && /fictional(people|records)/.test(url))
      throw new Error('network_lost')
    return f.baseFault(url, init)
  }
  await poll(f.snapshot)
  clock += 120000
  for (let i = 0; i < 3; i++) await poll(f.snapshot)
  expect(businessPatches()).toHaveLength(1)
  expect(String(remote[0].detail_reprise)).toContain('business_write_uncertain')
  expect(f.person.date_pre_recu).toBeNull()
})

test('agreement without an explicit affirmative answer, conflicting date or wrong cohort never alters a journey', async () => {
  for (const variation of ['no', 'date', 'cohort']) {
    // Same source, distinct timestamps; all three must remain raw.
    const f = await personFixture('accord_formateur')
    f.snapshot.rows[0][0] = `30/09/2026 00:${variation === 'no' ? '16' : variation === 'date' ? '17' : '18'}:00`
    if (variation === 'no') f.snapshot.rows[0][4] = 'Non'
    if (variation === 'date') f.record.date_accord = '2026-01-01' as never
    if (variation === 'cohort') f.record.cohortes_id = 1
    for (let i = 0; i < 3; i++) await poll(f.snapshot)
  }
  expect(businessPatches()).toHaveLength(0)
  expect(remote.every((r) => r.statut_reprise === 'À rapprocher')).toBe(true)
})

test('explicit cohort aliases accept real declared spellings without guessing an invalid year', async () => {
  const f = await personFixture()
  f.config.cohorts[0].answers = ['2026-2027', '2026 2027']
  f.snapshot.rows[0][3] = '2026 2027'
  env.SOURCES = JSON.stringify([f.s])
  for (let i = 0; i < 3; i++) await poll(f.snapshot)
  expect(f.person.date_pre_recu).toBe('2026-09-30')
  f.config.cohorts.push({
    id: 3,
    answer: '2026 2027',
    establishments: [{ answer: 'École fictive', participationId: 8, schoolId: 9 }],
  })
  expect(() => validateSources(JSON.stringify([f.s]))).toThrow('person_configuration_invalid')
})

test('nullable trainer scope only selects one non-merged journey, never invents a cohort', async () => {
  const f = await personFixture('accord_formateur')
  delete f.config.mapping.cohort
  f.config.captureOnly = ['Année']
  f.config.fixedCohort = null
  f.config.cohorts = [{ id: null }]
  f.record.cohortes_id = null as never
  env.SOURCES = JSON.stringify([f.s])
  for (let i = 0; i < 3; i++) await poll(f.snapshot)
  expect(f.record).toMatchObject({ accord_signe: true, cohortes_id: null })
  expect(businessPatches()).toHaveLength(1)
  expect(JSON.parse(String(businessPatches()[0].init.body))).not.toHaveProperty('cohortes_id')
})

test('nullable scope with a second active journey refuses to select only the null one', async () => {
  const f = await personFixture('accord_formateur')
  delete f.config.mapping.cohort
  f.config.captureOnly = ['Année']
  f.config.fixedCohort = null
  f.config.cohorts = [{ id: null }]
  f.record.cohortes_id = null as never
  fault = (url, init) =>
    url.includes('fictionalrecords') && url.includes('?')
      ? Response.json({
          list: [f.record, { ...f.record, Id: 8, cohortes_id: 2 }],
          pageInfo: { isLastPage: true },
        })
      : f.baseFault(url, init)
  env.SOURCES = JSON.stringify([f.s])
  for (let i = 0; i < 3; i++) await poll(f.snapshot)
  expect(businessPatches()).toHaveLength(0)
  expect(String(remote[0].detail_reprise)).toContain('identity_not_unique')
})

async function createPersonFixture() {
  const f = await personFixture()
  f.config.createMissingAdults = true
  env.SOURCES = JSON.stringify([f.s])
  let created: Record<string, unknown> | null = null
  const creationFault = (url: string, init: RequestInit) => {
    if (url.includes('fictionalpeople')) {
      if (init.method === 'POST') {
        expect(created).toBeNull()
        created = { Id: 51, ...JSON.parse(String(init.body)), prenom: null }
        return Response.json(created)
      }
      expect(init.method).toBe('GET')
      return url.includes('?')
        ? Response.json({ list: created ? [created] : [], pageInfo: { isLastPage: true } })
        : Response.json(created)
    }
    return f.baseFault(url, init)
  }
  fault = creationFault
  return { ...f, creationFault, created: () => created }
}
const personCreates = () =>
  calls.filter((c) => c.url.includes('fictionalpeople') && c.init.method === 'POST')
for (const lost of [false, true])
  test(`missing adult creates once, preserves full name and deterministic code; lost response=${lost}`, async () => {
    const f = await createPersonFixture()
    let once = lost
    fault = (url, init) => {
      const res = f.creationFault(url, init)
      if (once && url.includes('fictionalpeople') && init.method === 'POST') {
        once = false
        throw new Error('lost_create_response')
      }
      return res
    }
    await poll(f.snapshot)
    clock += 120000
    for (let i = 0; i < 4; i++) await poll(f.snapshot)
    expect(personCreates()).toHaveLength(1)
    expect(f.created()).toMatchObject({
      nom: 'Exemple Alex',
      prenom: null,
      email: 'alex@example.invalid',
      participations_id: 7,
      date_pre_recu: '2026-09-30',
      adulte_id: 'AD-G-' + (await digest('7:alex@example.invalid')).slice(0, 12),
    })
    expect(f.created()).not.toHaveProperty('statut')
    expect(remote[0].statut_reprise).toBe('Repris dans le dossier')
    expect(String(remote[0].detail_reprise)).toContain('"id":51')
    expect(sql.query('SELECT * FROM google_transition_person_claims').all()).toHaveLength(1)
  })

test('uncertain adult creation blocks a second response for the same email/dossier even when searches are empty', async () => {
  const f = await createPersonFixture()
  fault = (url, init) => {
    if (url.includes('fictionalpeople') && init.method === 'POST')
      throw new Error('lost_create_response')
    return f.creationFault(url, init)
  }
  await poll(f.snapshot)
  clock += 120000
  f.snapshot.rows.push(['30/09/2026 00:16:00', ...f.snapshot.rows[0].slice(1)])
  for (let i = 0; i < 5; i++) await poll(f.snapshot)
  expect(personCreates()).toHaveLength(1)
  expect(f.created()).toBeNull()
  expect(remote).toHaveLength(2)
  expect(remote.every((r) => r.statut_reprise === 'À rapprocher')).toBe(true)
  expect(
    remote.some((r) => String(r.detail_reprise).includes('person_creation_already_claimed')),
  ).toBe(true)
})

for (const family of [
  'postformation_b',
  'suivi_j45',
  'evaluation_formation',
  'candidature_formateur',
  'bilan_formateur',
  'candidature_etablissement',
  'bilan_etablissement',
  'activites_jeunes',
] as const) {
  test(`${family} attaches exact identity/cohort in receipt, with no business field or status update`, async () => {
    const school = family.includes('etablissement') || family === 'activites_jeunes'
    const trainer = family.includes('formateur')
    const f = await personFixture(trainer ? 'accord_formateur' : 'preformation_a')
    f.config.family = family
    if (trainer) {
      delete f.config.mapping.agreement
      delete f.config.mapping.agreementDate
      f.config.captureOnly = ['Accord', 'Date accord']
    }
    if (school) {
      Object.assign(f.person, { nom: 'École fictive', referent_email: 'alex@example.invalid' })
      f.snapshot.rows[0][2] = 'École fictive'
      f.record.etablissements_id = 50
      delete f.config.mapping.establishment
      f.config.captureOnly = ['École']
    }
    env.SOURCES = JSON.stringify([f.s])
    for (let i = 0; i < 3; i++) await poll(f.snapshot)
    expect(businessPatches()).toHaveLength(0)
    expect(personCreates()).toHaveLength(0)
    expect(remote[0].statut_reprise).toBe('À rapprocher')
    expect(String(remote[0].detail_reprise)).toContain('"state":"partial"')
    expect(String(remote[0].detail_reprise)).toContain('linked_raw_only')
    expect(String(remote[0].detail_reprise)).toContain('"targets":[{')
  })
}

test('journal updates preserve human notes, prior target fields and unresolved operator annotations', async () => {
  const f = await personFixture()
  let injected = false
  fault = (url, init) => {
    if (!injected && url.includes('fictionalpeople') && init.method === 'PATCH') {
      injected = true
      const old = {
        version: 1,
        sourceKey: `${source().spreadsheetId}:0`,
        targets: [{ table: f.peopleTable, id: 50, fields: ['telephone'] }],
        state: 'pending',
        reasons: ['verification_humaine'],
        at: '2026-09-29T06:00:00Z',
        note: 'Conserver annotation',
      }
      remote[0].detail_reprise =
        'Note opératrice conservée\n[EUNEOS_GOOGLE_RECONCILIATION_V1]' +
        JSON.stringify(old) +
        '[/EUNEOS_GOOGLE_RECONCILIATION_V1]'
    }
    return f.baseFault(url, init)
  }
  for (let i = 0; i < 3; i++) await poll(f.snapshot)
  const detail = String(remote[0].detail_reprise)
  expect(detail).toContain('Note opératrice conservée')
  expect(detail).toContain('Conserver annotation')
  expect(detail).toContain('telephone')
  expect(detail).toContain('date_pre_recu')
  expect(detail).toContain('verification_humaine')
  expect(detail).toContain('"state":"partial"')
})

test('changing an existing source timestamp cannot masquerade as a new auto-projectable response', async () => {
  const { s, snapshot } = await futurePush()
  await seed(s, [snapshot.headers, [...snapshot.rows[0]]])
  snapshot.rows[0][0] = '30/09/2026 10:00:00'
  for (let i = 0; i < 3; i++) await poll(snapshot)
  expect(hooks()).toHaveLength(0)
  expect(ledger()).toHaveLength(2)
  expect(String(remote.at(-1)?.detail_reprise)).toContain('identity_ambiguous')
})

test('adult creation refuses a same-name person in the confirmed dossier with another or missing email', async () => {
  const f = await createPersonFixture()
  fault = (url, init) => {
    if (
      url.includes('fictionalpeople') &&
      url.includes('?') &&
      new URL(url).searchParams.get('where')?.startsWith('(participations_id')
    )
      return Response.json({
        list: [{ Id: 99, nom: 'Exemple Alex', prenom: null, email: null, participations_id: 7 }],
        pageInfo: { isLastPage: true },
      })
    return f.creationFault(url, init)
  }
  for (let i = 0; i < 3; i++) await poll(f.snapshot)
  expect(personCreates()).toHaveLength(0)
  expect(String(remote[0].detail_reprise)).toContain('identity_conflict')
})

test('full family catalog supports contiguous secret parts four through twelve and refuses holes', () => {
  const parts = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      i ? `SOURCES_${i + 1}` : 'SOURCES',
      JSON.stringify([
        source({ spreadsheetId: `fictional_sheet_id_${String(i).padStart(5, '0')}` }),
      ]),
    ]),
  ) as Pick<Env, 'SOURCES'>
  expect(configuredSources(parts)).toHaveLength(12)
  delete (parts as Record<string, string>).SOURCES_7
  expect(() => configuredSources(parts)).toThrow('sources_part_missing')
})
