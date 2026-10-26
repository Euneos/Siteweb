import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { publicRespondent, responseOverviews, readResponseSources, overviewReadQueue } from '../src/lib/form-response-overview'
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
test('a confirmed trainer classification is visible without changing respondent counts', () => {
  const row = { Id: 14, dossier_id: 7, etablissement: 'Collège Test', statut_reprise: 'Classée — réponse formatrice', detail_reprise: 'trainer_response_classified',
    reponses: JSON.stringify({ kind: 'pre_formation_adultes', answers: [{ key: 'name', value: 'Camille Test' }, { key: 'role', value: 'Enseignant·e' }] }) }
  expect(publicRespondent(row).person.role).toBe('Formatrice — réponse classée, hors stagiaires')
  expect(publicRespondent(row).key).toBe('pre-formation')
  expect(publicRespondent({ ...row, detail_reprise: 'projection_pending' }).person.role).toBe('Enseignant·e')
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
  sql.query("INSERT INTO form_submissions(submission_key,form_type,cohort_id,state,phase,parent_id,record_id) VALUES ('trainer','formateur',0,'complete','complete',21,31)").run()
  const parts = [
    { Id: 7, etablissements_id: 1, cohortes_id: 2, fusionne_vers: null },
    { Id: 8, etablissements_id: 1, cohortes_id: 2, fusionne_vers: 7 },
  ]
  const source = { Id: 1, cle_reponse: 'public', dossier_id: 7, etablissement: 'Collège Test', CreatedAt: '2026-10-21T10:00:00Z',
    reponses: JSON.stringify({ kind: 'contact', answers: { referrer: { name: 'Camille Test', email: 'private@example.test' } } }) }
  globalThis.fetch = async (url, init) => {
    expect(init.method).toBe('GET')
    const parsed = new URL(url), table = parsed.pathname.split('/')[4]
    // This column exists on engagements, not on the trainer identity table.
    if (table === NC.tables.formateurs && parsed.searchParams.get('fields')?.includes('fusionne_vers'))
      return Response.json({ error: 'Field not found' }, { status: 422 })
    const rows = table === 'fixturetable' ? [source, { ...source, Id: 2 }, { ...source, Id: 3, cle_reponse: 'old', dossier_id: 8 }]
      : table === NC.tables.participations ? parts
      : table === NC.tables.etablissements ? [{ Id: 1, nom: 'Collège Test' }]
      : table === NC.tables.formateurs ? [{ Id: 21, nom: 'Test', prenom: 'Camille' }]
      : table === NC.tables.engagements ? [{ Id: 31, formateurs_id: 21, cohortes_id: null, fusionne_vers: null }] : []
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
    expect(result.groups['candidature-formateur'].rows).toHaveLength(1)
    expect(result.groups['candidature-formateur'].rows[0].name).toBe('Camille Test')
    expect(result.groups['candidature-etablissement'].rows).toHaveLength(0)
  } finally { sql.close() }
})
test('overview serializes reads and recovers from throttling without retrying schema errors', async () => {
  const events = [], delays = []
  const read = overviewReadQueue(async ms => { delays.push(ms) })
  let attempts = 0
  const first = read(async () => { events.push('first'); if (++attempts < 3) throw new Error('NocoDB 429'); return 1 })
  const second = read(async () => { events.push('second'); return 2 })
  expect(await Promise.all([first, second])).toEqual([1, 2])
  expect(events).toEqual(['first', 'first', 'first', 'second'])
  expect(delays).toEqual([500, 1000])
  let invalidAttempts = 0
  await expect(read(async () => { invalidAttempts++; throw new Error('NocoDB 422') })).rejects.toThrow('422')
  expect(invalidAttempts).toBe(1)
  expect(await read(async () => 'next')).toBe('next')
  let exhausted = 0
  await expect(read(async () => { exhausted++; throw new Error('NocoDB 503') })).rejects.toThrow('503')
  expect(exhausted).toBe(3)
})
test('private endpoint refuses unauthenticated access before reading any source', async () => {
  let reads = 0
  globalThis.fetch = async () => { reads++; throw new Error('Unexpected access') }
  const response = await GET({ request: new Request('https://euneos.fr/api/interne/apercu-reponses'), locals: { runtime: { env: { INTERNAL_ACCESS_DOMAIN: 'fixture.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'team' } } } })
  expect(response.status).toBe(403)
  expect(reads).toBe(0)
})
