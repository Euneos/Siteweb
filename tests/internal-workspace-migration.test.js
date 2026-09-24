import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'

const original = readFileSync(
  new URL('../migrations/interne/0001_workspace.sql', import.meta.url),
  'utf8',
)
const migration = readFileSync(
  new URL('../migrations/interne/0002_programme_status.sql', import.meta.url),
  'utf8',
)
const editorialMigration = readFileSync(new URL('../migrations/interne/0003_editorial_statuses.sql', import.meta.url), 'utf8')
const tables = ['workspace_entries', 'workspace_comments', 'workspace_resources']
const oldStatuses = ['brouillon', 'a_valider', 'valide', 'publie', 'annule']
const connections = []
afterEach(() => connections.splice(0).forEach((db) => db.close()))

function insert(db, table, row) {
  const fields = Object.keys(row)
  db.query(
    `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
  ).run(...Object.values(row))
}

function fixture(populated = true) {
  const db = new Database(':memory:')
  connections.push(db)
  db.exec(original)
  if (!populated) return db
  for (const [i, status] of oldStatuses.entries()) {
    insert(db, 'workspace_entries', {
      id: `entry-${i}`,
      kind: i % 2 ? 'equipe' : 'editorial',
      title: `L'été — fiche fictive ${i}`,
      starts_on: '2026-09-24',
      ends_on: '2026-09-25',
      person: `member-${i}@example.test`,
      activity: `Activité historique ${i}`,
      channel: i % 2 ? '' : 'Canal historique libre',
      attendance: ['', 'presence', 'absence', 'conge', ''][i],
      location: `Lieu fictif ${i}`,
      status,
      hours: [null, 0, 7.5, 744, null][i],
      notes: `Notes\n${i}`,
      content: `Contenu <b>textuel</b> ${i}`,
      link: `https://example.test/fiche-${i}`,
      created_by: 'source@example.test',
      updated_by: 'editor@example.test',
      version: i + 4,
      source_id: i % 2 ? null : `source-${i}`,
      source_payload: i % 2 ? null : JSON.stringify({ id: i, original: { Texte: 'Été' } }),
      source_fingerprint: i % 2 ? null : `fingerprint-${i}`,
      created_at: '2026-08-01T10:20:30.123Z',
      updated_at: '2026-09-02T11:22:33.456Z',
    })
    for (let j = 0; j < 2; j++) {
      insert(db, 'workspace_comments', {
        id: `comment-${i}-${j}`,
        entry_id: `entry-${i}`,
        author: `author-${j}@example.test`,
        content: `Commentaire ${j} — conservé\nintégralement`,
        created_at: `2026-09-03T10:00:0${j}.123Z`,
      })
    }
  }
  for (const published of [0, 1]) {
    insert(db, 'workspace_resources', {
      id: `resource-${published}`,
      title: `Ressource fictive ${published}`,
      category: 'Guides',
      description: 'Conserver cette description',
      url: 'https://example.test/guide.pdf',
      published,
      updated_by: 'manager@example.test',
      updated_at: '2026-09-04T12:00:00.123Z',
    })
  }
  return db
}

const data = (db) =>
  Object.fromEntries(
    tables.map((table) => [table, db.query(`SELECT * FROM ${table} ORDER BY id`).all()]),
  )
const schema = (db) =>
  db
    .query(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => ({ ...row, sql: row.sql.replaceAll('"', '').replace(/\s+/g, ' ').trim() }))
