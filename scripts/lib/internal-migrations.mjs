import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import history from './internal-migrations-history.json' with { type: 'json' }

export const TARGETS = Object.freeze({
  preview: { name: 'euneos-team-workspace-preview', id: 'e4d5fb32-d56e-4e37-a589-72cf0e9d4bc5' },
  production: { name: 'euneos-team-workspace', id: 'b178cff0-1860-4929-b697-d7152b32b53f' },
})
export const NATIVE = 'd1_migrations'
export const HASHES = 'euneos_migration_hashes'
const GUARD = 'euneos_migration_guard'
export const nativeDDL = `CREATE TABLE IF NOT EXISTS ${NATIVE} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`
export const hashesDDL = `CREATE TABLE IF NOT EXISTS ${HASHES} (
  name TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`
export const schemaQuery = 'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'
const businessWhere = `name NOT LIKE 'sqlite_%' AND tbl_name NOT IN ('_cf_KV','_cf_METADATA','${NATIVE}','${HASHES}','${GUARD}')`
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

// Only insignificant formatting and identifier quoting are normalized. String
// literals (including CHECK values/defaults) keep their case and whitespace.
const sqlToken =
  /--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][\w]*|\d+(?:\.\d+)?|[^\s]/g
function tokens(sql) {
  return sql.match(sqlToken) ?? []
}
export function statements(sql) {
  const result = []
  let start = 0
  let words = [],
    depth = 0,
    trigger = false
  for (const token of sql.matchAll(sqlToken)) {
    const word = token[0].toLowerCase()
    if (/^[a-z_][\w]*$/i.test(word)) {
      words.push(word)
      if (words[0] === 'create' && words.includes('trigger')) trigger = true
      if (trigger && ['begin', 'case'].includes(word)) depth++
      if (trigger && word === 'end') depth--
    }
    if (word !== ';' || (trigger && depth > 0)) continue
    result.push(sql.slice(start, token.index + 1))
    start = token.index + 1
    words = []
    depth = 0
    trigger = false
  }
  if (normalizeSQL(sql.slice(start))) result.push(sql.slice(start))
  return result
}
export function executeSQLite(db, sql) {
  // Bun 1.4 can swallow an intermediate error in exec(multiStatementSQL).
  // Check every statement; the caller owns the enclosing transaction.
  for (const statement of statements(sql)) db.exec(statement)
}
export function normalizeSQL(sql) {
  return tokens(sql ?? '')
    .filter((t) => !t.startsWith('--') && !t.startsWith('/*'))
    .map((t) => (t.startsWith("'") ? t : t.replace(/^["`\[]|["`\]]$/g, '').toLowerCase()))
    .join(' ')
}
export function businessSchema(rows) {
  return rows
    .filter(
      (r) =>
        !r.name.startsWith('sqlite_') &&
        !['_cf_KV', '_cf_METADATA', NATIVE, HASHES, GUARD].includes(r.tbl_name),
    )
    .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`))
}
export function schemaFingerprint(rows) {
  return sha256(
    JSON.stringify(businessSchema(rows).map((r) => ({ ...r, sql: normalizeSQL(r.sql) }))),
  )
}
export function validateSQL(sql) {
  const normalized = normalizeSQL(sql)
  requireThat(
    !statements(sql).some((statement) =>
      /^(begin|commit|end|rollback|savepoint|release|attach|detach|vacuum)\b/.test(
        normalizeSQL(statement),
      ),
    ),
    'Migration: transaction explicite ou commande hors transaction interdite',
  )
  requireThat(
    !tokens(sql).some((t) =>
      [NATIVE, HASHES, GUARD, 'sqlite_schema', 'sqlite_master', '_cf_kv', '_cf_metadata'].includes(
        t.replace(/^["'`\[]|["'`\]]$/g, '').toLowerCase(),
      ),
    ),
    'Migration: registre ou schéma système réservé',
  )
  for (const pragma of normalized.matchAll(/\bpragma\b([^;]*)(?:;|$)/g)) {
    requireThat(
      /^\s*(defer_foreign_keys|foreign_keys)\s*=\s*(on|true|1)\s*$/.test(pragma[1]) ||
        /^\s*foreign_key_check\s*$/.test(pragma[1]),
      'Migration: PRAGMA non autorisé',
    )
  }
}
export function loadMigrations(directory = 'migrations/interne') {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  requireThat(names.length >= history.length, 'Historique 0001–0004 incomplet')
  const migrations = names.map((name, index) => {
    requireThat(
      /^\d{4}_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, 4)) === index + 1,
      `Numérotation absente, dupliquée ou non consécutive: ${name}`,
    )
    const sql = readFileSync(join(directory, name), 'utf8')
    validateSQL(sql)
    return { name, sql, sha256: sha256(sql) }
  })
  requireThat(
    equal(
      migrations.slice(0, history.length).map(({ name, sha256 }) => ({ name, sha256 })),
      history,
    ),
    'Historique 0001–0004 modifié: créer une nouvelle migration',
  )
  return migrations
}
export const planHash = (migrations) =>
  sha256(JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 }))))

