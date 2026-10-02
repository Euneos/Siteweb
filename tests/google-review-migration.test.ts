import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  loadMigrations,
  executeSQLite,
  bootstrapSQL,
  migrationSQL,
  readLocalState,
  validateState,
} from '../scripts/lib/internal-migrations.mjs'

test('0005 is discovered and applied once through the adopted TEAM_WORKSPACE pipeline, preserving calendars', () => {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  try {
    const migrations = loadMigrations(),
      baseline = migrations.slice(0, 4)
    expect(migrations[4].name).toBe('0005_google_review_attachments.sql')
    expect(migrations[4].sha256).toMatch(/^[a-f0-9]{64}$/)
    const apply = (sql: string) => db.transaction(() => executeSQLite(db, sql))()
    for (const migration of baseline) apply(migration.sql)
    db.exec(
      `INSERT INTO workspace_entries(id,kind,title,starts_on,ends_on,person,created_by,updated_by,status,daily_hours) VALUES ('test','equipe','Fictif','2026-10-01','2026-10-01','test@example.test','test@example.test','test@example.test','valide','[{"date":"2026-10-01","actual":2}]')`,
    )
    const before = db.query('SELECT * FROM workspace_entries').all()
    apply(
      bootstrapSQL(
        readLocalState(db),
        migrations,
        baseline.map((m) => m.name),
      ),
    )
    const migration = migrationSQL(readLocalState(db), migrations)
    expect(migration).toContain('CREATE TABLE google_review_attachments')
    expect(migration).not.toContain('DROP TABLE workspace_entries')
    apply(migration!)
    expect(validateState(readLocalState(db), migrations)).toBe(5)
    const correctionMigration = migrationSQL(readLocalState(db), migrations)
    expect(correctionMigration).toContain('CREATE TABLE google_review_corrections')
    apply(correctionMigration!)
    expect(validateState(readLocalState(db), migrations)).toBe(migrations.length)
    expect(migrationSQL(readLocalState(db), migrations)).toBeNull()
    expect(db.query('SELECT * FROM workspace_entries').all()).toEqual(before)
    const insert = db.query('INSERT INTO google_review_attachments VALUES (?,?,?,?,?,?)')
    insert.run(1, 'source', 'pending', '{}', 'before', 'after')
    expect(() => insert.run(1, 'source', 'pending', '{}', 'before', 'after')).toThrow()
    expect(() => insert.run(2, 'source', 'integrated', '{}', 'before', 'after')).toThrow()
    expect(() => insert.run(-1, 'source', 'pending', '{}', 'before', 'after')).toThrow()
    expect(() => insert.run(3, '', 'pending', '{}', 'before', 'after')).toThrow()
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    db.close()
  }
})
