import { test, expect } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { sealAgenda, openAgenda } from '../scripts/lib/agenda-envelope'
import { processAgendaRequest } from '../scripts/agenda-sync-ci'
import { readFileSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import type { WorkspaceDatabase } from '../src/lib/internal-workspace'
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
test('encrypted transport roundtrips without exposing content and rejects altered data', () => {
  const plain = { title: 'Rencontre privée', people: ['CA'] }
  const envelope = sealAgenda(plain, keys.publicKey)
  expect(JSON.stringify(envelope)).not.toContain('Rencontre')
  expect(openAgenda(envelope, keys.privateKey)).toEqual(plain)
  expect(() =>
    openAgenda({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, keys.privateKey),
  ).toThrow()
})
test('an empty weekly scan records verification without creating fake events or changing decisions', async () => {
  const sql = new Database(':memory:')
  sql.exec(readFileSync('migrations/interne/0028_event_agenda.sql', 'utf8'))
  const db: WorkspaceDatabase = {
    prepare(q) {
      return {
        bind(...v) {
          return {
            all: async <T>() => ({ results: sql.query(q).all(...(v as any[])) as T[] }),
            first: async <T>() => sql.query(q).get(...(v as any[])) as T | null,
            run: async () => ({ meta: { changes: sql.query(q).run(...(v as any[])).changes } }),
          }
        },
      }
    },
    batch: async () => [],
  }
  const result = await processAgendaRequest(db, {
    operation: 'import',
    events: [],
    source: {
      messagesCount: 0,
      complete: true,
      windowStart: '2026-11-06',
      windowEnd: '2026-11-13',
    },
  })
  expect(result.events).toEqual([])
  expect(result.checkedAt).toBeTruthy()
  expect(
    sql.query('SELECT newsletters_count,events_count FROM event_agenda_sync_runs').get(),
  ).toEqual({ newsletters_count: 0, events_count: 0 })
  await expect(processAgendaRequest(db, { operation: 'delete', events: [] })).rejects.toThrow()
  expect((await processAgendaRequest(db, { operation: 'list' })).events).toEqual([])
  sql.close()
})
