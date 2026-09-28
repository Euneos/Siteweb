import { Database } from 'bun:sqlite'
import { parseArgs } from 'node:util'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'
import { checkDeploymentRevision } from './check-deployment-revision.mjs'
import {
  TARGETS,
  NATIVE,
  HASHES,
  schemaQuery,
  sha256,
  planHash,
  loadMigrations,
  businessSchema,
  schemaFingerprint,
  readLocalState,
  bootstrapSQL,
  validateState,
  migrationSQL,
  executeSQLite,
} from './lib/internal-migrations.mjs'

function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}
export function targetConfig(environment) {
  const target = TARGETS[environment]
  requireThat(target, 'Environnement explicite requis: preview ou production')
  const config = Bun.TOML.parse(readFileSync('wrangler.toml', 'utf8'))
  const binding = (environment === 'preview' ? config.env?.preview : config)?.d1_databases?.find(
    (db) => db.binding === 'TEAM_WORKSPACE',
  )
  requireThat(
    binding?.database_id === target.id &&
      binding.database_name === target.name &&
      binding.migrations_dir === 'migrations/interne' &&
      !binding.preview_database_id &&
      (!binding.migrations_table || binding.migrations_table === NATIVE) &&
      !binding.migrations_pattern,
    'Cible TEAM_WORKSPACE différente du plan autorisé; revue de configuration requise',
  )
  return target
}
function writePrivate(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, content, { mode: 0o600, flag: 'wx' })
}
function localBackupPath(path) {
  requireThat(path && isAbsolute(path), 'Chemin privé absolu requis')
  const absolute = realpathSync(path)
  requireThat(
    !absolute.startsWith(realpathSync('.') + '/'),
    'Les exports privés doivent rester hors du dépôt',
  )
  return absolute
}
function privateOutput(path) {
  requireThat(path && isAbsolute(path), 'Chemin de sortie privé absolu requis')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  requireThat(
    !realpathSync(dirname(path)).startsWith(realpathSync('.') + '/') &&
      realpathSync(dirname(path)) !== realpathSync('.'),
    'Sortie de bootstrap interdite dans le dépôt',
  )
  return path
}
export function prepareBootstrap({ dump, out, names, environment }, migrations = loadMigrations()) {
  const target = targetConfig(environment)
  const source = readFileSync(localBackupPath(dump), 'utf8')
  privateOutput(out)
  const db = new Database(':memory:')
  try {
    executeSQLite(db, source)
    db.exec('PRAGMA foreign_keys=ON')
    const state = readLocalState(db)
    const dataHash = () =>
      businessSchema(state.schema)
        .filter((r) => r.type === 'table')
        .map(({ name }) => {
          const rows = db
            .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
            .all()
            .map((row) => JSON.stringify(row))
            .sort()
          return { table: name, rows: rows.length, sha256: sha256(rows.join('\n')) }
        })
    const before = dataHash()
    const sql = bootstrapSQL(state, migrations, names)
    db.transaction(() => executeSQLite(db, sql))()
    db.transaction(() => executeSQLite(db, sql))()
    const count = validateState(readLocalState(db), migrations)
    requireThat(
      JSON.stringify(before) === JSON.stringify(dataHash()),
      'Bootstrap: données modifiées',
    )
    const receipt = {
      kind: 'bootstrap-local-only',
      environment,
      databaseId: target.id,
      preparedAt: new Date().toISOString(),
      backupSha256: sha256(source),
      sqlSha256: sha256(sql + '\n'),
      plan: migrations.slice(0, count).map(({ name, sha256 }) => ({ name, sha256 })),
      schemaSha256: schemaFingerprint(state.schema),
      preserved: before,
      checks: ['exact-schema', 'foreign-keys', 'quick-check', 'idempotent-twice', 'data-unchanged'],
    }
    writePrivate(out + '.sql', sql + '\n')
    writePrivate(out + '.json', JSON.stringify(receipt, null, 2) + '\n')
    return receipt
  } finally {
    db.close()
  }
}

