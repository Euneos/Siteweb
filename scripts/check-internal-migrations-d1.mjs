// Real workerd/D1, temporary local persistence, synthetic rows only. No remote
// bindings, credentials, exports, resources or production writes.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  loadMigrations,
  schemaQuery,
  NATIVE,
  HASHES,
  sha256,
  bootstrapSQL,
  migrationSQL,
  validateState,
} from './lib/internal-migrations.mjs'

const directory = mkdtempSync(join(tmpdir(), 'euneos-d1-migration-check-'))
const config = join(directory, 'wrangler.toml')
const environment = {
  ...process.env,
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_LOG_PATH: join(directory, 'wrangler.log'),
}
delete environment.CLOUDFLARE_API_TOKEN
delete environment.CLOUDFLARE_ACCOUNT_ID
writeFileSync(
  config,
  `name="euneos-migration-fixture"
compatibility_date="2025-01-01"
[[d1_databases]]
binding="TEST_DB"
database_name="euneos-migration-fixture"
database_id="00000000-0000-0000-0000-000000000001"
`,
)
function query(sql, fail = false) {
  const result = spawnSync(
    'node',
    [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'd1',
      'execute',
      'TEST_DB',
      '--local',
      '--config',
      config,
      '--persist-to',
      join(directory, 'state'),
      `--command=${sql}`,
      '--json',
    ],
    {
      encoding: 'utf8',
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
      timeout: 60_000,
    },
  )
  if (fail) {
    assert.notEqual(result.status, 0, 'Le lot invalide doit échouer dans D1 local')
    assert.match(
      result.stderr + result.stdout,
      /CHECK|NOT NULL|FOREIGN KEY|column.*values/i,
      'L’échec doit venir de SQL, pas d’un problème de runtime',
    )
    return
  }
  assert.equal(result.status, 0, result.stderr + result.stdout + '\n' + sql.slice(-500))
  return JSON.parse(result.stdout)
}
function state() {
  const [schema, integrity, foreignKeys] = query(
    `${schemaQuery}; PRAGMA quick_check; PRAGMA foreign_key_check;`,
  )
  const exists = (name) => schema.results.some((r) => r.name === name)
  const ledger = exists(NATIVE) ? query(`SELECT name FROM ${NATIVE} ORDER BY id`)[0].results : []
  const hashes = exists(HASHES)
    ? query(`SELECT name,sha256 FROM ${HASHES} ORDER BY name`)[0].results
    : []
  return {
    schema: schema.results,
    integrity: integrity.results,
    foreignKeys: foreignKeys.results,
    ledger,
    hashes,
  }
}
const dataSQL =
  'SELECT * FROM workspace_entries ORDER BY id; SELECT * FROM workspace_comments ORDER BY id; SELECT * FROM workspace_resources ORDER BY id;'
const data = () => query(dataSQL).map((r) => r.results)
const future = (sql) => ({ name: '0005_local_fixture.sql', sql, sha256: sha256(sql) })
try {
  const baseline = loadMigrations().slice(0, 4)
  query(baseline.map((m) => m.sql).join('\n'))
  query(`INSERT INTO workspace_entries(id,kind,title,starts_on,ends_on,person,status,hours,daily_hours,created_by,updated_by)
    VALUES('fixture','equipe','Local test','2026-09-28','2026-09-28','fixture@example.test','en_cours',7.5,'[{"date":"2026-09-28","actual":7.5}]','fixture@example.test','fixture@example.test');
    INSERT INTO workspace_comments(id,entry_id,author,content) VALUES('comment','fixture','fixture@example.test','Conserver');`)
  const original = data()
  query(baseline[2].sql, true)
  assert.deepEqual(data(), original, '0003 ne peut pas perdre daily_hours')
  const initialState = state()
  const bootstrap = bootstrapSQL(
    initialState,
    baseline,
    baseline.map((m) => m.name),
  )
  query(bootstrap)
  query(bootstrap)
  let before = state()
  assert.equal(validateState(before, baseline), 4)
  assert.deepEqual(data(), original, 'Bootstrap sans aucune modification métier')

  const invalid = [
    ...baseline,
    future(
      'ALTER TABLE workspace_resources ADD COLUMN image_key TEXT; UPDATE workspace_entries SET title=NULL;',
    ),
  ]
  query(migrationSQL(before, invalid), true)
  assert.deepEqual(state(), before, 'Rollback du DDL et des deux registres')
  assert.deepEqual(data(), original)
  const brokenFK = [
    ...baseline,
    future("PRAGMA defer_foreign_keys=ON; UPDATE workspace_comments SET entry_id='missing';"),
  ]
  query(migrationSQL(before, brokenFK), true)
  assert.deepEqual(state(), before, 'Rollback de la FK différée et des registres au commit')

  const valid = [
    ...baseline,
    future(`ALTER TABLE workspace_resources ADD COLUMN image_key TEXT;
    CREATE TRIGGER fixture_trigger AFTER INSERT ON workspace_resources
    BEGIN UPDATE workspace_resources SET image_key = CASE WHEN NEW.title='a;b' THEN 'x;y' ELSE 'z' END WHERE id=NEW.id; END;`),
  ]
  const first = migrationSQL(before, valid),
    concurrent = migrationSQL(before, valid)
  query(first)
  query(concurrent, true)
  assert.equal(validateState(state(), valid), 5)
  assert.equal(migrationSQL(state(), valid), null, 'Reprise après commit sans rejouer le SQL')
  assert.deepEqual(data(), original)
  query(bootstrap, true)
  assert.equal(
    validateState(state(), valid),
    5,
    'Un ancien bootstrap ne peut rétrograder le registre',
  )

  // Also test every real future migration from this checkout, including triggers
  // in the image worker's 0005 once the parent combines the commits.
  rmSync(join(directory, 'state'), { recursive: true, force: true })
  query(baseline.map((m) => m.sql).join('\n'))
  query(`INSERT INTO workspace_entries(id,kind,title,starts_on,ends_on,person,status,hours,daily_hours,created_by,updated_by)
    VALUES('fixture','equipe','Local test','2026-09-28','2026-09-28','fixture@example.test','en_cours',7.5,'[{"date":"2026-09-28","actual":7.5}]','fixture@example.test','fixture@example.test');
    INSERT INTO workspace_comments(id,entry_id,author,content) VALUES('comment','fixture','fixture@example.test','Conserver');`)
  query(
    bootstrapSQL(
      state(),
      baseline,
      baseline.map((m) => m.name),
    ),
  )
  const actual = loadMigrations()
  for (let index = 4; index < actual.length; index++) query(migrationSQL(state(), actual))
  assert.equal(validateState(state(), actual), actual.length)
  const after = data()
  for (let table = 0; table < original.length; table++) {
    assert.equal(after[table].length, original[table].length)
    original[table].forEach((row, index) => {
      for (const key of Object.keys(row)) {
        // Defaults for the freshly rebuilt fixture have new timestamps.
        if (!['created_at', 'updated_at'].includes(key))
          assert.deepEqual(after[table][index][key], row[key])
      }
    })
  }
  console.log(
    'D1 local: bootstrap idempotent, heures conservées, 0003 refusée, rollback SQL/FK, concurrence et reprise vérifiés.',
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}
