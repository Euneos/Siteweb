import { afterEach, expect, spyOn, test } from 'bun:test'
import { GET, POST } from '../src/pages/api/hook/candidature'
import { IMPORT_CANDIDATURE_MARKER, IMPORT_CANDIDATURE_VERSION } from '../src/lib/candidature-import'
import { NC } from '../src/lib/nocodb'

const fetchMock = spyOn(globalThis, 'fetch')
afterEach(() => fetchMock.mockReset())
const env = { HOOK_SECRET: 'test-hook', BREVO_API_KEY: 'test-only', EQUIPE_EMAIL: 'test@example.invalid' }
const historique = (code = 'ETAB-C2-46', school = 60) => ({
  Id: 10001, code, etablissements_id: school, cohortes_id: 2,
  notes: `Source conservée\n\n${IMPORT_CANDIDATURE_MARKER}`,
  statut: 'Candidature acceptée',
})
const payload = (rows) => ({ type: 'records.after.insert', version: 'v3', data: { table_id: NC.tables.participations, rows } })
async function request(body, options = {}) {
  return (options.method === 'GET' ? GET : POST)({
    request: new Request(options.url ?? 'https://www.euneos.fr/api/hook/candidature', {
      method: options.method ?? 'POST',
      headers: { 'x-hook-secret': options.secret ?? 'test-hook', 'Content-Type': 'application/json' },
      ...(options.method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    }),
    locals: { runtime: { env } },
  })
}

test('two source-notified imports do not call Brevo', async () => {
  const response = await request(payload([historique(), historique('ETAB-C2-48', 61)]))
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('reprise-historique')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('a webhook replay of a historical import stays silent', async () => {
  for (let i = 0; i < 3; i++) expect((await request(payload([historique()]))).status).toBe(200)
  expect(fetchMock).not.toHaveBeenCalled()
})

test('a normal application, including the same code without marker, still notifies', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
  const row = { ...historique(), notes: 'Une candidature normale' }
  const response = await request(payload([row]))
  expect(await response.text()).toBe('envoye')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('mixed batches notify only the new applications', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
  const normal = { code: 'new', etablissement: { nom: 'École test' }, statut: 'Candidature recue' }
  expect((await request(payload([historique(), normal]))).status).toBe(200)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.subject).toBe('Nouvelle candidature sur euneos.fr')
  expect(body.textContent).toContain('École test')
  expect(body.textContent).not.toContain('Candidature acceptée')
})

for (const [label, mutate] of [
  ['unknown code', (p) => { p.data.rows[0].code = 'ETAB-C2-99' }],
  ['wrong school', (p) => { p.data.rows[0].etablissements_id = 61 }],
  ['wrong cohort', (p) => { p.data.rows[0].cohortes_id = 1 }],
  ['school ID confused with participation ID', (p) => { delete p.data.rows[0].etablissements_id }],
  ['non-exact marker', (p) => { p.data.rows[0].notes = 'prefix ' + IMPORT_CANDIDATURE_MARKER }],
  ['wrong table', (p) => { p.data.table_id = NC.tables.engagements }],
  ['update event', (p) => { p.type = 'records.after.update' }],
  ['unverified envelope', (p) => { delete p.version }],
]) {
  test(`${label}: reject the whole batch before sending`, async () => {
    const body = payload([historique(), { code: 'normal' }]); mutate(body)
    expect((await request(body)).status).toBe(422)
    expect(fetchMock).not.toHaveBeenCalled()
  })
}

test('capability read requires authentication and never sends', async () => {
  expect((await request(null, { method: 'GET', secret: 'wrong' })).status).toBe(401)
  const response = await request(null, { method: 'GET' })
  expect(await response.json()).toEqual({ historicalImportVersion: IMPORT_CANDIDATURE_VERSION })
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('unauthenticated and preview posts remain disabled', async () => {
  expect((await request(payload([historique()]), { secret: 'wrong' })).status).toBe(401)
  expect((await request(payload([historique()]), { url: 'https://pr-1.euneos-site.pages.dev/api/hook/candidature' })).status).toBe(404)
  expect(fetchMock).not.toHaveBeenCalled()
})
