import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import {
  saveWatch,
  listWatch,
  deleteWatch,
  parseWatchFacts,
  watchUsed,
  currentWatchWeek,
} from '../src/lib/thematic-watch'
import { listAgenda } from '../src/lib/event-agenda'
import type { WorkspaceDatabase } from '../src/lib/internal-workspace'
const selection = JSON.parse(readFileSync('drafts/veille-2026-11-09.json', 'utf8'))
export function watchFixture() {
  const sql = new Database(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const file of ['0028_event_agenda.sql', '0029_thematic_watch.sql'])
    sql.exec(readFileSync('migrations/interne/' + file, 'utf8'))
  const db: WorkspaceDatabase = {
    prepare(q) {
      return {
        bind(...v: any[]) {
          return {
            all: async <T>() => ({ results: sql.query(q).all(...v) as T[] }),
            first: async <T>() => sql.query(q).get(...v) as T | null,
            run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
            execute: () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
          }
        },
      }
    },
    batch: async (s: any[]) => sql.transaction(() => s.map((x) => x.execute()))(),
  }
  return { sql, db }
}
const facts = (index = 0) => ({ ...selection.items[index], week: selection.week })
const auto = { automated: true, provenance: 'recherche web', today: '2026-11-13' }
test('initial seven sources validate, are idempotent across weeks without writing to the agenda', async () => {
  const { db, sql } = watchFixture()
  for (const f of selection.items)
    await saveWatch(db, { ...f, week: selection.week }, 'agent', auto)
  for (const f of selection.items)
    expect((await saveWatch(db, { ...f, week: '2026-11-16' }, 'agent', auto)).skipped).toBe(true)
  expect(await listWatch(db)).toHaveLength(7)
  expect(await listAgenda(db)).toHaveLength(0)
  sql.close()
})
test('human authorship and statuses survive import; old links stay blocked after editing and deletion', async () => {
  const { db, sql } = watchFixture()
  const { id } = await saveWatch(db, facts(), 'pauline@example.test')
  let [item] = await listWatch(db)
  expect(item.provenance).toBe('ajout manuel')
  expect(item.author).toBe('pauline@example.test')
  await saveWatch(
    db,
    {
      ...item,
      title: 'Titre relu',
      link: 'https://example.test/changed',
      usages: [{ name: 'Post LinkedIn', status: 'fait', draft: 'Texte relu' }],
    },
    'charlotte@example.test',
    { id, version: 1, today: '2026-11-13' },
  )
  expect(
    (await saveWatch(db, { ...facts(), link: facts().link + '?utm_source=x' }, 'agent', auto))
      .skipped,
  ).toBe(true)
  ;[item] = await listWatch(db)
  expect(item.title).toBe('Titre relu')
  expect(item.usages[0].status).toBe('fait')
  expect(item.protected).toBe(1)
  await deleteWatch(db, id, 2, 'pauline@example.test')
  expect(await listWatch(db)).toHaveLength(0)
  expect((await saveWatch(db, facts(), 'agent', auto)).skipped).toBe(true)
  sql.close()
})
test('concurrent stale edit and delete fail without losing the current version', async () => {
  const { db, sql } = watchFixture()
  const { id } = await saveWatch(db, facts(), 'pauline', auto)
  const [item] = await listWatch(db)
  await saveWatch(db, { ...item, summary: 'Version équipe' }, 'team', {
    id,
    version: 1,
    today: '2026-11-13',
  })
  await expect(
    saveWatch(db, { ...item, title: 'Périmé' }, 'team', { id, version: 1, today: '2026-11-13' }),
  ).rejects.toMatchObject({ status: 409 })
  await expect(deleteWatch(db, id, 1, 'team')).rejects.toMatchObject({ status: 409 })
  expect((await listWatch(db))[0].summary).toBe('Version équipe')
  sql.close()
})
test('usage statuses remain independent; adding or removing usages never publishes', () => {
  const f = parseWatchFacts(facts(), true, '2026-11-13')
  expect(watchUsed(f)).toBe(false)
  expect(
    watchUsed({
      usages: [
        { name: 'Post LinkedIn', status: 'fait', draft: '' },
        { name: 'Encart newsletter', status: 'brouillon', draft: '' },
      ],
    }),
  ).toBe(false)
  expect(watchUsed({ usages: [] })).toBe(false)
  expect(watchUsed({ usages: [{ name: 'Post LinkedIn', status: 'abandonné', draft: '' }] })).toBe(
    true,
  )
  expect(currentWatchWeek('2026-11-15')).toBe('2026-11-09')
})
test('watch event usage and metadata never write to the agenda', async () => {
  const { db, sql } = watchFixture()
  sql.exec("CREATE TRIGGER reject_event BEFORE INSERT ON event_agenda BEGIN SELECT RAISE(ABORT,'test'); END")
  const { id } = await saveWatch(db, facts(3), 'agent', auto)
  const [item] = await listWatch(db)
  await saveWatch(db, { ...item, event: { ...item.event, interest: 'Texte modifié' } }, 'team', { id, version: 1, today: '2026-11-13' })
  expect(await listAgenda(db)).toHaveLength(0)
  expect(await listWatch(db)).toHaveLength(1)
  sql.close()
})
test('reject bad URLs, old unsourced imports, fabricated statuses, duplicates and unsupported event locations', () => {
  expect(() => parseWatchFacts({ ...facts(), link: 'javascript:alert(1)' })).toThrow()
  expect(() =>
    parseWatchFacts({ ...facts(), published_on: '2026-01-01' }, true, '2026-11-13'),
  ).toThrow()
  expect(() =>
    parseWatchFacts(
      { ...facts(), usages: [{ name: 'Post LinkedIn', status: 'fait' }] },
      true,
      '2026-11-13',
    ),
  ).toThrow()
  expect(() =>
    parseWatchFacts({ ...facts(), usages: [{ name: 'Événement', status: 'à faire' }] }),
  ).not.toThrow()
  expect(() =>
    parseWatchFacts({
      ...facts(3),
      event: { ...facts(3).event, modality: 'présentiel', region: 'Bretagne', city: 'Rennes' },
    }),
  ).toThrow()
})

