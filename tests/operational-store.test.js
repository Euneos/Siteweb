import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { NC } from '../src/lib/nocodb'
import { readContact, writeContact } from '../src/lib/google-form-contact'
import { OPERATIONAL_ADULTS_TABLE, parseOperationalInput } from '../src/lib/operational-data'
import {
  enregistrerOperational,
  readOperationalSubmission,
  listOperationalSubmissions,
} from '../src/lib/operational-store'
const originalFetch = globalThis.fetch,
  linkHash = 'a'.repeat(64),
  target = { participationId: 7, schoolId: 1, cohortId: 2 }
let sql, db, targets, adults, mutations, mode, reads, hook, pageSize
const person = (extra = {}) => ({
  firstName: 'Alice',
  lastName: 'Exemple',
  email: 'alice@example.invalid',
  role: 'Enseignante',
  ...extra,
})
const raw = (extra = {}) => ({
  referrer: { name: 'Camille Exemple', email: 'camille@example.invalid' },
  formation: {
    start: '2030-10-01',
    end: '2031-01-01',
    format: 'Présentiel',
    planning: '5 séances',
    sessions: 5,
  },
  schoolDetails: {
    academy: 'Académie fictive',
    address: 'Rue fictive',
    postalCode: '00000',
    type: 'Collège',
  },
  directionEmail: 'direction@example.invalid',
  operations: { groupedSchools: false },
  participants: [],
  confirmed: true,
  ...extra,
})
const submit = (extra = {}, overrides = {}) => {
  sql
    .query(
      'INSERT OR IGNORE INTO operational_links(token_hash,target_id,school_id,cohort_id,kind,issuer_hash,expires_at) VALUES (?,7,1,2,?,?,?)',
    )
    .run(
      overrides.linkHash ?? linkHash,
      overrides.kind ?? 'contact',
      'd'.repeat(64),
      Date.now() + 86400000,
    )
  return enregistrerOperational({
    db,
    token: 'fake-nocodb',
    linkHash,
    target,
    kind: 'contact',
    data: parseOperationalInput(raw(extra), overrides.kind ?? 'contact'),
    ...overrides,
  })
}
const journal = () => sql.query('SELECT * FROM operational_submissions').all()
const locks = () => sql.query('SELECT * FROM operational_submission_locks').all()
beforeEach(() => {
  sql = new Database(':memory:')
  sql.run(
    readFileSync(
      new URL('../migrations/0004_operational_submissions.sql', import.meta.url),
      'utf8',
    ),
  )
  sql.run(
    readFileSync(new URL('../migrations/0003_operational_links.sql', import.meta.url), 'utf8'),
  )
  for (const kind of ['contact', 'deploiement', 'participants'])
    sql
      .query('INSERT INTO operational_link_slots(target_id,kind,token_hash) VALUES (7,?,?)')
      .run(kind, linkHash)
  db = {
    prepare: (query) => ({
      bind: (...values) => ({
        run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
        first: async () => sql.query(query).get(...values),
        all: async () => ({ results: sql.query(query).all(...values) }),
      }),
    }),
  }
  targets = [
    {
      Id: 7,
      etablissements_id: 1,
      cohortes_id: 2,
      fusionne_vers: null,
      statut: 'Engage',
      notes: 'Note humaine',
      fiche_contact_recue: false,
      date_debut_formation: null,
      date_fin_formation: null,
      statut_formation: null,
    },
  ]
  adults = []
  mutations = []
  mode = ''
  reads = 0
  hook = null
  pageSize = 200
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url)),
      parts = u.pathname.split('/'),
      table = parts[4],
      id = Number(parts[6]),
      method = init?.method ?? 'GET'
    if (
      u.origin !== 'https://app.nocodb.com' ||
      ![...Object.values(NC.tables), OPERATIONAL_ADULTS_TABLE].includes(table)
    )
      throw new Error('unexpected destination')
    if (method === 'GET') {
      reads++
      if (hook) hook({ table, id, reads })
      if (mode === 'adult-readback-failed' && table === OPERATIONAL_ADULTS_TABLE && adults.length)
        throw new Error('lost adult readback')
      if (mode === 'read-failed') throw new Error('network PII must not escape')
      const rows =
        table === NC.tables.participations
          ? targets
          : table === NC.tables.etablissements
            ? [{ Id: 1, nom: 'Collège Exemple', ville: 'Ville fictive' }]
            : table === NC.tables.cohortes
              ? [{ Id: 2, active: true, annee_debut: 2030, annee_fin: 2031, nom: '2030–2031' }]
              : adults
      if (id) {
        if (mode === 'adult-readback-failed' && table === OPERATIONAL_ADULTS_TABLE)
          throw new Error('lost GET')
        return Response.json(rows.find((r) => r.Id === id) ?? {}, {
          status: rows.some((r) => r.Id === id) ? 200 : 404,
        })
      }
      expect(table).toBe(OPERATIONAL_ADULTS_TABLE)
      expect(u.searchParams.get('where')).toBe('(participations_id,eq,7)')
      const offset = Number(u.searchParams.get('offset'))
      return Response.json({
        list: rows.slice(offset, offset + pageSize),
        pageInfo: { isLastPage: offset + pageSize >= rows.length },
      })
    }
    const bodies = JSON.parse(init.body),
      [body] = bodies
    mutations.push({ table, method, body, bodies })
    if (method === 'POST') {
      expect(table).toBe(OPERATIONAL_ADULTS_TABLE)
      if (mode === 'adult-timeout-before') throw new Error('timeout before create')
      const created = []
      for (const fields of bodies) {
        const a = { Id: 100 + adults.length, ...fields }
        if (mode === 'adult-unlinked') a.participations_id = null
        adults.push(a)
        created.push({ Id: a.Id })
        if (mode === 'second-adult-timeout') return Response.json(created) // only first record confirmed
      }
      if (mode === 'adult-timeout-after') throw new Error('timeout after create')
      return Response.json(created)
    }
    expect(method).toBe('PATCH')
    expect(table).toBe(NC.tables.participations)
    if (mode === 'patch-timeout-before') throw new Error('timeout before patch')
    if (mode !== 'patch-dropped')
      Object.assign(
        targets.find((r) => r.Id === body.Id),
        body,
      )
    if (mode === 'patch-timeout-after') throw new Error('timeout after patch')
    return Response.json([body])
  }
})
afterEach(() => {
  globalThis.fetch = originalFetch
  sql.close()
})

