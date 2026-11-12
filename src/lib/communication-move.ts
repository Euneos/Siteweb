import type { WorkspaceDatabase } from './internal-workspace'
import { WorkspaceError } from './internal-workspace'
import { isCommunicationTable } from './communication'

// Keep matching columns, map the name/link, and retain every unmatched value in Notes.
export function mapCommunicationCells(cells: string[], source: string[], target: string[]) {
  const used = new Set<number>()
  const groups = [
    ['Nom', 'Nom média', 'Structure ou personne', 'Association'],
    ['Lien', 'Site', 'Source'],
  ]
  const result = target.map((label) => {
    let index = source.indexOf(label)
    if (index < 0) {
      const equivalents = groups.find((group) => group.includes(label))
      if (equivalents)
        index = source.findIndex(
          (name, i) => equivalents.includes(name) && !!cells[i] && !used.has(i),
        )
    }
    if (index < 0) return ''
    used.add(index)
    return cells[index] || ''
  })
  const extras = source.flatMap((label, i) =>
    !used.has(i) && cells[i] ? [`${label} : ${cells[i]}`] : [],
  )
  const notes = target.indexOf('Notes')
  if (extras.length && notes < 0)
    throw new WorkspaceError(
      409,
      'Cette feuille ne peut pas encore conserver les champs d’origine. Actualisez le tableau.',
    )
  if (notes >= 0) result[notes] = [result[notes], ...extras].filter(Boolean).join('\n\n')
  if (result.some((value) => value.length > 10000))
    throw new WorkspaceError(
      400,
      'Les notes réunies dépassent 10 000 caractères. Déplacez cette fiche après avoir raccourci ses notes.',
    )
  return result
}
export async function moveCommunicationRows(
  db: WorkspaceDatabase,
  table: string,
  body: Record<string, unknown>,
  actor: string,
) {
  if (
    !isCommunicationTable(String(body.targetTable)) ||
    body.targetTable === table ||
    typeof body.targetSheet !== 'string'
  )
    throw new WorkspaceError(400, 'Choisissez un autre tableau et une feuille de destination.')
  const target = await db
    .prepare(
      'SELECT id,columns_json FROM communication_sheets WHERE id=? AND collection=? AND guide=0',
    )
    .bind(body.targetSheet, String(body.targetTable))
    .first<{ id: string; columns_json: string }>()
  if (!target) throw new WorkspaceError(400, 'La feuille de destination est indisponible.')
  const selected = body.rows as { id: string; version: number }[] // IDs and versions validated by bulk entry point.
  const source = await db
    .prepare(
      "SELECT r.id,r.version,r.cells_json,s.columns_json FROM communication_rows r JOIN communication_sheets s ON s.id=r.sheet_id WHERE s.collection=? AND s.guide=0 AND r.deleted_at IS NULL AND r.id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
    )
    .bind(table, JSON.stringify(selected))
    .all<{ id: string; version: number; cells_json: string; columns_json: string }>()
  if (
    source.results.length !== selected.length ||
    source.results.some((r) => selected.find((s) => s.id === r.id)?.version !== r.version)
  )
    throw new WorkspaceError(
      409,
      'Une ligne a changé. Actualisez la sélection ; aucune ligne n’a été déplacée.',
    )
  const payload = JSON.stringify(
    source.results.map((r) => ({
      id: r.id,
      version: r.version,
      cells: mapCommunicationCells(
        JSON.parse(r.cells_json),
        JSON.parse(r.columns_json),
        JSON.parse(target.columns_json),
      ),
    })),
  )
  const result = await db
    .prepare(
      `UPDATE communication_rows SET sheet_id=?,cells_json=(SELECT json_extract(value,'$.cells') FROM json_each(?) WHERE json_extract(value,'$.id')=communication_rows.id),updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND (SELECT count(*) FROM json_each(?) p JOIN communication_rows r ON r.id=json_extract(p.value,'$.id') AND r.version=json_extract(p.value,'$.version') JOIN communication_sheets s ON s.id=r.sheet_id WHERE s.collection=? AND s.guide=0 AND r.deleted_at IS NULL)=? RETURNING id`,
    )
    .bind(target.id, payload, actor, payload, payload, table, selected.length)
    .all<{ id: string }>()
  if (result.results.length !== selected.length)
    throw new WorkspaceError(
      409,
      'Une ligne a changé. Actualisez la sélection ; aucune ligne n’a été déplacée.',
    )
  return result.results.length
}
