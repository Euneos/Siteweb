import { afterEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYAML } from 'yaml'
import {
  NATIVE,
  HASHES,
  nativeDDL,
  loadMigrations,
  expectedSchema,
  readLocalState,
  schemaFingerprint,
  bootstrapSQL,
  migrationSQL,
  validateState,
  sha256,
  planHash,
  validateSQL,
  TARGETS,
  executeSQLite,
  statements,
} from '../scripts/lib/internal-migrations.mjs'
import { migrate, verifyPreviewReceipt, prepareBootstrap } from '../scripts/internal-migrations.mjs'
import { deploymentPolicy, assertCurrentRevision } from '../scripts/lib/deployment-policy.mjs'

const migrations = loadMigrations()
const baseline = migrations.slice(0, 4)
const names = baseline.map((m) => m.name)
const dbs = [],
  directories = []
afterEach(() => {
  dbs.splice(0).forEach((db) => db.close())
  directories.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})
function temp() {
  const d = mkdtempSync(join(tmpdir(), 'euneos-migrations-test-'))
  directories.push(d)
  return d
}
function fixture({ path = ':memory:', through = 4, adopted = false } = {}) {
  const db = new Database(path)
  dbs.push(db)
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
  for (const m of baseline.slice(0, through)) db.transaction(() => executeSQLite(db, m.sql))()
  db.exec(`INSERT INTO workspace_entries(id,kind,title,starts_on,ends_on,person,status,hours,created_by,updated_by,source_payload)
    VALUES('fictive','equipe','Fixture uniquement','2026-09-28','2026-09-28','fixture@example.test','en_cours',7.5,'fixture@example.test','fixture@example.test','{"private":"fictif"}');
    INSERT INTO workspace_comments(id,entry_id,author,content) VALUES('comment','fictive','fixture@example.test','À conserver');
    INSERT INTO workspace_resources(id,title,category,url,updated_by) VALUES('resource','Fixture','Guide','https://example.test','fixture@example.test');`)
  if (through === 4)
    db.exec(
      `UPDATE workspace_entries SET daily_hours='[{"date":"2026-09-28","actual":7.5,"planned":8}]'`,
    )
  if (adopted)
    db.transaction(() => executeSQLite(db, bootstrapSQL(readLocalState(db), migrations, names)))()
  return db
}
function data(db) {
  return ['workspace_entries', 'workspace_comments', 'workspace_resources'].map((t) =>
    db.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
  )
}
const next = (sql, number = 5) => ({
  name: `${String(number).padStart(4, '0')}_fixture.sql`,
  sql,
  sha256: sha256(sql),
})
const appended = (...extra) => [...baseline, ...extra]
const apply = (db, sql) => db.transaction(() => executeSQLite(db, sql))()