test('contact persists to business source, verified receipt; D1 contains no PII or token', async () => {
  const r = await submit({ participants: [person()] })
  expect(r).toMatchObject({ state: 'complete', code: 'saved', duplicate: false, createdAdults: 1 })
  expect(adults[0]).toMatchObject({
    participations_id: 7,
    statut: 'Inscrit',
    prenom: 'Alice',
    nom: 'Exemple',
  })
  expect(adults[0].adulte_id).toMatch(/^AD-WEB-[a-f0-9]{32}$/)
  expect(targets[0].fiche_contact_recue).toBe(true)
  expect(targets[0].statut_formation).toBe('Prévisionnelle')
  const notes = readContact(targets[0].notes)
  expect(notes.participants.importedCount).toBe(1)
  expect(notes.operationalSubmissions[0].data.referrer.email).toBe('camille@example.invalid')
  expect(notes.declaredTrainers).toEqual([])
  expect(locks()).toHaveLength(0)
  const technical = JSON.stringify(journal())
  for (const secret of [
    'Camille',
    'Alice',
    'Exemple',
    'example.invalid',
    'fake-nocodb',
    'Présentiel',
  ])
    expect(technical).not.toContain(secret)
  expect(await readOperationalSubmission(db, linkHash)).toMatchObject({
    state: 'complete',
    receipt: r.receipt,
    createdAdults: 1,
    participationId: 7,
  })
})
test('concurrent same link requests create one person and patch once', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, () => submit({ participants: [person()] })),
  )
  // Hashing is asynchronous: late copies may legitimately observe completion.
  expect(results.filter((r) => r.state === 'complete' && !r.duplicate)).toHaveLength(1)
  expect(adults).toHaveLength(1)
  expect(mutations).toHaveLength(2)
  const replay = await submit({ participants: [person()] })
  expect(replay.duplicate).toBe(true)
  expect(replay.receipt).toBe(journal()[0].receipt)
  expect(mutations).toHaveLength(2)
})
test('same target different links serialize, later request reuses adult and does not create twice', async () => {
  sql
    .query("UPDATE operational_link_slots SET token_hash=? WHERE kind='participants'")
    .run('b'.repeat(64))
  const other = () =>
    submit(
      { formation: null, participants: [person()] },
      { kind: 'participants', linkHash: 'b'.repeat(64) },
    )
  // Promise.all does not guarantee overlapping lock ownership: one call can
  // finish while the other is still hashing. Hold a real request after its lock
  // is acquired, then send the competitor. No timing assumptions or sleeps.
  const transport = globalThis.fetch
  let signal,
    release,
    paused = false
  const entered = new Promise((resolve) => {
    signal = resolve
  })
  const hold = new Promise((resolve) => {
    release = resolve
  })
  globalThis.fetch = async (url, init) => {
    if (!paused && init?.method === 'GET' && String(url).includes(OPERATIONAL_ADULTS_TABLE)) {
      paused = true
      signal()
      await hold
    }
    return transport(url, init)
  }
  const first = submit({ participants: [person()] })
  let firstResult
  try {
    await Promise.race([
      entered,
      first.then(() => {
        throw new Error('first request finished before contention barrier')
      }),
    ])
    expect(locks()).toMatchObject([{ target_id: 7, link_hash: linkHash }])
    const blocked = await other()
    expect(blocked).toEqual({
      state: 'retryable',
      code: 'target_busy',
      duplicate: false,
      receipt: expect.stringMatching(/^[a-f0-9]{64}$/),
      createdAdults: 0,
    })
    expect(await readOperationalSubmission(db, 'b'.repeat(64))).toMatchObject({
      state: 'retryable',
      code: 'target_busy',
      receipt: blocked.receipt,
      createdAdults: 0,
    })
    expect(mutations).toHaveLength(0)
    expect(adults).toHaveLength(0)
    expect(locks()).toMatchObject([{ target_id: 7, link_hash: linkHash }])
  } finally {
    release()
    firstResult = await first
  }
  expect(firstResult).toMatchObject({ state: 'complete', duplicate: false, createdAdults: 1 })
  expect(locks()).toHaveLength(0)
  expect((await submit({ participants: [person()] })).state).toBe('complete')
  expect((await other()).state).toBe('complete')
  expect(adults).toHaveLength(1)
  expect(mutations.filter((m) => m.method === 'POST')).toHaveLength(1)
})
test('changed payload after success is refused with original receipt and no mutation', async () => {
  const r = await submit({ participants: [person()] })
  const before = structuredClone(journal()[0])
  const beforeNotes = targets[0].notes
  const changed = await submit({
    participants: [person()],
    referrer: { name: 'Autre personne', email: 'other@example.invalid' },
  })
  expect(changed).toMatchObject({
    state: 'review',
    code: 'payload_changed',
    receipt: r.receipt,
    duplicate: true,
    createdAdults: 1,
  })
  expect(journal()[0]).toEqual(before)
  expect(targets[0].notes).toBe(beforeNotes)
  expect(await readOperationalSubmission(db, linkHash)).toMatchObject({
    state: 'complete',
    code: 'saved',
    receipt: r.receipt,
    createdAdults: 1,
  })
  expect(adults).toHaveLength(1)
  expect(mutations).toHaveLength(2)
})
test('read failure before any mutation is retryable, releases lock, and resumes safely', async () => {
  mode = 'read-failed'
  expect(await submit()).toMatchObject({ state: 'retryable', code: 'read_failed' })
  expect(journal()[0].state).toBe('retryable')
  expect(locks()).toHaveLength(0)
  mode = ''
  expect((await submit()).state).toBe('complete')
  expect(mutations).toHaveLength(1)
})
test.each([
  'adult-timeout-before',
  'adult-timeout-after',
  'adult-readback-failed',
  'adult-unlinked',
  'patch-timeout-before',
  'patch-timeout-after',
  'patch-dropped',
])('uncertainty %s persists lock and is never automatically retried', async (fault) => {
  mode = fault
  const r = await submit({ participants: fault.startsWith('adult') ? [person()] : [] })
  expect(r).toMatchObject({ state: 'review', code: 'write_uncertain' })
  expect(locks()).toHaveLength(1)
  const before = mutations.length
  mode = ''
  expect((await submit({ participants: fault.startsWith('adult') ? [person()] : [] })).code).toBe(
    'write_uncertain',
  )
  expect(mutations).toHaveLength(before)
  expect(await submit({}, { linkHash: 'b'.repeat(64) })).toMatchObject({
    state: 'retryable',
    code: 'target_busy',
  })
  expect(mutations).toHaveLength(before)
})
test('partial adult write records first ID and stops before participation; no rollback or replay', async () => {
  mode = 'second-adult-timeout'
  const people = [person(), person({ firstName: 'Bob', email: 'bob@example.invalid' })]
  const r = await submit({ participants: people })
  expect(r).toMatchObject({ state: 'review', code: 'write_uncertain', createdAdults: 1 })
  expect(JSON.parse(journal()[0].adult_ids)).toEqual([100])
  expect(targets[0].notes).toBe('Note humaine')
  mode = ''
  await submit({ participants: people })
  expect(adults).toHaveLength(1)
  expect(mutations.filter((m) => m.method === 'PATCH')).toHaveLength(0)
})
test('existing adult no-op retains email, function and status, never marks formed', async () => {
  adults = [
    {
      Id: 50,
      adulte_id: 'EXISTING',
      prenom: 'Alice',
      nom: 'Exemple',
      email: 'alice@example.invalid',
      fonction: 'Ancienne fonction',
      statut: 'Prévu',
      participations_id: 7,
    },
  ]
  const r = await submit({ participants: [person()] })
  expect(r.createdAdults).toBe(0)
  expect(adults[0].statut).toBe('Prévu')
  expect(mutations).toHaveLength(1)
})
test('ambiguous adult prevents all adult creations and retains full declaration for review', async () => {
  adults = [
    {
      Id: 50,
      prenom: 'Alice',
      nom: 'Exemple',
      email: 'different@example.invalid',
      participations_id: 7,
    },
  ]
  const r = await submit({
    participants: [person(), person({ firstName: 'Bob', email: 'bob@example.invalid' })],
  })
  expect(r).toMatchObject({ state: 'review', code: 'participants_ambiguous', createdAdults: 0 })
  expect(adults).toHaveLength(1)
  expect(readContact(targets[0].notes).operationalSubmissions[0].data.participants).toHaveLength(2)
  expect(locks()).toHaveLength(0)
})
test.each(['notes', 'date', 'adult'])('reread catches %s changes before mutation', async (what) => {
  hook = ({ table, id, reads: r }) => {
    if (table === NC.tables.participations && id === 7 && r > 4) {
      hook = null
      if (what === 'notes') targets[0].notes = 'Concurrent team edit'
      if (what === 'date') targets[0].date_debut_formation = '2030-12-01'
      if (what === 'adult')
        adults.push({ Id: 51, prenom: 'Bob', nom: 'Exemple', participations_id: 7 })
    }
  }
  expect(await submit()).toMatchObject({ state: 'retryable', code: 'concurrent_change' })
  expect(mutations).toHaveLength(0)
  expect(locks()).toHaveLength(0)
})
test('concurrent change after first adult retains partial journal and durable lock', async () => {
  hook = ({ table, id }) => {
    if (table === OPERATIONAL_ADULTS_TABLE && adults.length && !id) {
      targets[0].notes = 'Manual edit after adult'
      hook = null
    }
  }
  expect((await submit({ participants: [person()] })).code).toBe('write_uncertain')
  expect(mutations.filter((m) => m.method === 'PATCH')).toHaveLength(0)
  expect(locks()).toHaveLength(1)
  expect(JSON.parse(journal()[0].adult_ids)).toEqual([100])
})
test('participants-only neither marks contact received nor changes training fields', async () => {
  const r = await submit({ formation: null, participants: [person()] }, { kind: 'participants' })
  expect(r.state).toBe('complete')
  expect(targets[0].fiche_contact_recue).toBe(false)
  expect(targets[0].date_debut_formation).toBeNull()
  expect(readContact(targets[0].notes).receivedAt).toBeNull()
})
test('deployment does not fabricate contact receipt', async () => {
  expect(
    (
      await submit(
        {
          organizationConfirmed: true,
          changesAcknowledged: true,
          declaredTrainers: [{ name: 'Formatrice Exemple', email: 'trainer@example.invalid' }],
        },
        { kind: 'deploiement' },
      )
    ).state,
  ).toBe('complete')
  expect(targets[0].statut_formation).toBe('Programmée')
  expect(targets[0].fiche_contact_recue).toBe(false)
})
test('historical contradictions persist, new declaration visible without changing dates or adults', async () => {
  targets[0].notes = writeContact('Human note', {
    version: 1,
    source: { spreadsheetId: 'fictional', rows: [7, 9], readAt: '2030-09-23T10:00:00.123456Z' },
    receivedAt: '2030-09-22T10:00:00+02:00',
    sourceResponses: [{ row: 7 }, { row: 9 }],
    formation: {
      start: '2030-12-01',
      end: '2030-02-01',
      kind: 'previsionnelle',
      format: '',
      planning: '',
      issues: ['Multi-source contradiction'],
      validationSource: 'Human check',
    },
    declaredTrainers: [],
    participants: {
      declared: 'Alice Exemple',
      unresolved: [],
      importedCount: 0,
      identityNotes: ['Validated'],
    },
  })
  const r = await submit({ participants: [person()] })
  expect(r.code).toBe('historical_issues')
  expect(adults).toHaveLength(0)
  expect(targets[0].date_debut_formation).toBeNull()
  const n = readContact(targets[0].notes)
  expect(n.sourceResponses).toHaveLength(2)
  expect(n.formation.issues).toContain('Multi-source contradiction')
  expect(n.participants.identityNotes).toEqual(['Validated'])
  sql
    .query("UPDATE operational_link_slots SET token_hash=? WHERE kind='contact'")
    .run('b'.repeat(64))
  expect((await submit({}, { linkHash: 'b'.repeat(64) })).state).toBe('review')
  expect(targets[0].date_debut_formation).toBeNull()
})
test('malformed notes fail before any mutation', async () => {
  targets[0].notes = '[EUNEOS_CONTACT_V1]broken[/EUNEOS_CONTACT_V1]'
  await expect(submit({ participants: [person()] })).rejects.toMatchObject({
    status: 409,
    code: 'notes_invalid',
  })
  expect(mutations).toHaveLength(0)
})
test('list is capped at 100 technical records with no personal or secret fields', async () => {
  for (let i = 0; i < 110; i++)
    sql
      .query(
        "INSERT INTO operational_submissions(link_hash,payload_hash,target_id,school_id,cohort_id,kind,receipt,state,code,created_at,updated_at) VALUES (?,?,7,1,2,'contact',?,'review','test',?,?)",
      )
      .run(String(i), String(i), 'receipt' + i, '2030-09-23T00:00:00Z', '2030-09-23T00:00:00Z')
  const list = await listOperationalSubmissions(db)
  expect(list).toHaveLength(100)
  expect(Object.keys(list[0]).sort()).toEqual(
    ['participationId', 'kind', 'state', 'code', 'createdAt'].sort(),
  )
})

