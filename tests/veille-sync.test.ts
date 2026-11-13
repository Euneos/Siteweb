import { test, expect } from 'bun:test'
import { watchD1 } from '../scripts/lib/watch-d1'
import { processWatchRequest } from '../scripts/veille-sync-ci'
import { watchFixture } from './thematic-watch.test'
import { readFileSync } from 'node:fs'
const selection = JSON.parse(readFileSync('drafts/veille-2026-11-09.json', 'utf8'))
test('encrypted watch import is insert-only and cannot change agenda facts', async () => {
  const { db, sql } = watchFixture()
  const item = {
    ...selection.items[0],
    week: selection.week,
    provenance: 'LinkedIn',
    published_on: new Date().toISOString().slice(0, 10),
  }
  await processWatchRequest(db, { operation: 'import', items: [item] })
  const result = await processWatchRequest(db, {
    operation: 'import',
    items: [{ ...item, summary: 'Do not overwrite' }],
  })
  expect(result.results[0].skipped).toBe(true)
  expect(result.items[0].summary).toBe(item.summary)
  expect(sql.query('SELECT count(*) n FROM event_agenda').get()).toEqual({ n: 0 })
  await expect(
    processWatchRequest(db, { operation: 'import', items: [{ ...item, event: {} }] }),
  ).rejects.toThrow()
})
test('watch D1 batch escapes values and keeps quoted question marks literal in one request', async () => {
  let payload: any
  const fetcher = async (_url: any, options: any) => {
    payload = JSON.parse(options.body)
    return new Response(
      JSON.stringify({
        success: true,
        result: [{ meta: { changes: 1 } }, { meta: { changes: 1 } }],
      }),
    )
  }
  const db = watchD1('account', 'database', 'token', fetcher as typeof fetch)
  const a = db.prepare("INSERT INTO a(v,n) VALUES(?, '?')").bind("Robert'); DROP TABLE a;--")
  const b = db.prepare('INSERT INTO b(v) VALUES(?)').bind(null)
  await db.batch([a, b])
  expect(payload.sql).toBe(
    "INSERT INTO a(v,n) VALUES('Robert''); DROP TABLE a;--', '?');\nINSERT INTO b(v) VALUES(NULL)",
  )
  await expect(db.batch([{} as any])).rejects.toThrow()
})
