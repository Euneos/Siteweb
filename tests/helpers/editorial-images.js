import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

export function imageFixture() {
  const sql = new Database(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  const dir = new URL('../../migrations/interne/', import.meta.url)
  for (const file of readdirSync(dir)
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort())
    sql.transaction(() => sql.exec(readFileSync(new URL(file, dir), 'utf8')))()
  const db = {
    prepare(query) {
      return {
        bind(...values) {
          const statement = sql.query(query)
          return {
            all: async () => ({ results: statement.all(...values) }),
            first: async () => statement.get(...values),
            run: async () => ({ meta: { changes: statement.run(...values).changes } }),
          }
        },
      }
    },
  }
  const objects = new Map()
  const bucket = {
    failPut: false,
    failDelete: false,
    async put(key, bytes) {
      if (this.failPut) throw new Error('Synthetic R2 failure')
      objects.set(key, bytes.slice())
    },
    async get(key) {
      const bytes = objects.get(key)
      return bytes ? { body: new Blob([bytes]).stream(), size: bytes.length } : null
    },
    async delete(key) {
      if (this.failDelete) throw new Error('Synthetic R2 failure')
      objects.delete(key)
    },
  }
  return { sql, db, bucket, objects }
}
export const syntheticEntry = (extra = {}) => ({
  kind: 'editorial',
  title: 'Visuel de démonstration',
  starts_on: '2026-09-28',
  ends_on: '2026-09-28',
  person: 'member@example.test',
  activity: '',
  channel: 'LinkedIn',
  status: 'en_cours',
  hours: null,
  attendance: '',
  location: '',
  notes: '',
  content: 'Contenu fictif pour la recette locale.',
  link: '',
  ...extra,
})
export const sample = (ext) =>
  new Uint8Array(
    readFileSync(new URL(`../fixtures/editorial-images/sample.${ext}`, import.meta.url)),
  )
