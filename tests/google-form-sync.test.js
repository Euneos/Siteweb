import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { NC } from '../src/lib/nocodb'
import {
  syncGoogleForm,
  projectGoogleForm,
  parseGoogleFormEvent,
} from '../src/lib/google-form-sync'
import {
  readContact,
  writeContact,
  CONTACT_OPEN,
  CONTACT_CLOSE,
} from '../src/lib/google-form-contact'
import { POST, GET } from '../src/pages/api/hook/google-forms'
const savedFetch = globalThis.fetch
const secret = 'fictional-local-test-secret-000000000000'
let sql, db, schools, targets, patches, loseResponse, dropPatch, readFailure, concurrent, gets
const event = (overrides = {}) => ({
  version: 1,
  kind: 'contact',
  cohortId: 2,
  source: {
    spreadsheetId: 'fictional_sheet_id',
    sheetId: 0,
    row: 2,
    revision: 1,
    submittedAt: '2026-09-10T10:00:00.000Z',
    readAt: '2026-09-22T10:00:00.000Z',
  },
  identity: {
    name: 'Collège Exemple',
    city: 'Ville Exemple',
    postcode: '01234',
    referenceEmail: '',
  },
  contact: { name: 'Référente fictive', email: 'fiction@example.invalid', phone: '' },
  formation: {
    start: '2026-10-01',
    end: '2027-01-10',
    format: 'Présentiel',
    planning: '5 séances',
  },
  declaredTrainer: 'Personne Exemple <fiction@example.invalid>',
  participants: 'Noms à compléter',
  ...overrides,
})
beforeEach(() => {
  sql = new Database(':memory:')
  for (const file of [
    '0002_google_form_sync.sql',
    '0004_operational_submissions.sql',
    '0005_google_form_transition_captures.sql',
  ])
    sql.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'))
  db = {
    prepare: (query) => ({
      bind: (...values) => ({
        run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
        first: async () => sql.query(query).get(...values),
        all: async () => ({ results: sql.query(query).all(...values) }),
      }),
    }),
  }
  schools = [
    {
      Id: 1,
      nom: 'Collège Exemple',
      ville: 'Ville Exemple',
      cp: '1234.0',
      referent_email: 'fiction@example.invalid',
    },
  ]
  targets = [
    {
      Id: 7,
      etablissements_id: 1,
      cohortes_id: 2,
      fusionne_vers: null,
      notes: ' Note humaine\n',
      fiche_contact_recue: false,
      date_debut_formation: null,
      date_fin_formation: null,
      statut_formation: null,
    },
  ]
  patches = []
  loseResponse = false
  dropPatch = false
  readFailure = false
  concurrent = false
  gets = 0
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url)),
      parts = u.pathname.split('/')
    if (u.origin !== 'https://app.nocodb.com' || !Object.values(NC.tables).includes(parts[4]))
      throw new Error('unexpected_destination')
    if (init?.method === 'PATCH') {
      expect(parts[4]).toBe(NC.tables.participations)
      const [patch] = JSON.parse(init.body)
      patches.push(patch)
      if (!dropPatch)
        Object.assign(
          targets.find((x) => x.Id === patch.Id),
          patch,
        )
      if (loseResponse) throw new Error('Lost response AFTER remote commit')
      return Response.json([patch])
    }
    expect(init?.method ?? 'GET').toBe('GET') // no creates, links, deletions or email
    if (readFailure) throw new Error('offline')
    const rows =
      parts[4] === NC.tables.cohortes
        ? [{ Id: 2 }]
        : parts[4] === NC.tables.etablissements
          ? schools
          : targets
    if (parts[6]) {
      gets++
      if (concurrent && gets === 2) targets[0].notes = 'New human edit'
      return Response.json(rows.find((x) => x.Id === Number(parts[6])))
    }
    const offset = Number(u.searchParams.get('offset'))
    return Response.json({
      list: rows.slice(offset, offset + 1),
      pageInfo: { isLastPage: offset + 1 >= rows.length },
    })
  }
})
afterEach(() => {
  globalThis.fetch = savedFetch
  sql.close()
})
const sync = (e = event()) =>
  syncGoogleForm({
    db,
    token: 'fake-nocodb-token',
    event: parseGoogleFormEvent(e),
    rawPayload: JSON.stringify(e),
    mode: 'apply',
  })
