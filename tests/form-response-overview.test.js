import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { publicRespondent, responseOverviews, readResponseSources } from '../src/lib/form-response-overview'
import { GET } from '../src/pages/api/interne/apercu-reponses'
import { NC } from '../src/lib/nocodb'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })
test('no name or role is inferred from an evaluation audience', () => {
  const row = publicRespondent({ Id: 8, etablissement: 'Collège Test', reponses: JSON.stringify({ kind: 'evaluation_fin_formation', answers: [{ key: 'email', value: 'private@example.test' }] }) })
  expect(row.person.name).toBe('Nom non recueilli')
  expect(row.person.role).toBe('Rôle non recueilli')
  expect(JSON.stringify(row)).not.toContain('private@example.test')
})
test('reads past a server-clamped page, never returns a truncated total', async () => {
  const rows = Array.from({ length: 103 }, (_, i) => ({ Id: i + 1 }))
  globalThis.fetch = async url => {
    const offset = Number(new URL(url).searchParams.get('offset'))
    return Response.json({ list: rows.slice(offset, offset + 25), pageInfo: { isLastPage: offset + 25 >= rows.length } })
  }
  expect(await readResponseSources('fixture', 'fixturetable')).toHaveLength(103)
  globalThis.fetch = async () => Response.json({ list: [{ Id: 1 }], pageInfo: { isLastPage: false } })
  await expect(readResponseSources('fixture', 'fixturetable')).rejects.toThrow('pagination')
})
test('counts durable responses once, excludes archived dossiers and unsuccessful personal attempts', async () => {
  const sql = new Database(':memory:')
  for (const file of readdirSync('migrations').filter(f => /^\d.*\.sql$/.test(f)).sort()) sql.run(readFileSync(`migrations/${file}`, 'utf8'))
  sql.run(readFileSync('migrations/interne/0009_conventions_mission.sql', 'utf8'))
  const db = { prepare: query => ({ bind: (...values) => ({ all: async () => ({ results: sql.query(query).all(...values) }) }) }) }
  const insert = (hash, target, state) => sql.query(`INSERT INTO operational_submissions
    (link_hash,payload_hash,target_id,school_id,cohort_id,kind,receipt,state,code,created_at,updated_at) VALUES (?,?,?,1,2,'contact',?,?,'ok','2026-10-20T10:00:00Z','2026-10-20T10:00:00Z')`).run(hash, hash, target, hash, state)
  insert('personal', 7, 'complete')
  insert('public', 7, 'complete')
  insert('failed', 7, 'retryable')
  insert('archived', 8, 'complete')
  sql.query("INSERT INTO public_form_receipts(receipt,kind,answers_hash) VALUES ('public','contact','public')").run()
  const parts = [
    { Id: 7, etablissements_id: 1, cohortes_id: 2, fusionne_vers: null },
    { Id: 8, etablissements_id: 1, cohortes_id: 2, fusionne_vers: 7 },
  ]
  const source = { Id: 1, cle_reponse: 'public', dossier_id: 7, etablissement: 'Collège Test', CreatedAt: '2026-10-21T10:00:00Z',
    reponses: JSON.stringify({ kind: 'contact', answers: { referrer: { name: 'Camille Test', email: 'private@example.test' } } }) }
  globalThis.fetch = async (url, init) => {
    expect(init.method).toBe('GET')
    const table = new URL(url).pathname.split('/')[4]
    const rows = table === 'fixturetable' ? [source, { ...source, Id: 2 }, { ...source, Id: 3, cle_reponse: 'old', dossier_id: 8 }]
      : table === NC.tables.participations ? parts
      : table === NC.tables.etablissements ? [{ Id: 1, nom: 'Collège Test' }] : []
    return Response.json({ list: rows, pageInfo: { isLastPage: true } })
  }
  try {
    const result = await responseOverviews({ runtime: { env: { OPERATIONAL_FORMS_ENABLED: 'true', NOCODB_TOKEN: 'fixture', FORM_SUBMISSIONS: db, PUBLIC_FORMS_TABLE: 'fixturetable' } } }, db)
    expect(result.groups.contact.rows).toHaveLength(2)
    expect(result.groups.contact.rows.some(p => p.name === 'Camille Test')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private@example.test')
    expect(result.groups.newsletter).toBeUndefined()
    expect(result.unavailable.newsletter).toContain('Brevo')
    expect(result.groups['convention-mission'].rows).toHaveLength(0)
  } finally { sql.close() }
})
test('private endpoint refuses unauthenticated access before reading any source', async () => {
  let reads = 0
  globalThis.fetch = async () => { reads++; throw new Error('Unexpected access') }
  const response = await GET({ request: new Request('https://euneos.fr/api/interne/apercu-reponses'), locals: { runtime: { env: { INTERNAL_ACCESS_DOMAIN: 'fixture.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'team' } } } })
  expect(response.status).toBe(403)
  expect(reads).toBe(0)
})