export function expectedSchema(migrations) {
  const db = new Database(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON')
    for (const migration of migrations) db.transaction(() => executeSQLite(db, migration.sql))()
    return db.query(schemaQuery).all()
  } finally {
    db.close()
  }
}
function validateControlSchema(rows) {
  const db = new Database(':memory:')
  try {
    db.exec(nativeDDL + hashesDDL)
    for (const table of [NATIVE, HASHES]) {
      const actual = rows.filter((r) => r.tbl_name === table && !r.name.startsWith('sqlite_'))
      if (!actual.length) continue
      const expected = db
        .query(schemaQuery)
        .all()
        .filter((r) => r.tbl_name === table && !r.name.startsWith('sqlite_'))
      requireThat(
        equal(
          actual.map((r) => ({ ...r, sql: normalizeSQL(r.sql) })),
          expected.map((r) => ({ ...r, sql: normalizeSQL(r.sql) })),
        ),
        `Structure du registre inattendue: ${table}`,
      )
    }
    requireThat(
      !rows.some((r) => r.tbl_name === GUARD),
      'Garde résiduelle: arrêter et examiner la base',
    )
  } finally {
    db.close()
  }
}
function bootstrapControls(rows) {
  const db = new Database(':memory:')
  try {
    db.exec(nativeDDL + hashesDDL)
    return [NATIVE, HASHES].map(
      (name) =>
        rows.find((r) => r.name === name) ??
        db
          .query(schemaQuery)
          .all()
          .find((r) => r.name === name),
    )
  } finally {
    db.close()
  }
}
export function readLocalState(db) {
  const schema = db.query(schemaQuery).all()
  const exists = (name) => schema.some((r) => r.type === 'table' && r.name === name)
  return {
    schema,
    ledger: exists(NATIVE) ? db.query(`SELECT name FROM ${NATIVE} ORDER BY id`).all() : [],
    hashes: exists(HASHES) ? db.query(`SELECT name,sha256 FROM ${HASHES} ORDER BY name`).all() : [],
    integrity: db.query('PRAGMA quick_check').all(),
    foreignKeys: db.query('PRAGMA foreign_key_check').all(),
  }
}
function health(state) {
  requireThat(
    equal(state.integrity, [{ quick_check: 'ok' }]) && state.foreignKeys.length === 0,
    'Intégrité SQLite ou clés étrangères invalides',
  )
  validateControlSchema(state.schema)
}
function prefixLength(ledger, migrations) {
  const names = ledger.map((r) => r.name)
  requireThat(
    equal(
      names,
      migrations.slice(0, names.length).map((m) => m.name),
    ),
    'Registre distant inconnu, incomplet ou désordonné; aucun rattrapage automatique',
  )
  return names.length
}
export function validateState(state, migrations) {
  health(state)
  const count = prefixLength(state.ledger, migrations)
  requireThat(count >= history.length, 'Bootstrap local requis: ne jamais rejouer 0001–0004')
  requireThat(
    equal(
      state.hashes,
      migrations.slice(0, count).map(({ name, sha256 }) => ({ name, sha256 })),
    ),
    'Empreintes absentes ou modifiées; bootstrap/revue requis',
  )
  requireThat(
    schemaFingerprint(state.schema) ===
      schemaFingerprint(expectedSchema(migrations.slice(0, count))),
    'Schéma divergent du registre (colonnes, CHECK, index, FK, triggers ou tables)',
  )
  return count
}

const assertSQL = (condition) =>
  `INSERT INTO ${GUARD}(ok) SELECT CASE WHEN (${condition}) THEN 1 ELSE 0 END;`