test('rotated link is refused under lock even if authentication resolved before rotation', async () => {
  sql
    .query("UPDATE operational_link_slots SET token_hash=? WHERE kind='contact'")
    .run('b'.repeat(64))
  await expect(submit({ participants: [person()] })).rejects.toMatchObject({
    status: 409,
    code: 'link_renewed',
  })
  expect(mutations).toHaveLength(0)
  expect(locks()).toHaveLength(0)
})
test('17 adults and 200 adults remain within a free Worker external-request budget', async () => {
  for (const size of [17, 200]) {
    const people = Array.from({ length: size }, (_, i) =>
      person({ firstName: 'Personne' + i, email: `participant${i}@example.invalid` }),
    )
    const key = (size === 17 ? 'a' : 'b').repeat(64)
    sql.query("UPDATE operational_link_slots SET token_hash=? WHERE kind='contact'").run(key)
    const before = reads + mutations.length
    const r = await submit({ participants: people }, { linkHash: key })
    expect(r.state).toBe('complete')
    expect(reads + mutations.length - before).toBeLessThan(40)
    expect(mutations.filter((m) => m.method === 'POST').at(-1).bodies.length).toBe(
      size === 17 ? 17 : 183,
    )
  }
  expect(adults).toHaveLength(200)
})
test('pagination reads complete existing adult set, including matches outside first page', async () => {
  pageSize = 1
  adults = [
    { Id: 50, prenom: 'Bob', nom: 'Exemple', email: 'bob@example.invalid', participations_id: 7 },
    {
      Id: 51,
      prenom: 'Alice',
      nom: 'Exemple',
      email: 'alice@example.invalid',
      participations_id: 7,
    },
  ]
  expect((await submit({ participants: [person()] })).createdAdults).toBe(0)
  expect(mutations.filter((m) => m.method === 'POST')).toHaveLength(0)
})
test('journal failure before remote write creates no adult or participation', async () => {
  const real = db,
    broken = {
      prepare: (q) => ({
        bind: (...v) => {
          const b = real.prepare(q).bind(...v)
          return {
            ...b,
            run: async () => {
              if (q.includes('mutation_started=1')) throw new Error('D1 unavailable')
              return b.run()
            },
          }
        },
      }),
    }
  expect(await submit({ participants: [person()] }, { db: broken })).toMatchObject({
    state: 'retryable',
    code: 'read_failed',
  })
  expect(mutations).toHaveLength(0)
})
test('journal failure after adult write keeps target locked and never repeats batch', async () => {
  const real = db,
    broken = {
      prepare: (q) => ({
        bind: (...v) => {
          const b = real.prepare(q).bind(...v)
          return {
            ...b,
            run: async () => {
              if (q.startsWith('UPDATE operational_submissions SET adult_ids='))
                throw new Error('D1 lost after NocoDB')
              return b.run()
            },
          }
        },
      }),
    }
  const r = await submit({ participants: [person()] }, { db: broken })
  expect(r).toMatchObject({ state: 'review', code: 'write_uncertain', createdAdults: 1 })
  expect(locks()).toHaveLength(1)
  await submit({ participants: [person()] })
  expect(adults).toHaveLength(1)
  expect(mutations).toHaveLength(1)
})
test('orphan processing marker never expires into automatic retry', async () => {
  sql
    .query(
      "INSERT INTO operational_submission_locks(target_id,link_hash,acquired_at) VALUES (7,?,'2000-01-01T00:00:00Z')",
    )
    .run('c'.repeat(64))
  expect(await submit()).toMatchObject({ state: 'retryable', code: 'target_busy' })
  expect(mutations).toHaveLength(0)
  expect(locks()).toHaveLength(1)
})
