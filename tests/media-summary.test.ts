import { expect, test } from 'bun:test'
import { mediaSummary } from '../src/lib/media-summary'
import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
const sheet = {
  id: 'media',
  title: 'Médias',
  guide: false,
  columns: ['Nom média', 'Contact', 'Statut', 'Attribution'],
}
test('summary counts all statuses, missing contacts and assignments', () => {
  const rows = [
    ['A', 'À trouver', 'À contacter', ''],
    ['B', 'presse@test.fr', 'Contacté', 'Pauline'],
    ['C', '', 'En discussion', 'Candice'],
  ].map((cells, i) => ({
    id: String(i),
    sheet_id: 'media',
    cells,
    version: 1,
    updated_by: 'test',
    updated_at: '',
  }))
  const result = mediaSummary([sheet], rows)
  expect(result.contacts).toBe(1)
  expect(result.total).toBe(3)
  expect(result.contacted).toBe(2)
  expect(result.ongoing.length).toBe(2)
  expect(result.people.find((p) => p.label === 'Non attribués')?.count).toBe(1)
  expect(mediaSummary([], []).summary).toContain('0 média ciblé')
})
test('media assignments create one durable task atomically and preserve unrelated tasks', () => {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const f of readdirSync('migrations/interne')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(readFileSync('migrations/interne/' + f, 'utf8'))
  db.query(
    'INSERT INTO communication_sheets(id,collection,title,columns_json,guide,position) VALUES(?,?,?,?,0,0)',
  ).run('media', 'suivimedias', 'Médias', JSON.stringify(sheet.columns))
  const cells = ['A', 'À trouver', 'À contacter', 'Pauline']
  db.query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)').run(
    'r',
    'media',
    JSON.stringify(cells),
    'test',
  )
  expect(db.query('SELECT person,status FROM team_tasks').get()).toEqual({
    person: 'Pauline',
    status: 'en-cours',
  })
  cells[3] = 'Charlotte'
  db.query('UPDATE communication_rows SET cells_json=?,version=version+1 WHERE id=?').run(
    JSON.stringify(cells),
    'r',
  )
  expect(db.query('SELECT person,version FROM team_tasks').get()).toEqual({
    person: 'Charlotte',
    version: 2,
  })
  cells[1] = 'contact@test.fr'
  db.query('UPDATE communication_rows SET cells_json=? WHERE id=?').run(JSON.stringify(cells), 'r')
  expect(db.query('SELECT count(*) AS n,max(version) AS v FROM team_tasks').get()).toEqual({
    n: 1,
    v: 2,
  })
  db.close()
})
test('migration preserves existing cells and isolates media statuses from partnerships', () => {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const f of readdirSync('migrations/interne')
    .filter((f) => f.endsWith('.sql') && f < '0026')
    .sort())
    db.exec(readFileSync('migrations/interne/' + f, 'utf8'))
  db.query('INSERT INTO communication_sheets VALUES(?,?,?,?,0,0)').run(
    'before',
    'suivimedias',
    'Médias',
    JSON.stringify(['Nom média', 'Statut', 'Contact']),
  )
  db.query('INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?)').run(
    'before-row',
    'before',
    JSON.stringify(['Revue', 'Accepté', 'À trouver']),
    'test',
  )
  db.exec("INSERT INTO communication_choices(id,scope,column_name,value) VALUES('custom','status','Statut','Ancien libellé')")
  db.exec("UPDATE communication_choices SET value='Statut personnalisé' WHERE id='custom'")
  db.exec(readFileSync('migrations/interne/0026_media_assignments.sql', 'utf8'))
  expect(
    JSON.parse((db.query('SELECT cells_json FROM communication_rows').get() as any).cells_json),
  ).toEqual(['Revue', 'Accepté', 'À trouver', ''])
  expect((db.query('SELECT count(*) n FROM team_tasks').get() as any).n).toBe(0)
  expect(
    (
      db
        .query(
          "SELECT c.value FROM communication_choice_aliases a JOIN communication_choices c ON c.id=a.choice_id WHERE a.scope='suivimedias' AND a.value='Accepté'",
        )
        .get() as any
    ).value,
  ).toBe('Partenariat')
  expect(
    (
      db
        .query(
          "SELECT c.value FROM communication_choice_aliases a JOIN communication_choices c ON c.id=a.choice_id WHERE a.scope='status' AND a.value='Accepté'",
        )
        .get() as any
    ).value,
  ).toBe('Accepté')
  expect((db.query("SELECT c.value,c.scope FROM communication_choice_aliases a JOIN communication_choices c ON c.id=a.choice_id WHERE a.scope='suivimedias' AND a.value='Ancien libellé'").get())).toEqual({value:'Statut personnalisé',scope:'suivimedias'})
  db.close()
})