test('bootstrap sans registre: schéma exact, données/heures intactes, deux applications identiques', () => {
  const db = fixture(),
    before = data(db),
    state = readLocalState(db)
  expect(() => validateState(state, migrations)).toThrow('Bootstrap')
  const sql = bootstrapSQL(state, migrations, names)
  expect(sql).not.toContain('DROP TABLE workspace_entries')
  apply(db, sql)
  apply(db, sql)
  expect(validateState(readLocalState(db), migrations)).toBe(4)
  expect(data(db)).toEqual(before)
  expect(migrationSQL(readLocalState(db), baseline)).toBeNull()
})
test('bootstrap reprend un registre natif partiel sans inventer les dates historiques', () => {
  const db = fixture()
  db.exec(nativeDDL)
  db.query(`INSERT INTO ${NATIVE}(name,applied_at) VALUES(?,?)`).run(
    names[0],
    '2026-09-21 10:00:00',
  )
  apply(db, bootstrapSQL(readLocalState(db), baseline, names))
  expect(validateState(readLocalState(db), baseline)).toBe(4)
  expect(db.query(`SELECT applied_at FROM ${NATIVE} WHERE name=?`).get(names[0]).applied_at).toBe(
    '2026-09-21 10:00:00',
  )
})
test('un dump privé produit seulement du SQL de registre et un reçu, jamais les données', () => {
  const db = fixture(),
    dir = temp(),
    state = readLocalState(db)
  const dump =
    state.schema
      .filter((r) => r.sql && r.type === 'table')
      .map((r) => r.sql + ';')
      .join('\n') +
    '\n' +
    state.schema
      .filter((r) => r.sql && r.type === 'index')
      .map((r) => r.sql + ';')
      .join('\n')
  writeFileSync(join(dir, 'dump.sql'), dump)
  const receipt = prepareBootstrap({
    dump: join(dir, 'dump.sql'),
    out: join(dir, 'bootstrap'),
    names,
    environment: 'preview',
  })
  const sql = readFileSync(join(dir, 'bootstrap.sql'), 'utf8')
  expect(sha256(sql)).toBe(receipt.sqlSha256)
  expect(receipt.kind).toBe('bootstrap-local-only')
  expect(sql).not.toContain('fixture@example.test')
})
test('0003 ne doit jamais être rejouée après daily_hours: la reproduction réelle échoue sans perte', () => {
  const db = fixture(),
    before = data(db)
  expect(() => apply(db, baseline[2].sql)).toThrow()
  expect(data(db)).toEqual(before)
  expect(() => migrationSQL(readLocalState(db), baseline)).toThrow('Bootstrap')
  apply(db, bootstrapSQL(readLocalState(db), baseline, names))
  expect(migrationSQL(readLocalState(db), baseline)).toBeNull()
})
test('bootstrap refuse 0003 seule, colonne manquante, CHECK altéré, index absent et trigger ajouté', () => {
  const old = fixture({ through: 3 })
  expect(() => bootstrapSQL(readLocalState(old), baseline, names)).toThrow('schéma exact')
  expect(() => bootstrapSQL(readLocalState(old), baseline, names.slice(0, 3))).toThrow('préfixe')
  for (const sql of [
    'DROP INDEX workspace_entries_month',
    'ALTER TABLE workspace_entries ADD COLUMN unexpected TEXT',
    'CREATE TRIGGER unexpected AFTER UPDATE ON workspace_entries BEGIN SELECT 1; END;',
  ]) {
    const db = fixture()
    db.exec(sql)
    expect(() => bootstrapSQL(readLocalState(db), baseline, names)).toThrow('schéma exact')
  }
  const changed = baseline.map((m, i) =>
    i === 2 ? { ...m, sql: m.sql.replace("'en_cours'", "'EN_COURS'") } : m,
  )
  expect(schemaFingerprint(expectedSchema(changed))).not.toBe(
    schemaFingerprint(expectedSchema(baseline)),
  )
})
test('registre inconnu, trou, hash modifié ou structure affaiblie bloquent', () => {
  for (const sql of [
    `DELETE FROM ${NATIVE} WHERE name='${names[1]}'`,
    `INSERT INTO ${NATIVE}(name) VALUES('0005_inconnue.sql')`,
    `UPDATE ${HASHES} SET sha256='inconnu'`,
    `DROP TABLE ${HASHES}`,
    `CREATE INDEX unexpected_ledger ON ${NATIVE}(applied_at)`,
  ]) {
    const db = fixture({ adopted: true })
    db.exec(sql)
    expect(() => validateState(readLocalState(db), baseline)).toThrow()
  }
})
test('le SQL de bootstrap revérifie schéma et registre après préparation, avant écriture', () => {
  const db = fixture(),
    sql = bootstrapSQL(readLocalState(db), baseline, names)
  db.exec('ALTER TABLE workspace_entries ADD COLUMN changed TEXT')
  expect(() => apply(db, sql)).toThrow('CHECK')
  expect(readLocalState(db).ledger).toEqual([])
  const concurrent = fixture(),
    prepared = bootstrapSQL(readLocalState(concurrent), baseline, names)
  concurrent.exec(nativeDDL + `INSERT INTO ${NATIVE}(name) VALUES('inconnue.sql')`)
  expect(() => apply(concurrent, prepared)).toThrow('CHECK')
})
test('numérotation/hash historiques immuables, prochaine migration librement nommée', () => {
  const dir = temp()
  baseline.forEach((m) => writeFileSync(join(dir, m.name), m.sql))
  writeFileSync(
    join(dir, '0005_images.sql'),
    'ALTER TABLE workspace_resources ADD COLUMN image_key TEXT;',
  )
  expect(loadMigrations(dir).at(-1).name).toBe('0005_images.sql')
  writeFileSync(join(dir, '0005_duplicate.sql'), 'SELECT 1;')
  expect(() => loadMigrations(dir)).toThrow('Numérotation')
  rmSync(join(dir, '0005_duplicate.sql'))
  writeFileSync(join(dir, baseline[0].name), baseline[0].sql + '\n-- drift')
  expect(() => loadMigrations(dir)).toThrow('Historique')
})
test('deux connexions et plans concurrents: une seule application, seconde refusée avant SQL métier', () => {
  const path = join(temp(), 'db.sqlite'),
    a = fixture({ path, adopted: true }),
    b = new Database(path)
  dbs.push(b)
  b.exec('PRAGMA foreign_keys=ON')
  const chain = appended(
    next(
      'ALTER TABLE workspace_resources ADD COLUMN image_key TEXT; UPDATE workspace_entries SET hours=hours+1;',
    ),
  )
  const sqlA = migrationSQL(readLocalState(a), chain),
    sqlB = migrationSQL(readLocalState(b), chain)
  apply(a, sqlA)
  expect(() => apply(b, sqlB)).toThrow('CHECK')
  expect(a.query('SELECT hours FROM workspace_entries').get().hours).toBe(8.5)
  expect(validateState(readLocalState(a), chain)).toBe(5)
  expect(migrationSQL(readLocalState(b), chain)).toBeNull()
})
test('un échec SQL après DDL annule données, schéma, registre et empreinte', () => {
  const db = fixture({ adopted: true }),
    before = data(db),
    state = readLocalState(db)
  const chain = appended(
    next(
      'ALTER TABLE workspace_resources ADD COLUMN image_key TEXT; UPDATE workspace_entries SET title=NULL;',
    ),
  )
  expect(() => apply(db, migrationSQL(state, chain))).toThrow('NOT NULL')
  expect(readLocalState(db)).toEqual(state)
  expect(data(db)).toEqual(before)
})
test('une FK différée invalide annule aussi le registre au commit', () => {
  const db = fixture({ adopted: true }),
    state = readLocalState(db)
  const chain = appended(
    next("PRAGMA defer_foreign_keys=ON; UPDATE workspace_comments SET entry_id='missing';"),
  )
  expect(() => apply(db, migrationSQL(state, chain))).toThrow('FOREIGN KEY')
  expect(readLocalState(db)).toEqual(state)
})
test('échec migration 6 arrête le circuit; 5 reste acquise, relance sans rejouer 5', async () => {
  const db = fixture({ adopted: true })
  const chain = appended(
    next('ALTER TABLE workspace_resources ADD COLUMN image_key TEXT;'),
    next('UPDATE workspace_entries SET title=NULL;', 6),
  )
  let writes = 0,
    backups = 0
  const options = {
    environment: 'preview',
    migrations: chain,
    codeSha: 'fixture',
    read: () => readLocalState(db),
    execute: (sql) => {
      writes++
      apply(db, sql)
    },
    backup: () => {
      backups++
      return 'local-fixture'
    },
  }
  await expect(migrate(options)).rejects.toThrow('NOT NULL')
  expect(validateState(readLocalState(db), chain)).toBe(5)
  expect(writes).toBe(2)
  expect(backups).toBe(1)
  await expect(migrate(options)).rejects.toThrow('NOT NULL')
  expect(writes).toBe(3)
})
test('backup échoué empêche toute migration; réponse perdue se reprend par relecture', async () => {
  const db = fixture({ adopted: true }),
    chain = appended(next('ALTER TABLE workspace_resources ADD COLUMN image_key TEXT;'))
  let writes = 0
  const options = {
    environment: 'preview',
    migrations: chain,
    codeSha: 'fixture',
    read: () => readLocalState(db),
    execute: (sql) => {
      writes++
      apply(db, sql)
      throw new Error('timeout après commit')
    },
    backup: () => {
      throw new Error('backup')
    },
  }
  await expect(migrate(options)).rejects.toThrow('backup')
  expect(writes).toBe(0)
  options.backup = () => 'local-fixture'
  await expect(migrate(options)).rejects.toThrow('timeout')
  expect(writes).toBe(1)
  expect((await migrate(options)).status).toBe('verified')
  expect(writes).toBe(1)
})
test('production exige une preuve preview du même SHA, plan et run', async () => {
  const receipt = {
    environment: 'preview',
    databaseId: TARGETS.preview.id,
    status: 'verified',
    planSha256: planHash(baseline),
    codeSha: 'same',
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  }
  expect(() => verifyPreviewReceipt(receipt, baseline, 'same')).not.toThrow()
  for (const change of [
    { codeSha: 'old' },
    { environment: 'production' },
    { planSha256: 'old' },
    { runId: 'other' },
    { status: 'failed' },
  ]) {
    expect(() => verifyPreviewReceipt({ ...receipt, ...change }, baseline, 'same')).toThrow(
      'Reçu preview',
    )
  }
  let touched = false
  await expect(
    migrate({
      environment: 'production',
      migrations: baseline,
      codeSha: 'same',
      read: () => {
        touched = true
      },
    }),
  ).rejects.toThrow('Reçu preview')
  expect(touched).toBe(false)
})
test('PR externe et dispatch hors main sont refusés; main et PR périmées ne publient pas', () => {
  const event = {
    pull_request: {
      head: { sha: 'head', repo: { full_name: 'Euneos/Siteweb' } },
      base: { ref: 'main', sha: 'base' },
    },
  }
  expect(deploymentPolicy('pull_request', 'refs/pull/1/merge', 'Euneos/Siteweb', event)).toBe(
    'preview',
  )
  expect(() => deploymentPolicy('pull_request', '', 'other/repo', event)).toThrow('externe')
  expect(() =>
    deploymentPolicy('workflow_dispatch', 'refs/heads/feature', 'Euneos/Siteweb', {}),
  ).toThrow('hors main')
  expect(() => assertCurrentRevision('production', {}, 'old', { main: 'new' })).toThrow('dépassée')
  expect(() =>
    assertCurrentRevision('preview', event, 'merge', {
      main: 'new',
      base: 'base',
      head: 'head',
      merge: 'merge',
      state: 'open',
    }),
  ).toThrow('dépassée')
})
test('les migrations ne peuvent gérer transactions, registre ni désactiver les protections', () => {
  for (const sql of [
    'BEGIN; SELECT 1; COMMIT;',
    'PRAGMA foreign_keys=OFF;',
    'PRAGMA writable_schema=ON;',
    `DELETE FROM ${NATIVE};`,
    'ATTACH DATABASE "other" AS other;',
  ])
    expect(() => validateSQL(sql)).toThrow()
  expect(() =>
    validateSQL(
      'PRAGMA defer_foreign_keys=ON; ALTER TABLE workspace_resources ADD COLUMN image_key TEXT;',
    ),
  ).not.toThrow()
})
test('les triggers avec BEGIN/END, CASE et points-virgules littéraux restent une instruction atomique', () => {
  const sql = `ALTER TABLE workspace_resources ADD COLUMN image_key TEXT;
    CREATE TRIGGER fixture_insert AFTER INSERT ON workspace_resources
    BEGIN
      UPDATE workspace_resources SET image_key=CASE WHEN NEW.title='a;b' THEN 'x;y' ELSE 'z' END WHERE id=NEW.id;
      -- BEGIN; END; dans un commentaire
      UPDATE workspace_resources SET category='c;d' WHERE id=NEW.id;
    END;`
  expect(statements(sql)).toHaveLength(2)
  expect(() => validateSQL(sql)).not.toThrow()
  const db = fixture({ adopted: true }),
    chain = appended(next(sql))
  apply(db, migrationSQL(readLocalState(db), chain))
  expect(validateState(readLocalState(db), chain)).toBe(5)
  db.exec(
    "INSERT INTO workspace_resources(id,title,category,url,updated_by) VALUES('trigger','a;b','old','https://example.test','fixture@example.test')",
  )
  expect(
    db.query("SELECT image_key,category FROM workspace_resources WHERE id='trigger'").get(),
  ).toEqual({ image_key: 'x;y', category: 'c;d' })
})