const guardStart = `CREATE TABLE ${GUARD}(ok INTEGER NOT NULL CHECK(ok=1));`
const guardEnd = `DROP TABLE ${GUARD};`
function schemaCondition(rows) {
  const schema = businessSchema(rows)
  return (
    `(SELECT count(*) FROM sqlite_schema WHERE ${businessWhere})=${schema.length} AND ` +
    schema
      .map(
        (r) =>
          `EXISTS(SELECT 1 FROM sqlite_schema WHERE type=${literal(r.type)} AND name=${literal(r.name)} AND tbl_name=${literal(r.tbl_name)} AND sql=${literal(r.sql)})`,
      )
      .join(' AND ')
  )
}
function ledgerCondition(names) {
  return (
    `(SELECT count(*) FROM ${NATIVE})=${names.length}` +
    names.map((name) => ` AND EXISTS(SELECT 1 FROM ${NATIVE} WHERE name=${literal(name)})`).join('')
  )
}
function hashesCondition(migrations) {
  return (
    `(SELECT count(*) FROM ${HASHES})=${migrations.length}` +
    migrations
      .map(
        (m) =>
          ` AND EXISTS(SELECT 1 FROM ${HASHES} WHERE name=${literal(m.name)} AND sha256=${literal(m.sha256)})`,
      )
      .join('')
  )
}
function controlConditions(rows) {
  const controls = rows.filter(
    (r) => [NATIVE, HASHES].includes(r.tbl_name) && !r.name.startsWith('sqlite_'),
  )
  return [
    assertSQL(
      `(SELECT count(*) FROM sqlite_schema WHERE tbl_name IN ('${NATIVE}','${HASHES}') AND name NOT LIKE 'sqlite_%')=${controls.length}`,
    ),
    ...controls.map((r) =>
      assertSQL(
        `EXISTS(SELECT 1 FROM sqlite_schema WHERE name=${literal(r.name)} AND sql=${literal(r.sql)})`,
      ),
    ),
  ].join('\n')
}
function register(migration, adopt = false) {
  const conflict = adopt ? ' ON CONFLICT(name) DO NOTHING' : ''
  return `INSERT INTO ${NATIVE}(name) VALUES(${literal(migration.name)})${conflict};
INSERT INTO ${HASHES}(name,sha256) VALUES(${literal(migration.name)},${literal(migration.sha256)})${conflict};`
}
export function bootstrapSQL(state, migrations, names) {
  health(state)
  requireThat(
    names.length >= history.length &&
      equal(
        names,
        migrations.slice(0, names.length).map((m) => m.name),
      ),
    'Adopter explicitement un préfixe complet, au minimum 0001–0004',
  )
  const adopted = migrations.slice(0, names.length)
  const count = prefixLength(state.ledger, adopted)
  requireThat(
    !state.hashes.length ||
      equal(
        state.hashes,
        adopted.slice(0, count).map(({ name, sha256 }) => ({ name, sha256 })),
      ),
    'Empreintes existantes incompatibles avec le bootstrap',
  )
  requireThat(
    schemaFingerprint(state.schema) === schemaFingerprint(expectedSchema(adopted)),
    'Bootstrap refusé: le schéma exact du préfixe déclaré ne correspond pas',
  )
  return [
    '-- Adoption uniquement: aucun SQL métier 0001–0004 n’est rejoué. Exécuter en UN lot D1.',
    guardStart,
    assertSQL(schemaCondition(state.schema)),
    nativeDDL,
    hashesDDL,
    controlConditions(bootstrapControls(state.schema)),
    assertSQL(
      `(${ledgerCondition(state.ledger.map((r) => r.name))}) OR (${ledgerCondition(names)})`,
    ),
    assertSQL(`(${hashesCondition(state.hashes)}) OR (${hashesCondition(adopted)})`),
    ...adopted.map((m) => register(m, true)),
    assertSQL(ledgerCondition(names)),
    assertSQL(hashesCondition(adopted)),
    guardEnd,
  ].join('\n')
}
export function migrationSQL(state, migrations) {
  const count = validateState(state, migrations)
  if (count === migrations.length) return null
  const next = migrations[count]
  // The ledger claim, snapshot check, DDL, and hash commit share ONE D1 query
  // transaction (the same transport Wrangler migrations apply uses). A stale
  // concurrent claimant fails before business SQL, never replays a rebuild.
  return [
    guardStart,
    assertSQL(schemaCondition(state.schema)),
    controlConditions(state.schema),
    assertSQL(ledgerCondition(state.ledger.map((r) => r.name))),
    assertSQL(hashesCondition(migrations.slice(0, count))),
    register(next),
    next.sql,
    guardEnd,
  ].join('\n')
}
