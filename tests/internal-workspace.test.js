import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import {
  saveEntry,
  listEntries,
  hoursByPerson,
  addComment,
  comments,
  parseEntry,
  safeLink,
} from '../src/lib/internal-workspace'
import { readInternalBody, internalError } from '../src/lib/internal-context'

const connections = []
const fixture = () => {
  const sql = new Database(':memory:')
  connections.push(sql)
  sql.exec('PRAGMA foreign_keys = ON')
  const migrations = new URL('../migrations/interne/', import.meta.url)
  for (const file of readdirSync(migrations)
    .filter((name) => /^\d.*\.sql$/.test(name))
    .sort())
    sql.transaction(() => sql.exec(readFileSync(new URL(file, migrations), 'utf8')))()
  const db = {
    prepare(query) {
      return {
        bind(...values) {
          const s = sql.query(query)
          return {
            all: async () => ({ results: s.all(...values) }),
            first: async () => s.get(...values),
            run: async () => ({ meta: { changes: s.run(...values).changes } }),
          }
        },
      }
    },
  }
  return { db, sql }
}
afterEach(() => {
  for (const db of connections.splice(0)) db.close()
})
const actor = { email: 'member@example.test', admin: false }
const admin = { email: 'manager@example.test', admin: true }
const entry = (extra = {}) => ({
  kind: 'equipe',
  title: 'Coordination',
  starts_on: '2026-09-17',
  ends_on: '2026-09-17',
  person: actor.email,
  activity: 'Coordination',
  channel: '',
  status: 'a_valider',
  hours: 3,
  notes: '',
  content: '',
  link: '',
  ...extra,
})

