import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { calendrier } from '../scripts/calendrier'
import { d1Http } from '../src/lib/d1-http'

const connections = []
const fixture = () => {
  const sql = new Database(':memory:')
  connections.push(sql)
  sql.exec('PRAGMA foreign_keys = ON')
  const migrations = new URL('../migrations/interne/', import.meta.url)
  for (const file of readdirSync(migrations).filter((name) => /^\d.*\.sql$/.test(name)).sort())
    sql.transaction(() => sql.exec(readFileSync(new URL(file, migrations), 'utf8')))()
  return {
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
    async batch() {
      throw new Error('batch')
    },
  }
}
afterEach(() => {
  for (const db of connections.splice(0)) db.close()
})
const member = { email: 'member@example.test', admin: false }
const run = async (db, args, actor = member) => {
  let out
  await calendrier(db, actor, args, (value) => (out = value))
  return out
}
const equipe = {
  kind: 'equipe', title: 'Coordination', starts_on: '2026-10-15', ends_on: '2026-10-15',
  person: member.email, activity: 'Coordination', channel: '', status: 'a_valider', hours: 3,
  attendance: 'presence', location: '', notes: '', content: '', link: '',
}
const editorial = {
  kind: 'editorial', title: 'Post LinkedIn', starts_on: '2026-10-20', ends_on: '2026-10-20',
  person: 'Pauline', activity: '', channel: 'LinkedIn', status: 'en_cours', hours: null,
  attendance: '', location: '', notes: '', content: '', link: '',
}

describe('calendrier depuis le poste', () => {
  test('crée, liste, relit et modifie une fiche équipe avec les règles des pages', async () => {
    const db = fixture()
    const created = await run(db, ['creer', JSON.stringify(equipe)])
    expect(created.created_by).toBe(member.email)
    expect(created.version).toBe(1)
    expect((await run(db, ['mois', '2026-10', 'equipe'])).map((e) => e.id)).toEqual([created.id])
    const changed = await run(db, ['modifier', created.id, JSON.stringify({ hours: 5 })])
    expect(changed.hours).toBe(5)
    expect(changed.version).toBe(2)
    expect(await run(db, ['heures', '2026-10'])).toBeTruthy()
  })

  test('déplace une publication éditoriale', async () => {
    const db = fixture()
    const created = await run(db, ['creer', JSON.stringify(editorial)])
    const moved = await run(db, ['deplacer', created.id, '2026-10-22'])
    expect(moved.starts_on).toBe('2026-10-22')
    expect(moved.version).toBe(created.version + 1)
  })

  test('refuse ce que les pages refusent, sans rien écrire', async () => {
    const db = fixture()
    await expect(run(db, ['creer', JSON.stringify({ ...equipe, status: 'inexistant' })])).rejects.toThrow('Statut invalide')
    await expect(run(db, ['creer', 'pas du json'])).rejects.toThrow('objet JSON')
    expect(await run(db, ['mois', '2026-10', 'equipe'])).toEqual([])
  })

  test('interdit de forger la version ou l’auteur', async () => {
    const db = fixture()
    const created = await run(db, ['creer', JSON.stringify(equipe)])
    await expect(run(db, ['modifier', created.id, JSON.stringify({ created_by: 'autre@example.test' })])).rejects.toThrow('ne se modifie pas')
  })
})

describe('accès HTTP à D1', () => {
  test('envoie la requête paramétrée et rend les lignes', async () => {
    const calls = []
    const fake = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization })
      return new Response(JSON.stringify({ success: true, result: [{ results: [{ n: 1 }], meta: { changes: 0 } }] }))
    }
    const db = d1Http('acc', 'dbid', 'tok', fake)
    expect(await db.prepare('SELECT ? AS n').bind(1).first()).toEqual({ n: 1 })
    expect(calls[0].url).toContain('/accounts/acc/d1/database/dbid/query')
    expect(calls[0].body).toEqual({ sql: 'SELECT ? AS n', params: [1] })
    expect(calls[0].auth).toBe('Bearer tok')
  })

  test('remonte l’erreur Cloudflare et refuse la suppression groupée', async () => {
    const fake = async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'Authentication error' }] }), { status: 403 })
    const db = d1Http('acc', 'dbid', 'tok', fake)
    await expect(db.prepare('SELECT 1').bind().all()).rejects.toThrow('Authentication error')
    await expect(db.batch([])).rejects.toThrow('espace interne')
  })
})
