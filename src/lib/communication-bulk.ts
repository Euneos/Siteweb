import { moveCommunicationRows } from './communication-move'
import type { WorkspaceDatabase } from './internal-workspace'
import { WorkspaceError } from './internal-workspace'
export async function mutateCommunicationRows(
  db: WorkspaceDatabase,
  table: string,
  body: Record<string, unknown>,
  actor: string,
) {
  const action = body.bulkAction
  if (
    !['duplicate', 'delete', 'restore', 'move'].includes(String(action)) ||
    !Array.isArray(body.rows) ||
    !body.rows.length ||
    body.rows.length > 200
  )
    throw new WorkspaceError(400, 'Sélectionnez de 1 à 200 lignes.')
  const rows = body.rows as { id: string; version: number }[]
  if (
    rows.some(
      (r) =>
        !r ||
        typeof r.id !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(r.id) ||
        !Number.isSafeInteger(r.version) ||
        r.version < 1,
    ) ||
    new Set(rows.map((r) => r.id)).size !== rows.length
  )
    throw new WorkspaceError(400, 'Sélection invalide.')
  if (action === 'move') return moveCommunicationRows(db, table, body, actor)
  const payload = JSON.stringify(rows.map((r) => ({ ...r, newId: crypto.randomUUID() }))),
    state = action === 'restore' ? 'IS NOT NULL' : 'IS NULL'
  const matched = `SELECT count(*) FROM json_each(?) picked JOIN communication_rows r ON r.id=json_extract(picked.value,'$.id') AND r.version=json_extract(picked.value,'$.version') JOIN communication_sheets s ON s.id=r.sheet_id WHERE s.collection=? AND s.guide=0 AND r.deleted_at ${state}`
  let result
  if (action === 'duplicate')
    result = await db
      .prepare(
        `INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) SELECT json_extract(picked.value,'$.newId'),r.sheet_id,r.cells_json,? FROM json_each(?) picked JOIN communication_rows r ON r.id=json_extract(picked.value,'$.id') JOIN communication_sheets s ON s.id=r.sheet_id WHERE s.collection=? AND s.guide=0 AND r.deleted_at IS NULL AND (${matched})=? RETURNING id`,
      )
      .bind(actor, payload, table, payload, table, rows.length)
      .all<{ id: string }>()
  else
    result = await db
      .prepare(
        `UPDATE communication_rows SET deleted_at=${action === 'delete' ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'},deleted_by=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND (${matched})=? RETURNING id`,
      )
      .bind(action === 'delete' ? actor : null, actor, payload, payload, table, rows.length)
      .all<{ id: string }>()
  if (result.results.length !== rows.length)
    throw new WorkspaceError(
      409,
      'Une ligne a changé depuis la sélection. Actualisez le tableau puis sélectionnez de nouveau les lignes ; aucune action partielle n’a été appliquée.',
    )
  return result.results.length
}