describe('Calendriers et commentaires persistants', () => {
  test.each(['en_cours', 'a_creer', 'a_modifier'])(
    'le statut %s est réservé aux fiches éditoriales',
    async (status) => {
      const { db } = fixture()
      await expect(saveEntry(db, actor, entry({ status }))).rejects.toMatchObject({ status: 400 })
      const id = await saveEntry(db, actor, entry({ kind: 'editorial', status, hours: null }))
      expect(
        (await listEntries(db, '2026-09', 'editorial')).find((row) => row.id === id).status,
      ).toBe(status)
    },
  )
  test('le statut Programmé persiste dans le schéma SQL migré, sans effacer canal et activité historiques', async () => {
    const { db, sql } = fixture()
    const initial = entry({
      kind: 'editorial',
      channel: 'Réseau historique',
      activity: 'Communication',
      hours: null,
    })
    const id = await saveEntry(db, actor, initial)
    await saveEntry(
      db,
      actor,
      { ...initial, status: 'programme', notes: 'Contenu planifié' },
      id,
      1,
    )
    const [saved] = await listEntries(db, '2026-09', 'editorial')
    expect(saved).toMatchObject({
      id,
      status: 'programme',
      channel: 'Réseau historique',
      activity: 'Communication',
      notes: 'Contenu planifié',
      version: 2,
    })
    expect(sql.query('SELECT status,channel FROM workspace_entries WHERE id=?').get(id)).toEqual({
      status: 'programme',
      channel: 'Réseau historique',
    })
    expect(() =>
      sql.query("UPDATE workspace_entries SET status='inconnu' WHERE id=?").run(id),
    ).toThrow()
  })
  test('une même adresse ne divise pas les totaux selon sa casse ; un congé sans heures peut traverser un mois', async () => {
    const { db } = fixture()
    await saveEntry(db, admin, entry({ person: 'MEMBER@example.test', hours: 2 }))
    await saveEntry(db, actor, entry({ hours: 1 }))
    expect(hoursByPerson(await listEntries(db, '2026-09', 'equipe'))).toEqual([
      { person: actor.email, declared: 3, approved: 0 },
    ])
    expect(() => parseEntry(entry({ person: 'Prénom seulement' }))).toThrow('adresse email')
    expect(
      parseEntry(
        entry({ starts_on: '2026-08-30', ends_on: '2026-09-02', hours: 0, attendance: 'conge' }),
      ).hours,
    ).toBe(0)
  })
  test('création idempotente, auteur signé et contrôle des versions concurrentes', async () => {
    const { db } = fixture()
    const request = crypto.randomUUID()
    const id = await saveEntry(db, actor, entry(), undefined, undefined, request)
    expect(await saveEntry(db, actor, entry(), undefined, undefined, request)).toBe(id)
    expect((await listEntries(db, '2026-09', 'equipe')).length).toBe(1)
    await expect(
      saveEntry(db, actor, entry({ hours: 8 }), undefined, undefined, request),
    ).rejects.toMatchObject({ status: 409 })
    await saveEntry(db, actor, entry({ hours: 4 }), id, 1)
    await expect(saveEntry(db, actor, entry({ hours: 9 }), id, 1)).rejects.toMatchObject({
      status: 409,
    })
    const [saved] = await listEntries(db, '2026-09', 'equipe')
    expect(saved.hours).toBe(4)
    expect(saved.version).toBe(2)
    expect(saved.updated_by).toBe(actor.email)
  })
  test('un membre ne peut modifier les heures d’un autre ni les approuver', async () => {
    const { db } = fixture()
    const id = await saveEntry(db, actor, entry())
    await expect(
      saveEntry(db, { email: 'other@example.test', admin: false }, entry(), id, 1),
    ).rejects.toMatchObject({ status: 403 })
    await expect(saveEntry(db, actor, entry({ status: 'valide' }), id, 1)).rejects.toMatchObject({
      status: 403,
    })
    await saveEntry(db, admin, entry({ status: 'valide' }), id, 1)
    await expect(
      saveEntry(db, actor, entry({ status: 'valide', hours: 5 }), id, 2),
    ).rejects.toMatchObject({ status: 403 })
    await saveEntry(db, actor, entry({ status: 'a_valider', hours: 5 }), id, 2)
    expect((await listEntries(db, '2026-09', 'equipe'))[0].status).toBe('a_valider')
  })
  test('les heures restent distinctes des publications et annulations', async () => {
    const { db } = fixture()
    await saveEntry(db, actor, entry())
    await saveEntry(db, admin, entry({ status: 'valide', hours: 2 }))
    await saveEntry(db, actor, entry({ status: 'annule', hours: 12 }))
    await saveEntry(db, actor, entry({ kind: 'editorial', channel: 'LinkedIn', hours: 9 }))
    expect(hoursByPerson(await listEntries(db, '2026-09', 'equipe'))).toEqual([
      { person: actor.email, declared: 5, approved: 2 },
    ])
    expect((await listEntries(db, '2026-09', 'editorial'))[0].hours).toBeNull()
  })
  test('les plages chevauchantes apparaissent, sans répartir arbitrairement les heures', async () => {
    const { db } = fixture()
    await saveEntry(
      db,
      actor,
      entry({ starts_on: '2026-08-30', ends_on: '2026-09-02', hours: null, activity: 'Congé' }),
    )
    expect((await listEntries(db, '2026-09', 'equipe')).length).toBe(1)
    expect((await listEntries(db, '2026-10', 'equipe')).length).toBe(0)
    expect(() => parseEntry(entry({ starts_on: '2026-08-30', ends_on: '2026-09-02' }))).toThrow(
      'une fiche par mois',
    )
  })
  test('les commentaires ont un auteur fiable et résistent aux réessais', async () => {
    const { db } = fixture()
    const id = await saveEntry(db, actor, entry())
    const request = crypto.randomUUID()
    await addComment(db, actor, id, 'Point validé pour relecture', request)
    await addComment(db, actor, id, 'Point validé pour relecture', request)
    expect((await comments(db, id)).length).toBe(1)
    expect((await comments(db, id))[0].author).toBe(actor.email)
    await expect(
      addComment(db, admin, id, 'Point validé pour relecture', request),
    ).rejects.toMatchObject({ status: 409 })
    await expect(addComment(db, actor, crypto.randomUUID(), 'absent')).rejects.toMatchObject({
      status: 404,
    })
  })
  test('SQL paramétré et texte intact', async () => {
    const { db } = fixture()
    const title = "L'été'); DROP TABLE workspace_entries; --"
    await saveEntry(db, actor, entry({ title }))
    expect((await listEntries(db, '2026-09', 'equipe'))[0].title).toBe(title)
  })
  test.each([
    { starts_on: '2026-02-31' },
    { ends_on: '2026-09-01' },
    { hours: -1 },
    { hours: Infinity },
    { status: 'arbitraire' },
    { link: 'javascript:alert(1)' },
  ])('refuse les saisies invalides %j', (x) => {
    expect(() => parseEntry(entry(x))).toThrow()
  })
  test('liens externes HTTPS sans identifiant uniquement', () => {
    expect(safeLink('https://drive.google.com/file/d/test/view')).toContain('drive.google.com')
    expect(() => safeLink('https://user:password@example.test')).toThrow()
  })
})
describe('Écritures internes', () => {
  const request = (origin, type = 'application/json', body = '{}') =>
    new Request('https://euneos.fr/api/interne/calendrier', {
      method: 'POST',
      headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': type },
      body,
    })
  test('refuse les requêtes externes et sans origine', async () => {
    for (const origin of [undefined, 'https://evil.example', 'null'])
      await expect(readInternalBody(request(origin))).rejects.toMatchObject({ status: 403 })
    expect(await readInternalBody(request('https://euneos.fr'))).toEqual({})
  })
  test('refuse les corps non JSON, invalides ou volumineux', async () => {
    await expect(
      readInternalBody(request('https://euneos.fr', 'text/plain')),
    ).rejects.toMatchObject({ status: 415 })
    await expect(
      readInternalBody(request('https://euneos.fr', 'application/json', '[]')),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      readInternalBody(request('https://euneos.fr', 'application/json', 'x'.repeat(40001))),
    ).rejects.toMatchObject({ status: 413 })
  })
  test('ne renvoie jamais les détails privés d’une erreur SQL', async () => {
    const response = internalError(new Error('Private SQL credential customer content'))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('credential')
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })
})