test('workflow: aucun secret au build; verrou global et publication après migrations réussies', () => {
  const workflow = parseYAML(readFileSync('.github/workflows/deploiement.yml', 'utf8'))
  expect(JSON.stringify(workflow.env)).not.toContain('secrets.')
  expect(JSON.stringify(workflow.jobs.verifier)).not.toContain('secrets.')
  const deploy = workflow.jobs.deployer
  expect(deploy.needs).toBe('verifier')
  expect(deploy.if).toContain('head.repo.full_name == github.repository')
  expect(deploy.if).toContain("github.ref == 'refs/heads/main'")
  expect(deploy.concurrency).toEqual({
    group: 'euneos-team-workspace-deployment',
    'cancel-in-progress': false,
  })
  const protectedSteps = deploy.steps.filter((s) => /apply-ci|pages deploy/.test(s.run ?? ''))
  expect(protectedSteps).toHaveLength(4)
  expect(protectedSteps[0].run).toContain('--environment preview')
  expect(protectedSteps[1].run).toContain('pages deploy')
  expect(protectedSteps[2].run).toContain('--preview-receipt')
  expect(protectedSteps[3].run).toContain('--branch=main')
  for (const step of protectedSteps) {
    expect(step['continue-on-error']).toBeUndefined()
    expect(step.if ?? '').not.toContain('always()')
  }
})