function wrangler(environment, args) {
  const target = targetConfig(environment)
  const result = spawnSync(
    'node',
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      ...args(target),
      ...(environment === 'preview' ? ['--env', 'preview'] : []),
      '--json',
    ],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  )
  // Never echo Wrangler's raw error/query output: a constraint failure may
  // include values from a row. No retry after a timeout/uncertain response.
  requireThat(
    result.status === 0,
    'Commande D1 échouée; arrêter, relire le registre avant toute reprise',
  )
  const response = JSON.parse(result.stdout)
  requireThat(
    !Array.isArray(response) || response.every((r) => r.success === true),
    'Réponse D1 en échec',
  )
  return response
}
export function remoteQuery(environment, sql) {
  return wrangler(environment, (target) => ['execute', target.name, '--remote', `--command=${sql}`])
}
export function readRemoteState(environment) {
  const first = remoteQuery(
    environment,
    `${schemaQuery}; PRAGMA quick_check; PRAGMA foreign_key_check;`,
  )
  const schema = first[0].results
  const exists = (name) => schema.some((r) => r.type === 'table' && r.name === name)
  const ledger = exists(NATIVE)
    ? remoteQuery(environment, `SELECT name FROM ${NATIVE} ORDER BY id`)[0].results
    : []
  const hashes = exists(HASHES)
    ? remoteQuery(environment, `SELECT name,sha256 FROM ${HASHES} ORDER BY name`)[0].results
    : []
  return { schema, ledger, hashes, integrity: first[1].results, foreignKeys: first[2].results }
}
export function verifyPreviewReceipt(receipt, migrations, codeSha) {
  requireThat(
    receipt.environment === 'preview' &&
      receipt.databaseId === TARGETS.preview.id &&
      receipt.status === 'verified' &&
      receipt.planSha256 === planHash(migrations) &&
      receipt.codeSha === codeSha &&
      receipt.runId === process.env.GITHUB_RUN_ID &&
      receipt.runAttempt === process.env.GITHUB_RUN_ATTEMPT,
    'Reçu preview manquant/divergent: même plan, SHA et exécution CI requis avant production',
  )
}
// Injectable transport permits real SQLite rollback/concurrency tests without
// exposing a remote target override or a generic SQL command in the CLI.
export async function migrate({
  environment,
  migrations,
  codeSha,
  previewReceipt,
  read,
  execute,
  backup,
}) {
  if (environment === 'production') verifyPreviewReceipt(previewReceipt ?? {}, migrations, codeSha)
  let state = await read()
  const before = validateState(state, migrations)
  const restorePoint = before < migrations.length ? await backup() : null
  for (let count = before; count < migrations.length; count++) {
    // On any error stop immediately; previously committed migrations stay
    // committed. A rerun starts with a fresh, fully verified ledger.
    await execute(migrationSQL(state, migrations))
    state = await read()
    requireThat(
      validateState(state, migrations) === count + 1,
      'Postcondition de migration invalide',
    )
  }
  return {
    status: 'verified',
    environment,
    databaseId: TARGETS[environment].id,
    codeSha,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    verifiedAt: new Date().toISOString(),
    planSha256: planHash(migrations),
    schemaSha256: schemaFingerprint(state.schema),
    restorePoint,
    before: migrations.slice(0, before).map((m) => m.name),
    after: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
  }
}
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      environment: { type: 'string' },
      dump: { type: 'string' },
      out: { type: 'string' },
      names: { type: 'string' },
      receipt: { type: 'string' },
      'preview-receipt': { type: 'string' },
    },
  })
  requireThat(positionals.length === 1, 'Commande requise: list | bootstrap | verify | apply-ci')
  const [command] = positionals
  const migrations = loadMigrations()
  if (command === 'list') {
    console.log(
      JSON.stringify(
        {
          planSha256: planHash(migrations),
          migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })),
        },
        null,
        2,
      ),
    )
    return
  }
  const environment = values.environment
  targetConfig(environment)
  if (command === 'bootstrap') {
    const receipt = prepareBootstrap(
      { ...values, names: values.names?.split(',') ?? [] },
      migrations,
    )
    console.log(
      `Bootstrap préparé et testé localement: ${receipt.plan.length} migrations. Aucune écriture distante.`,
    )
    return
  }
  if (command === 'verify') {
    const state = readRemoteState(environment)
    console.log(
      JSON.stringify({
        environment,
        applied: validateState(state, migrations),
        planSha256: planHash(migrations),
      }),
    )
    return
  }
  requireThat(command === 'apply-ci', 'Commande inconnue')
  requireThat(
    process.env.GITHUB_ACTIONS === 'true' && values.receipt && process.env.GITHUB_SHA,
    'Écriture réservée au workflow CI; bootstrap et rollout relus par le parent',
  )
  const policy = await checkDeploymentRevision()
  requireThat(environment !== 'production' || policy === 'production', 'Production réservée à main')
  const previewReceipt = values['preview-receipt']
    ? JSON.parse(readFileSync(values['preview-receipt'], 'utf8'))
    : undefined
  const receipt = await migrate({
    environment,
    migrations,
    codeSha: process.env.GITHUB_SHA,
    previewReceipt,
    read: () => readRemoteState(environment),
    execute: async (sql) => {
      await checkDeploymentRevision()
      return remoteQuery(environment, sql)
    },
    backup: () => {
      const info = wrangler(environment, (target) => ['time-travel', 'info', target.name])
      requireThat(
        typeof info.bookmark === 'string' && info.bookmark.length > 0,
        'Point Time Travel absent',
      )
      const backup = {
        environment,
        databaseId: TARGETS[environment].id,
        bookmark: info.bookmark,
        recordedAt: new Date().toISOString(),
      }
      // Persist before the first write, including on failure. This metadata is
      // safe for CI artifacts; full exports remain local/private with the parent.
      writePrivate(
        resolve(values.receipt + '.restore.json'),
        JSON.stringify(backup, null, 2) + '\n',
      )
      return backup
    },
  })
  writePrivate(resolve(values.receipt), JSON.stringify(receipt, null, 2) + '\n')
  console.log(`D1 ${environment}: ${receipt.after.length} migrations vérifiées.`)
}
if (import.meta.main)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
