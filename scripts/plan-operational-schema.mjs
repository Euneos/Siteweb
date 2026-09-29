import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const manifest = JSON.parse(
  readFileSync(new URL('../migrations/nocodb/operational-forms-3-5.json', import.meta.url), 'utf8'),
)

/** Offline additive migration plan from a private metadata snapshot. Never calls
 * NocoDB, accepts credentials, alters existing columns, or changes records. */
export function planOperationalSchema(metadata) {
  if (metadata?.title !== manifest.table || !Array.isArray(metadata.columns))
    throw new Error('Expected metadata for the participations table')
  const add = [],
    existing = []
  for (const column of manifest.columns) {
    const matches = metadata.columns.filter(
      (c) => c.title === column.title || c.column_name === column.title,
    )
    if (matches.length > 1) throw new Error(`Ambiguous column: ${column.title}`)
    if (!matches.length) {
      add.push({ ...column, column_name: column.title, rqd: false })
      continue
    }
    const found = matches[0]
    const nativeFalse = column.uidt === 'Checkbox' && [false, 'false', 0, '0'].includes(found.cdf)
    if (
      found.title !== column.title ||
      found.uidt !== column.uidt ||
      found.pk ||
      found.rqd ||
      found.unique ||
      (found.cdf != null && found.cdf !== '' && !nativeFalse)
    )
      throw new Error(`Incompatible existing column: ${column.title}`)
    existing.push(column.title)
  }
  return {
    table: manifest.table,
    addColumns: add,
    existingColumns: existing,
    updateColumns: [],
    deleteColumns: [],
    recordWrites: [],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3)
    throw new Error(
      'Usage: bun scripts/plan-operational-schema.mjs <private-metadata.json> (offline only)',
    )
  process.stdout.write(
    JSON.stringify(
      planOperationalSchema(JSON.parse(readFileSync(process.argv[2], 'utf8'))),
      null,
      2,
    ) + '\n',
  )
}