test('fusion preserves every legacy field and trash, protects edits and blocks repeat imports', async () => {
  const {db,sql}=watchFixture()
  for(const file of ['0019_communication_tables.sql','0025_communication_trash.sql'])sql.exec(readFileSync('migrations/interne/'+file,'utf8'))
  const columns=['Nom','Type','Lien','Tags','Date publication','Notes','Date de la ressource']
  sql.query('INSERT INTO communication_sheets VALUES(?,?,?,?,?,?)').run('legacy-sheet','veille','Feuille 1',JSON.stringify(columns),0,0)
  const cells=['Ancienne ressource test','Podcast','https://example.test/legacy?utm_source=a','Éducation, Gestion émotions','','Note rédigée par l’équipe.','2026-06-04']
  for(const [id,deleted]of [['legacy',''],['trashed','2026-11-10']])sql.query('INSERT INTO communication_rows(id,sheet_id,cells_json,version,updated_by,deleted_at) VALUES(?,?,?,?,?,?)').run(id,'legacy-sheet',JSON.stringify(id==='legacy'?cells:['Ressource supprimée',cells[1],'https://example.test/deleted',...cells.slice(3)]),3,'auteur historique',deleted)
  const before=sql.query('SELECT * FROM communication_rows ORDER BY id').all()
  sql.exec(readFileSync('migrations/interne/0030_merge_legacy_watch.sql','utf8'))
  expect(sql.query('SELECT * FROM communication_rows ORDER BY id').all()).toEqual(before)
  const [item]=await listWatch(db);expect(item.title).toBe(cells[0]);expect(item.for_euneos).toBe(cells[5]);expect(item.published_on).toBe(cells[6]);expect(item.legacy?.cells).toEqual(cells);expect(item.protected).toBe(1);expect(item.version).toBe(3);expect(item.usages).toEqual([])
  expect(await listWatch(db,true)).toHaveLength(2)
  expect((await saveWatch(db,{...facts(),title:'Autre titre',link:'https://example.test/legacy?utm_source=b'},'agent',auto)).skipped).toBe(true)
  expect((await saveWatch(db,{...facts(),link:'https://example.test/deleted'},'agent',auto)).skipped).toBe(true)
  await saveWatch(db,{...item,summary:'Résumé relu',legacy:{cells:['corrompu']}},'équipe',{id:item.id,version:3,today:'2026-11-13'})
  expect((await listWatch(db))[0].legacy?.cells).toEqual(cells)
  sql.close()
})
