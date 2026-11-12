import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { executionSQL, loadMigrations, sha256 } from '../scripts/lib/internal-migrations.mjs'

const migration = loadMigrations().find((m) => m.name === '0016_wise_up_study_resource.sql')!
const rows = [
  ['465ae9f3-9fa2-4c02-84a8-76d5ea4caeb7', 'Etude européenne Wise Up', 'https://example.test/old'],
  [
    'duplicate',
    'Etude européenne',
    'https://drive.google.com/file/d/1v7g2lRDpnYJhosRC-TLvTKIYfMEaXOGW/view?usp=share_link',
  ],
  [
    'folder',
    'Étude européenne',
    'https://drive.google.com/drive/folders/1f8LriiI66en89twgxY7Y91znDwnZVoG0?usp=sharing',
  ],
  [
    'case',
    'etude européenne',
    'HTTPS://DRIVE.GOOGLE.COM/FILE/D/1V7G2LRDPNYJHOSRC-TLVTKIYFMEAXOGW/view',
  ],
  ['wrong-id', 'Guide', 'https://drive.google.com/file/d/1v7g2lRDpnYJhosRC-TLvTKIYfMEaXOGX/view'],
  ['other', 'Guide', 'https://example.test/guide'],
]
function run(sql: string) {
  const db = new Database(':memory:')
  try {
    db.exec('CREATE TABLE workspace_resources(id TEXT PRIMARY KEY, title TEXT, url TEXT)')
    for (const row of rows) db.query('INSERT INTO workspace_resources VALUES(?,?,?)').run(...row)
    db.exec(sql)
    const result = db.query('SELECT * FROM workspace_resources ORDER BY id').all()
    db.exec(sql)
    expect(db.query('SELECT * FROM workspace_resources ORDER BY id').all()).toEqual(result)
    return result
  } finally {
    db.close()
  }
}
test('0016: préfixes D1 courts, résultats et casse identiques au fichier historique intact', () => {
  const lowered = executionSQL(migration)
  expect(run(lowered)).toEqual(run(migration.sql))
  expect(
    [...lowered.matchAll(/LIKE '([^']*)'/g)].every(
      (match) => new TextEncoder().encode(match[1]).length <= 50,
    ),
  ).toBe(true)
  expect(sha256(migration.sql)).toBe(
    '3205669709af20543738fa55fe9a7c6dbfa8548eca48b9482c7eb84e50a008a3',
  )
  expect(sha256(lowered)).not.toBe(migration.sha256)
})
test('la compatibilité refuse un fichier 0016 modifié et ne transforme aucune autre migration', () => {
  expect(() => executionSQL({ ...migration, sql: migration.sql + '\n-- changé' })).toThrow(
    'inchangée',
  )
  for (const other of loadMigrations().filter((m) => m.name !== migration.name))
    expect(executionSQL(other)).toBe(other.sql)
})
