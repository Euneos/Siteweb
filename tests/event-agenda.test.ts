import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import type { WorkspaceDatabase } from '../src/lib/internal-workspace'
import { readFileSync } from 'node:fs'
import {
  agendaMonths,
  parseEventFacts,
  importAgendaEvent,
  listAgenda,
  decideAgendaEvent,
  registrationLink,
  removeAgendaEvent,
} from '../src/lib/event-agenda'
import { agendaPreviewFacts } from '../scripts/lib/event-agenda-preview'
function fixture() {
  const sql = new Database(':memory:')
  sql.exec(readFileSync('migrations/interne/0028_event_agenda.sql', 'utf8'))
  const db: WorkspaceDatabase = {
    prepare(q: string) {
      return {
        bind(...v: any[]) {
          return {
            all: async <T>() => ({ results: sql.query(q).all(...v) as T[] }),
            first: async <T>() => sql.query(q).get(...v) as T | null,
            run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
          }
        },
      }
    },
    batch: async () => [],
  }
  return { sql, db }
}
const facts = agendaPreviewFacts('2026-11-12')[0]
test('imports deduplicate newsletters while human status and attendance survive refreshed facts', async () => {
  const { sql, db } = fixture()
  const id = await importAgendaEvent(
    db,
    { ...facts, status: 'confirmé', attendance: ['CA'] },
    undefined,
    '2026-11-12',
  )
  let [e] = await listAgenda(db)
  expect(e.status).toBe('à décider')
  expect(e.attendance).toEqual([])
  await decideAgendaEvent(
    db,
    id,
    { status: 'rejeté', attendance: ['Pauline', 'CA'], version: e.version },
    'team@example.test',
  )
  await importAgendaEvent(
    db,
    {
      ...facts,
      interest: 'Intérêt précisé',
      sources: ['Autre newsletter'],
      status: 'confirmé',
      attendance: [],
    },
    undefined,
    '2026-11-12',
  )
  ;[e] = await listAgenda(db)
  expect(await listAgenda(db)).toHaveLength(1)
  expect(e.status).toBe('rejeté')
  expect(e.attendance).toEqual(['Pauline', 'CA'])
  expect(e.sources).toHaveLength(2)
  expect(e.interest).toBe('Intérêt précisé')
  sql.close()
})
test('normalized registration link matches reworded announcement and tracking cannot create duplicates', async () => {
  const { sql, db } = fixture()
  await importAgendaEvent(
    db,
    { ...facts, registration_url: 'https://example.test/event?id=1&utm_source=a' },
    undefined,
    '2026-11-12',
  )
  await importAgendaEvent(
    db,
    {
      ...facts,
      title: 'Autre formulation',
      registration_url: 'https://example.test/event?utm_source=b&id=1',
    },
    undefined,
    '2026-11-12',
  )
  expect(await listAgenda(db)).toHaveLength(1)
  expect(registrationLink('https://example.test/?utm_source=a&id=1#x')).toBe(
    'https://example.test/?id=1',
  )
  sql.close()
})
test('rejects past or impossible dates, off-region in-person events and unsafe links', () => {
  for (const change of [
    { starts_on: '2026-11-11' },
    { starts_on: '2027-02-30' },
    { region: 'Bretagne' },
    { pillars: [] },
    { registration_url: 'javascript:alert(1)' },
  ])
    expect(() => parseEventFacts({ ...facts, ...change }, '2026-11-12')).toThrow()
  expect(
    parseEventFacts({ ...facts, modality: 'en ligne', region: 'Bretagne' }, '2026-11-12').region,
  ).toBe('En ligne')
  expect(agendaMonths('2026-11-12').map((m) => m.key)).toHaveLength(13)
  expect(agendaMonths('2026-11-12').at(-1)?.key).toBe('2027-11')
})
test('team decisions use optimistic concurrency and do not change source facts', async () => {
  const { sql, db } = fixture()
  const id = await importAgendaEvent(db, facts, undefined, '2026-11-12')
  await decideAgendaEvent(
    db,
    id,
    { status: 'confirmé', attendance: ['Candice'], version: 1 },
    'team@example.test',
  )
  await expect(
    decideAgendaEvent(
      db,
      id,
      { status: 'rejeté', attendance: [], version: 1 },
      'other@example.test',
    ),
  ).rejects.toThrow()
  await expect(
    decideAgendaEvent(
      db,
      id,
      { status: 'confirmé', attendance: ['Unknown'], version: 2 },
      'team@example.test',
    ),
  ).rejects.toThrow()
  expect((await listAgenda(db))[0].title).toBe(facts.title)
  sql.close()
})

test('an unchanged repeated newsletter is a no-op, preserving version and decision timestamps', async () => {
  const { sql, db } = fixture()
  const id = await importAgendaEvent(db, facts, undefined, '2026-11-12')
  const before = (await listAgenda(db))[0]
  await importAgendaEvent(db, facts, undefined, '2026-11-12')
  const after = (await listAgenda(db))[0]
  expect(after.id).toBe(id)
  expect(after.version).toBe(before.version)
  expect(after.updated_at).toBe(before.updated_at)
  sql.close()
})

test('trash hides a manual event, prevents automatic reappearance and can restore its decisions', async () => {
  const { sql, db } = fixture()
  const id = await importAgendaEvent(db, facts, undefined, '2026-11-12')
  await decideAgendaEvent(
    db,
    id,
    { version: 1, status: 'confirmé', attendance: ['CA'] },
    'team@example.test',
  )
  await removeAgendaEvent(db, id, 2, 'team@example.test')
  expect(await listAgenda(db)).toEqual([])
  await importAgendaEvent(
    db,
    { ...facts, interest: 'Un nouvel envoi de la newsletter' },
    undefined,
    '2026-11-12',
  )
  expect(await listAgenda(db)).toEqual([])
  const [hidden] = await listAgenda(db, true)
  expect(hidden.deleted_at).toBeTruthy()
  await removeAgendaEvent(db, id, hidden.version, 'team@example.test', true)
  expect((await listAgenda(db))[0].attendance).toEqual(['CA'])
  expect((await listAgenda(db))[0].status).toBe('confirmé')
  sql.close()
})
