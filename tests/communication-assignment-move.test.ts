import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { mutateCommunicationRows } from '../src/lib/communication-bulk'
import { mapCommunicationCells } from '../src/lib/communication-move'
function fixture() {
  const sql = new Database(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const f of readdirSync('migrations/interne')
    .filter((f) => f.endsWith('.sql') && f < '0027')
    .sort())
    sql.exec(readFileSync('migrations/interne/' + f, 'utf8'))
  const cols = ['Nom', 'Statut', 'Priorité', 'Notes']
  for (const [id, title] of [
    ['p', 'Parrainage'],
    ['t', 'Ma selection - Top 10 Parrainag'],
    ['q', 'Qui parraine quoi'],
  ])
    sql
      .query('INSERT INTO communication_sheets VALUES(?,?,?,?,0,0)')
      .run(id, 'partenariats', title, JSON.stringify(cols))
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [i, sheet] of ['p', 't'].entries()) {
    sql
      .query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)')
      .run(
        ids[i],
        sheet,
        JSON.stringify([
          'Même personne',
          i === 0 ? '' : 'Accepté',
          'A',
          i === 0 ? 'Note source' : 'Note historique TOP',
        ]),
        'fixture',
      )
    sql.query('INSERT INTO communication_partnership_entities VALUES(?,?)').run(ids[i], ids[0])
  }
  sql.exec(readFileSync('migrations/interne/0027_communication_assignment_moves.sql', 'utf8'))
  const db: any = {
    prepare: (q: string) => ({
      bind: (...v: any[]) => ({
        all: async () => ({ results: sql.query(q).all(...v) }),
        first: async () => sql.query(q).get(...v),
        run: async () => {
          sql.query(q).run(...v)
          return { meta: { changes: (sql.query('SELECT changes() n').get() as any).n } }
        },
      }),
    }),
  }
  return { sql, db, ids }
}
test('migration removes duplicate views, preserves source rows and fills only blank statuses', () => {
  const { sql } = fixture()
  expect(sql.query('SELECT id FROM communication_sheets WHERE guide=0').all()).toEqual([
    { id: 'p' },
  ])
  expect((sql.query('SELECT count(*) n FROM communication_rows').get() as any).n).toBe(2)
  const columns = JSON.parse(
    (sql.query("SELECT columns_json FROM communication_sheets WHERE id='p'").get() as any)
      .columns_json,
  )
  const cells = JSON.parse(
    (sql.query("SELECT cells_json FROM communication_rows WHERE sheet_id='p'").get() as any)
      .cells_json,
  )
  expect(columns).toEqual(['Nom', 'Statut', 'Priorité', 'Notes', 'Attribution'])
  expect(cells).toEqual(['Même personne', 'À contacter', 'A', 'Note source', ''])
  expect(
    JSON.parse(
      (sql.query("SELECT cells_json FROM communication_rows WHERE sheet_id='t'").get() as any)
        .cells_json,
    ),
  ).toEqual(['Même personne', 'Accepté', 'A', 'Note historique TOP'])
  sql.close()
})
test('shared partnership attribution creates one task, reassigns it, and ignores note-only edits', () => {
  const { sql, ids } = fixture()
  const save = (cells: string[]) =>
    sql
      .query('UPDATE communication_rows SET cells_json=?,version=version+1 WHERE id=?')
      .run(JSON.stringify(cells), ids[0])
  const cells = ['Même personne', 'À contacter', 'A', 'Note source', 'Pauline']
  save(cells)
  expect(sql.query('SELECT person,status FROM team_tasks').all()).toEqual([
    { person: 'Pauline', status: 'en-cours' },
  ])
  cells[4] = 'Charlotte'
  save(cells)
  expect(sql.query('SELECT person,status FROM team_tasks').all()).toEqual([
    { person: 'Charlotte', status: 'en-cours' },
  ])
  const before = (sql.query('SELECT version FROM team_tasks').get() as any).version
  cells[3] = 'Note modifiée'
  save(cells)
  expect((sql.query('SELECT version FROM team_tasks').get() as any).version).toBe(before)
  expect((sql.query('SELECT count(*) n FROM team_tasks').get() as any).n).toBe(1)
  sql.close()
})
test('move atomically maps heterogeneous fields, retains source snapshot, and rejects stale batches', async () => {
  const { sql, db, ids } = fixture()
  sql
    .query('INSERT INTO communication_sheets VALUES(?,?,?,?,0,0)')
    .run('v', 'veille', 'Ressources', '["Nom","Type","Lien","Tags","Notes"]')
  const current = () =>
    sql.query('SELECT id,version FROM communication_rows WHERE id=?').get(ids[0]) as any
  await mutateCommunicationRows(
    db,
    'partenariats',
    { bulkAction: 'move', targetTable: 'veille', targetSheet: 'v', rows: [current()] },
    'fixture',
  )
  const moved = sql
    .query('SELECT sheet_id,cells_json,version FROM communication_rows WHERE id=?')
    .get(ids[0]) as any
  expect(moved.sheet_id).toBe('v')
  expect(JSON.parse(moved.cells_json)).toEqual([
    'Même personne',
    '',
    '',
    '',
    'Note source\n\nStatut : À contacter\n\nPriorité : A',
  ])
  expect(
    sql.query('SELECT source_sheet_id,target_sheet_id FROM communication_row_moves').get() as any,
  ).toEqual({ source_sheet_id: 'p', target_sheet_id: 'v' })
  expect(
    sql.query('SELECT * FROM communication_partnership_entities WHERE row_id=?').get(ids[0]),
  ).toBeNull()
  await expect(
    mutateCommunicationRows(
      db,
      'veille',
      {
        bulkAction: 'move',
        targetTable: 'partenariats',
        targetSheet: 'p',
        rows: [{ id: ids[0], version: moved.version - 1 }],
      },
      'fixture',
    ),
  ).rejects.toThrow('changé')
  expect(
    (sql.query('SELECT sheet_id FROM communication_rows WHERE id=?').get(ids[0]) as any).sheet_id,
  ).toBe('v')
  await mutateCommunicationRows(
    db,
    'veille',
    { bulkAction: 'move', targetTable: 'partenariats', targetSheet: 'p', rows: [current()] },
    'fixture',
  )
  expect((sql.query('SELECT count(*) n FROM communication_row_moves').get() as any).n).toBe(2)
  sql.close()
})
test('field mapping preserves every value and refuses notes that would exceed the editor limit', () => {
  expect(
    mapCommunicationCells(
      ['Une revue', 'https://example.test', 'Un contact'],
      ['Nom média', 'Site', 'Contact'],
      ['Nom', 'Lien', 'Notes'],
    ),
  ).toEqual(['Une revue', 'https://example.test', 'Contact : Un contact'])
  expect(() =>
    mapCommunicationCells(['x'.repeat(10000), 'y'], ['Notes', 'Contact'], ['Notes']),
  ).toThrow('10 000')
})

test('moves inside Partenariats and rejects the current sheet without altering the row', async () => {
  const { sql, db, ids } = fixture()
  sql
    .query('INSERT INTO communication_sheets VALUES(?,?,?,?,0,0)')
    .run(
      'committee',
      'partenariats',
      'Comité scientifique',
      '["Nom","Statut","Priorité","Notes","Attribution"]',
    )
  const row = sql.query('SELECT id,version FROM communication_rows WHERE id=?').get(ids[0])
  await expect(
    mutateCommunicationRows(
      db,
      'partenariats',
      { bulkAction: 'move', targetTable: 'partenariats', targetSheet: 'p', rows: [row] },
      'fixture',
    ),
  ).rejects.toThrow('autre feuille')
  expect(
    await mutateCommunicationRows(
      db,
      'partenariats',
      { bulkAction: 'move', targetTable: 'partenariats', targetSheet: 'committee', rows: [row] },
      'fixture',
    ),
  ).toBe(1)
  expect(
    (sql.query('SELECT sheet_id FROM communication_rows WHERE id=?').get(ids[0]) as any).sheet_id,
  ).toBe('committee')
  sql.close()
})