const rows = () => sql.query('SELECT * FROM google_form_events').all()
const locks = () => sql.query('SELECT * FROM operational_submission_locks').all()
const env = () => ({
  runtime: {
    env: {
      FORM_SUBMISSIONS: db,
      NOCODB_TOKEN: 'fake',
      GOOGLE_FORMS_SYNC_SECRET: secret,
      GOOGLE_FORMS_TRANSITION_ENABLED: 'true',
      GOOGLE_FORMS_TRANSITION_MODE: 'apply',
      GOOGLE_FORMS_SYNC_SOURCES: JSON.stringify([
        {
          spreadsheetId: 'fictional_sheet_id',
          sheetId: 0,
          kind: 'contact',
          cohortId: 2,
          firstRow: 2,
        },
      ]),
    },
  },
})
const request = (body = event(), host = 'euneos.fr', credential = secret) =>
  new Request(`https://${host}/api/hook/google-forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-google-forms-secret': credential },
    body: JSON.stringify(body),
  })

const captures = () => sql.query('SELECT * FROM google_form_transition_captures').all()
test('only empty dossier promoted; raw contact and declarations retained, no mail/create/link', async () => {
  expect(await sync()).toMatchObject({ state: 'complete', code: 'saved' })
  expect(targets[0].statut_formation).toBe('Prévisionnelle')
  const notes = readContact(targets[0].notes)
  expect(notes.googleContact.email).toBe('fiction@example.invalid')
  expect(notes.participants.importedCount).toBe(0)
  expect(notes.declaredTrainers).toEqual([{ name: event().declaredTrainer }])
  expect(targets[0].notes.startsWith(' Note humaine\n')).toBe(true)
  expect(JSON.parse(captures()[0].payload)).toEqual(event())
  expect(Object.keys(patches[0]).sort()).toEqual(
    [
      'Id',
      'date_debut_formation',
      'date_fin_formation',
      'fiche_contact_recue',
      'notes',
      'statut_formation',
    ].sort(),
  )
  expect(locks()).toHaveLength(0)
})
test('12 concurrent sends and changed readAt do not repeat Noco writes', async () => {
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => sync()))
  expect(outcomes.some((r) => r.state === 'complete')).toBe(true)
  const retry = event()
  retry.source.readAt = '2026-09-29T10:00:00Z'
  expect((await sync(retry)).state).toBe('complete')
  expect(patches).toHaveLength(1)
  expect(rows()).toHaveLength(1)
  expect(captures()).toHaveLength(1)
})
test('edited responses A -> B -> A each captured; existing operational values never overwritten', async () => {
  await sync()
  const original = structuredClone(targets[0])
  const b = event()
  b.source.revision = 2
  b.formation.start = '2026-10-20'
  expect((await sync(b)).code).toBe('existing_projection')
  const a = event()
  a.source.revision = 3
  await sync(a)
  expect(targets[0]).toEqual(original)
  expect(captures()).toHaveLength(3)
  expect(patches).toHaveLength(1)
  expect((await sync(b)).code).toBe('stale_source')
  expect(captures()).toHaveLength(3)
})
test('never-seen older revision cannot overtake a newer captured revision', async () => {
  const newer = event()
  newer.source.revision = 2
  await syncGoogleForm({ db, event: newer, mode: 'capture' })
  expect((await sync()).code).toBe('stale_source')
  expect(patches).toHaveLength(0)
})
test('source identity moved after a revision is reviewed even when the new target is empty', async () => {
  await syncGoogleForm({ db, event: event(), mode: 'capture' })
  schools.push({ ...schools[0], Id: 2, nom: 'Autre' })
  targets.push({ ...targets[0], Id: 8, etablissements_id: 2 })
  const next = event()
  next.source.revision = 2
  next.identity.name = 'Autre'
  expect((await sync(next)).code).toBe('source_identity_changed')
  expect(patches).toHaveLength(0)
})
test('same-revision different known or unknown data remains captured as conflict, never a false success', async () => {
  await sync()
  const changed = event()
  changed.contact.phone = '0202020202'
  expect((await sync(changed)).code).toBe('revision_conflict')
  const unknown = { ...event(), newQuestion: 'Réponse conservée' }
  expect((await sync(unknown)).code).toBe('revision_conflict')
  expect(captures()).toHaveLength(3)
  expect(captures()[2].code).toBe('revision_conflict')
  expect(patches).toHaveLength(1)
})
test('unknown top-level and nested fields captured exactly and flagged without promotion', async () => {
  const raw = { ...event(), extra: '  texte brut  ' }
  raw.formation.removedQuestion = 'ancienne valeur'
  expect((await sync(raw)).code).toBe('unmapped_fields')
  expect(JSON.parse(captures()[0].payload)).toEqual(raw)
  expect(patches).toHaveLength(0)
})
test('stable hashing ignores JSON key order but preserves all raw values', async () => {
  const e = event()
  await sync(e)
  const reordered = Object.fromEntries(Object.entries(e).reverse())
  reordered.source = Object.fromEntries(Object.entries(e.source).reverse())
  expect((await sync(reordered)).state).toBe('complete')
  expect(captures()).toHaveLength(1)
})
test('capture mode persists without any Noco token, network call or target lock', async () => {
  globalThis.fetch = () => {
    throw new Error('network forbidden')
  }
  const configuration = env()
  configuration.runtime.env.GOOGLE_FORMS_TRANSITION_MODE = 'capture'
  delete configuration.runtime.env.NOCODB_TOKEN
  const response = await POST({ request: request(), locals: configuration })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ state: 'review', code: 'captured' })
  expect(captures()).toHaveLength(1)
  expect(locks()).toHaveLength(0)
})
test('operator can later promote exact captured revision without creating another capture', async () => {
  await syncGoogleForm({ db, event: event() })
  expect(patches).toHaveLength(0)
  expect((await sync()).state).toBe('complete')
  expect(captures()).toHaveLength(1)
  expect(patches).toHaveLength(1)
})
test('conflicting contents observed in capture mode prevent later promotion of either body', async () => {
  await syncGoogleForm({ db, event: event() })
  const other = event()
  other.contact.name = 'Autre'
  await syncGoogleForm({ db, event: other })
  expect((await sync()).code).toBe('revision_conflict')
  expect((await sync(other)).code).toBe('revision_conflict')
  expect(patches).toHaveLength(0)
})
test.each(['site', 'legacy-with-site', 'legacy'])(
  'all existing provenance preserved byte-for-byte: %s',
  async (kind) => {
    const n = readContact(projectGoogleForm(event(), targets[0]).patch.notes)
    n.source =
      kind === 'site'
        ? { kind: 'site', receipt: 'a'.repeat(64), readAt: '2026-09-28T12:00:00Z' }
        : n.source
    if (kind === 'legacy-with-site')
      n.operationalSubmissions = [{ receipt: 'b'.repeat(64), data: { new: 'site' } }]
    n.formation.issues = ['Validation humaine attendue']
    n.sourceResponses = [{ historical: 'data' }]
    n.participants.importedCount = 17
    targets[0].notes = writeContact('Note humaine', n) + '\nSuite humaine'
    const before = structuredClone(targets[0])
    const e = event({ kind: 'deploiement' })
    e.formation.start = '2026-11-01'
    expect((await sync(e)).code).toBe('existing_projection')
    expect(targets[0]).toEqual(before)
    expect(patches).toHaveLength(0)
  },
)
test.each([
  'date_debut_formation',
  'date_fin_formation',
  'statut_formation',
  'fiche_contact_recue',
])('existing business field protects whole dossier: %s', async (field) => {
  targets[0][field] =
    field === 'fiche_contact_recue'
      ? true
      : field === 'statut_formation'
        ? 'Terminée'
        : '2026-11-01'
  const before = structuredClone(targets[0])
  expect((await sync()).code).toBe('existing_operational_data')
  expect(targets[0]).toEqual(before)
  expect(patches).toHaveLength(0)
})
test('a contact with deleted dates/participants questions cannot clear historic fields', async () => {
  await sync()
  const before = structuredClone(targets[0])
  const e = event({ participants: '' })
  e.source.revision = 2
  e.formation = { start: '', end: '', format: '', planning: '' }
  expect((await sync(e)).state).toBe('review')
  expect(targets[0]).toEqual(before)
  expect(patches).toHaveLength(1)
})
test.each([
  ['2026-10-10', '2026-03-15'],
  ['2026-02-30', '2026-12-01'],
  ['', ''],
  ['2028-01-01', '2028-02-01'],
])('invalid dates retained in capture, no partial business write: %s %s', async (start, end) => {
  const e = event()
  e.formation.start = start
  e.formation.end = end
  expect((await sync(e)).code).toBe('dates_invalid')
  expect(patches).toHaveLength(0)
  expect(captures()).toHaveLength(1)
})
test('deployment does not imply contact receipt, adult creation, or assigned trainer', async () => {
  expect((await sync(event({ kind: 'deploiement' }))).state).toBe('complete')
  expect(targets[0].fiche_contact_recue).toBe(false)
  expect(targets[0].statut_formation).toBe('Programmée')
  expect(readContact(targets[0].notes).receivedAt).toBeNull()
})
test.each([
  'homonym',
  'duplicate dossier',
  'name only',
  'contradictory email',
  'wrong city',
  'wrong cohort',
])('ambiguous identity captured but never promoted: %s', async (reason) => {
  const e = event()
  if (reason === 'homonym') schools.push({ ...schools[0], Id: 2 })
  if (reason === 'duplicate dossier') targets.push({ ...targets[0], Id: 8 })
  if (reason === 'name only') {
    e.identity.city = ''
    e.identity.postcode = ''
  }
  if (reason === 'contradictory email') e.identity.referenceEmail = 'other@example.invalid'
  if (reason === 'wrong city') e.identity.city = 'Wrong'
  if (reason === 'wrong cohort') targets[0].cohortes_id = 1
  expect((await sync(e)).code).toBe('identity_unresolved')
  expect(patches).toHaveLength(0)
  expect(captures()).toHaveLength(1)
})
test('explicit reviewed alias mapping still validates expected school identity', async () => {
  const e = event()
  e.identity.name = 'ALIAS'
  const mapping = {
    submitted: e.identity,
    schoolId: 1,
    expected: { name: schools[0].nom, city: schools[0].ville, postcode: '01234' },
  }
  expect((await sync(e)).code).toBe('identity_unresolved')
  expect(
    (
      await syncGoogleForm({
        db,
        token: 'fake',
        event: e,
        mode: 'apply',
        sourceConfig: { identityMappings: [mapping] },
      })
    ).state,
  ).toBe('complete')
})
test('archives and other cohorts excluded', async () => {
  targets.push({ ...targets[0], Id: 8, cohortes_id: 1 }, { ...targets[0], Id: 9, fusionne_vers: 7 })
  await sync()
  expect(patches.map((x) => x.Id)).toEqual([7])
})
test('site / link-renewal shared target lock blocks Google; read-only retry resumes', async () => {
  sql
    .query('INSERT INTO operational_submission_locks(target_id,link_hash) VALUES (?,?)')
    .run(7, 'site-link')
  expect((await sync()).code).toBe('target_busy')
  expect(patches).toHaveLength(0)
  expect(locks()[0].link_hash).toBe('site-link')
  sql.query('DELETE FROM operational_submission_locks WHERE link_hash=?').run('site-link')
  expect((await sync()).state).toBe('complete')
})
test('historical uncertain lock is not bypassed by new transition', async () => {
  sql.query('INSERT INTO google_form_locks(target_id,event_key) VALUES (?,?)').run(7, 'legacy')
  expect((await sync()).code).toBe('legacy_lock')
  expect(patches).toHaveLength(0)
  expect(locks()).toHaveLength(0)
})
test.each(['response', 'readback'])(
  'uncertain %s holds shared lock and never retries PATCH',
  async (fault) => {
    loseResponse = fault === 'response'
    dropPatch = fault === 'readback'
    expect((await sync()).code).toBe('write_uncertain')
    loseResponse = false
    dropPatch = false
    expect((await sync()).code).toBe('write_uncertain')
    const e = event()
    e.source.row = 3
    expect((await sync(e)).code).toBe('target_busy')
    expect(locks()).toHaveLength(1)
    expect(patches).toHaveLength(1)
  },
)
test('failure persisting completion after remote commit retains lock', async () => {
  const wrapped = {
    prepare: (q) =>
      q.startsWith('UPDATE google_form_events SET state=')
        ? {
            bind: () => ({
              run: async () => {
                throw new Error('db failed')
              },
            }),
          }
        : db.prepare(q),
  }
  expect(
    (await syncGoogleForm({ db: wrapped, token: 'fake', event: event(), mode: 'apply' })).code,
  ).toBe('write_uncertain')
  expect(locks()).toHaveLength(1)
  expect(patches).toHaveLength(1)
})
test('read failure can retry; human edit before patch blocks without deleting source', async () => {
  readFailure = true
  expect((await sync()).state).toBe('retryable')
  expect(captures()).toHaveLength(1)
  expect(locks()).toHaveLength(0)
  readFailure = false
  concurrent = true
  expect((await sync()).code).toBe('concurrent_change')
  expect(patches).toHaveLength(0)
  expect(locks()).toHaveLength(0)
})
test('malformed or over-capacity notes left untouched', async () => {
  for (const notes of [CONTACT_OPEN + 'bad' + CONTACT_CLOSE, 'x'.repeat(160001)]) {
    targets[0].notes = notes
    expect((await sync()).code).toBe('notes_invalid')
    expect(targets[0].notes).toBe(notes)
  }
  expect(patches).toHaveLength(0)
})
test('previews/auth/source/cohort gated before capture or Noco access', async () => {
  for (const [req, status] of [
    [request(event(), 'preview.pages.dev'), 404],
    [request(event(), 'euneos.fr', 'wrong'), 401],
  ])
    expect((await POST({ request: req, locals: env() })).status).toBe(status)
  const unknown = event()
  unknown.source.sheetId = 123
  expect((await POST({ request: request(unknown), locals: env() })).status).toBe(403)
  expect((await POST({ request: request(event({ cohortId: 1 })), locals: env() })).status).toBe(400)
  expect(captures()).toHaveLength(0)
  expect(gets).toBe(0)
})
test('OFF ignores old enabled apply settings and needs no configuration', async () => {
  const configuration = env()
  delete configuration.runtime.env.GOOGLE_FORMS_TRANSITION_ENABLED
  configuration.runtime.env.GOOGLE_FORMS_SYNC_MODE = 'apply'
  expect((await POST({ request: request(), locals: configuration })).status).toBe(410)
  expect(captures()).toHaveLength(0)
  expect(gets).toBe(0)
})
test('readiness and plan have no writes; caller cannot promote over capture', async () => {
  const configuration = env()
  delete configuration.runtime.env.GOOGLE_FORMS_TRANSITION_MODE
  expect(await (await GET({ request: request(), locals: configuration })).json()).toMatchObject({
    mode: 'plan',
    ready: true,
  })
  const result = await (await POST({ request: request(), locals: configuration })).json()
  expect(result).toMatchObject({ state: 'plan', code: 'ready', targetId: 7 })
  expect(captures()).toHaveLength(0)
  expect(patches).toHaveLength(0)
  const req = request()
  req.headers.set('x-google-forms-mode', 'plan')
  expect((await (await POST({ request: req, locals: env() })).json()).state).toBe('plan')
  configuration.runtime.env.GOOGLE_FORMS_TRANSITION_MODE = 'capture'
  const escalate = request()
  escalate.headers.set('x-google-forms-mode', 'apply')
  expect(await (await POST({ request: escalate, locals: configuration })).json()).toMatchObject({
    state: 'review',
    code: 'captured',
  })
  expect(patches).toHaveLength(0)
})
test('source firstRow excludes old stock unless explicitly selected', async () => {
  const configuration = env(),
    sources = JSON.parse(configuration.runtime.env.GOOGLE_FORMS_SYNC_SOURCES)
  sources[0].firstRow = 3
  configuration.runtime.env.GOOGLE_FORMS_SYNC_SOURCES = JSON.stringify(sources)
  expect((await POST({ request: request(), locals: configuration })).status).toBe(403)
  expect(captures()).toHaveLength(0)
})
test('actual streamed UTF-8 bytes bounded, content type and malformed payload rejected', async () => {
  expect(
    (await POST({ request: request({ huge: 'é'.repeat(20000) }), locals: env() })).status,
  ).toBe(413)
  const req = request()
  req.headers.set('content-type', 'application/jsonish')
  expect((await POST({ request: req, locals: env() })).status).toBe(415)
  const bad = new Request('https://euneos.fr/api/hook/google-forms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-google-forms-secret': secret },
    body: 'no',
  })
  expect((await POST({ request: bad, locals: env() })).status).toBe(400)
  expect(captures()).toHaveLength(0)
})
test.each([
  'google_form_transition_captures',
  'operational_submission_locks',
  'google_form_events',
  'google_form_locks',
])('missing migration fails closed: %s', async (table) => {
  sql.exec('DROP TABLE ' + table)
  expect((await GET({ request: request(), locals: env() })).status).toBe(503)
  expect(patches).toHaveLength(0)
})
test('server response never echoes raw evidence or credentials outside explicit plan', async () => {
  const response = await POST({ request: request(), locals: env() })
  expect(response.status).toBe(200)
  expect(Object.keys(await response.json()).sort()).toEqual(['code', 'receipt', 'state'])
  expect(response.headers.get('cache-control')).toContain('no-store')
})

test('fully mapped sheet snapshot can accompany a safe promotion; unknown/missing columns require review', async () => {
  const snapshot = {
    headers: ['Champ'],
    values: ['Réponse complète'],
    unmappedColumns: [],
    missingFields: [],
  }
  const first = { ...event(), sheetSnapshot: snapshot }
  expect((await sync(first)).state).toBe('complete')
  expect(JSON.parse(captures()[0].payload).sheetSnapshot).toEqual(snapshot)
  const next = { ...event(), sheetSnapshot: { ...snapshot, unmappedColumns: [1] } }
  next.source.row = 3
  expect((await sync(next)).code).toBe('unmapped_fields')
  expect(patches).toHaveLength(1)
})

test('original successful revision also reports later observed content conflict', async () => {
  await sync()
  const conflict = event()
  conflict.contact.phone = '123'
  await sync(conflict)
  expect((await sync()).code).toBe('revision_conflict')
  expect(patches).toHaveLength(1)
})
test.each(['revision', 'conflict'])(
  'source %s arriving during remote planning blocks atomic prewrite admission',
  async (reason) => {
    const server = globalThis.fetch
    let intercepted = 0
    globalThis.fetch = async (url, init) => {
      if (
        (init?.method ?? 'GET') === 'GET' &&
        new URL(String(url)).pathname.endsWith('/records/7') &&
        ++intercepted === 2
      ) {
        const changed = event()
        if (reason === 'revision') changed.source.revision = 2
        else changed.contact.phone = '123'
        await syncGoogleForm({ db, event: changed, mode: 'capture' })
      }
      return server(url, init)
    }
    expect((await sync()).code).toBe('source_changed')
    expect(patches).toHaveLength(0)
    expect(locks()).toHaveLength(0)
    expect(captures()).toHaveLength(2)
  },
)
test('invalid snapshot and pathological nesting rejected as payload error before persistence', async () => {
  const invalid = {
    ...event(),
    sheetSnapshot: { headers: ['A'], values: [], unmappedColumns: [], missingFields: [] },
  }
  expect((await POST({ request: request(invalid), locals: env() })).status).toBe(400)
  let nested = {}
  for (let i = 0; i < 70; i++) nested = { child: nested }
  expect(
    (await POST({ request: request({ ...event(), unknown: nested }), locals: env() })).status,
  ).toBe(400)
  expect(captures()).toHaveLength(0)
})