const structure = (db) =>
  tables.map((table) => ({
    table,
    columns: db.query(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.query(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: db
      .query(`PRAGMA index_list(${table})`)
      .all()
      .map(({ seq, ...index }) => ({
        ...index,
        columns: db.query(`PRAGMA index_info(${index.name})`).all(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
// D1 wraps one migration in one transaction. Do the same with real SQLite,
// leaving foreign_keys ON both during the migration and at the final commit.
const apply = (db) => db.transaction(() => db.exec(migration))()

test('les nouveaux statuts éditoriaux préservent les données et relations et permettent un retour transactionnel', () => {
  const db = fixture()
  apply(db)
  const before = data(db)
  const beforeStructure = structure(db)
  const beforeSchema = schema(db)
  expect(() => db.transaction(() => {
    db.exec(editorialMigration)
    db.exec("UPDATE workspace_entries SET status='inconnu' WHERE id='entry-0'")
  })()).toThrow('CHECK')
  expect(data(db)).toEqual(before)
  expect(schema(db)).toEqual(beforeSchema)
  db.transaction(() => db.exec(editorialMigration))()
  expect(data(db)).toEqual(before)
  expect(structure(db)).toEqual(beforeStructure)
  expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  expect(db.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
  for (const status of ['en_cours', 'a_creer', 'a_modifier', 'a_valider', 'programme', 'valide', 'publie']) {
    db.query("UPDATE workspace_entries SET status=? WHERE id='entry-0'").run(status)
    expect(db.query("SELECT status FROM workspace_entries WHERE id='entry-0'").get().status).toBe(status)
  }
})

describe('Migration du statut Programmé sur une base existante', () => {
  test('conserve intégralement les fiches, imports, commentaires, ressources, index et clés étrangères', () => {
    const db = fixture()
    const before = data(db)
    const beforeStructure = structure(db)
    const beforeSchema = schema(db)
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(() =>
      db.exec("UPDATE workspace_entries SET status='programme' WHERE id='entry-0'"),
    ).toThrow('CHECK')

    apply(db)

    expect(data(db)).toEqual(before)
    expect(structure(db)).toEqual(beforeStructure)
    expect(schema(db)).toEqual(
      beforeSchema.map((row) => ({
        ...row,
        sql:
          row.name === 'workspace_entries'
            ? row.sql.replace("'valide','publie'", "'valide','programme','publie'")
            : row.sql,
      })),
    )
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.query('PRAGMA defer_foreign_keys').get()).toEqual({ defer_foreign_keys: 0 })

    db.exec("UPDATE workspace_entries SET status='programme' WHERE id='entry-0'")
    expect(db.query("SELECT status FROM workspace_entries WHERE id='entry-0'").get().status).toBe(
      'programme',
    )
    expect(db.query('SELECT count(*) AS count FROM workspace_comments').get().count).toBe(10)
    expect(() =>
      db.exec("UPDATE workspace_entries SET status='inconnu' WHERE id='entry-0'"),
    ).toThrow('CHECK')
  })

  test('conserve les autres contraintes et les valeurs par défaut, y compris les FK après commit', () => {
    const db = fixture()
    apply(db)
    for (const assignment of [
      "kind='inconnu'",
      "attendance='inconnue'",
      'hours=-1',
      'hours=745',
      'title=NULL',
    ]) {
      expect(() =>
        db.exec(`UPDATE workspace_entries SET ${assignment} WHERE id='entry-0'`),
      ).toThrow()
    }
    expect(() =>
      db.exec("UPDATE workspace_entries SET source_id='source-0' WHERE id='entry-1'"),
    ).toThrow('UNIQUE')
    expect(() => db.exec("DELETE FROM workspace_entries WHERE id='entry-0'")).toThrow('FOREIGN KEY')
    expect(() =>
      db.exec("UPDATE workspace_comments SET entry_id='absente' WHERE id='comment-0-0'"),
    ).toThrow('FOREIGN KEY')
    expect(() => db.exec('UPDATE workspace_resources SET published=2')).toThrow('CHECK')
    insert(db, 'workspace_entries', {
      id: 'entry-new',
      kind: 'editorial',
      title: 'Nouvelle fiche fictive',
      starts_on: '2026-09-26',
      ends_on: '2026-09-26',
      person: 'member@example.test',
      status: 'programme',
      created_by: 'member@example.test',
      updated_by: 'member@example.test',
    })
    expect(db.query("SELECT * FROM workspace_entries WHERE id='entry-new'").get()).toMatchObject({
      status: 'programme',
      activity: '',
      channel: '',
      attendance: '',
      location: '',
      notes: '',
      content: '',
      link: '',
      version: 1,
      source_id: null,
      source_payload: null,
      source_fingerprint: null,
      hours: null,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    })
    insert(db, 'workspace_comments', {
      id: 'comment-new',
      entry_id: 'entry-new',
      author: 'member@example.test',
      content: 'Nouveau commentaire',
    })
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  })

  test('annule toute la migration si une erreur survient après le remplacement des tables', () => {
    const db = fixture()
    const before = data(db)
    const beforeSchema = schema(db)
    expect(() =>
      db.transaction(() => {
        db.exec(migration)
        db.exec("UPDATE workspace_entries SET status='inconnu' WHERE id='entry-0'")
      })(),
    ).toThrow('CHECK')
    expect(data(db)).toEqual(before)
    expect(schema(db)).toEqual(beforeSchema)
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
    expect(() =>
      db.exec("UPDATE workspace_entries SET status='programme' WHERE id='entry-0'"),
    ).toThrow('CHECK')
  })

  test('une violation FK différée fait échouer le commit et restaure les données et le schéma', () => {
    const db = fixture()
    const before = data(db)
    const beforeSchema = schema(db)
    expect(() =>
      db.transaction(() => {
        db.exec(migration)
        db.exec("UPDATE workspace_comments SET entry_id='absente' WHERE id='comment-0-0'")
      })(),
    ).toThrow('FOREIGN KEY')
    expect(data(db)).toEqual(before)
    expect(schema(db)).toEqual(beforeSchema)
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  })

  test('fonctionne aussi pour une base vide nouvellement créée', () => {
    const db = fixture(false)
    const before = data(db)
    apply(db)
    expect(data(db)).toEqual(before)
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
