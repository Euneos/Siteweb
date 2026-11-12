import { mutateCommunicationRows } from '../../../../lib/communication-bulk'
import {
  readChoices,
  mutateChoice,
  resolveCells,
  effectiveChoiceCells,
} from '../../../../lib/communication-choices'
import type { APIRoute } from 'astro'
import {
  getInternalContext,
  privateJson,
  internalError,
  readInternalBody,
  entryId,
} from '../../../../lib/internal-context'
import { isCommunicationTable, validateCommunicationRow } from '../../../../lib/communication'
import { WorkspaceError } from '../../../../lib/internal-workspace'
export const prerender = false
export const GET: APIRoute = async ({ request, locals, params }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const table = params.table ?? ''
    if (!isCommunicationTable(table)) throw new WorkspaceError(404, 'Tableau inconnu.')
    const sheets = await context.db
      .prepare(
        'SELECT id,title,columns_json,guide FROM communication_sheets WHERE collection=? ORDER BY position',
      )
      .bind(table)
      .all<{ id: string; title: string; columns_json: string; guide: number }>()
    const rows = await context.db
      .prepare(
        'SELECT r.* FROM communication_rows r JOIN communication_sheets s ON r.sheet_id=s.id WHERE s.collection=? ORDER BY r.rowid',
      )
      .bind(table)
      .all<{
        id: string
        sheet_id: string
        cells_json: string
        version: number
        updated_by: string
        updated_at: string
        status_changed_at: string
        deleted_at: string | null
        deleted_by: string | null
      }>()
    const catalog = await readChoices(context.db, table)
    const resolved = rows.results.map(({ cells_json, ...r }) => ({
      ...r,
      cells: effectiveChoiceCells(
        JSON.parse(cells_json),
        JSON.parse(sheets.results.find((s) => s.id === r.sheet_id)!.columns_json),
        table,
        catalog,
        r.status_changed_at || r.updated_at,
      ),
    }))
    const destinations = await context.db
      .prepare(
        'SELECT id,collection,title FROM communication_sheets WHERE guide=0 ORDER BY position',
      )
      .bind()
      .all<{ id: string; collection: string; title: string }>()
    return privateJson({
      destinations: destinations.results,
      ...catalog,
      sheets: sheets.results.map(({ columns_json, guide, ...s }) => ({
        ...s,
        columns: JSON.parse(columns_json),
        guide: !!guide,
      })),
      rows: resolved.filter((r) => !r.deleted_at),
      deletedRows: resolved.filter((r) => r.deleted_at),
    })
  } catch (error) {
    return internalError(error)
  }
}
export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const table = params.table ?? ''
    if (!isCommunicationTable(table)) throw new WorkspaceError(404, 'Tableau inconnu.')
    const body = await readInternalBody(request)
    if (body.bulkAction) {
      const count = await mutateCommunicationRows(context.db, table, body, context.identity.email)
      return privateJson({ count })
    }
    if (body.choiceAction) {
      const id = await mutateChoice(context.db, table, body)
      return privateJson({ id })
    }
    const id = entryId(body.id)
    if (typeof body.sheet_id !== 'string') throw new WorkspaceError(400, 'Onglet invalide.')
    const sheetId = body.sheet_id
    const sheet = await context.db
      .prepare('SELECT columns_json,guide FROM communication_sheets WHERE id=? AND collection=?')
      .bind(sheetId, table)
      .first<{ columns_json: string; guide: number }>()
    if (!sheet || sheet.guide) throw new WorkspaceError(400, 'Onglet non modifiable.')
    const columns: string[] = JSON.parse(sheet.columns_json)
    if (['suivimedias', 'partenariats'].includes(table) && columns.includes('Attribution')) {
      const attribution = Array.isArray(body.cells)
        ? body.cells[columns.indexOf('Attribution')]
        : null
      if (!['', 'Candice', 'Charlotte', 'Pauline'].includes(attribution as string))
        throw new WorkspaceError(400, 'Attribution invalide.')
    }
    const catalog = await readChoices(context.db, table)
    const cells = resolveCells(
      validateCommunicationRow(body, columns),
      columns,
      table,
      catalog,
      true,
    )
    const saved =
      body.version === 0
        ? await context.db
            .prepare(
              'INSERT INTO communication_rows(id,sheet_id,cells_json,updated_by) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',
            )
            .bind(id, sheetId, JSON.stringify(cells), context.identity.email)
            .run()
        : await context.db
            .prepare(
              "UPDATE communication_rows SET cells_json=?,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE id=? AND sheet_id=? AND version=? AND deleted_at IS NULL",
            )
            .bind(JSON.stringify(cells), context.identity.email, id, sheetId, Number(body.version))
            .run()
    if (saved.meta.changes < 1) {
      const existing = await context.db
        .prepare('SELECT cells_json,updated_by,sheet_id FROM communication_rows WHERE id=?')
        .bind(id)
        .first<{ cells_json: string; updated_by: string; sheet_id: string }>()
      // Repeating a confirmed create is safe; never duplicate a fiche after a lost response.
      if (!(
        body.version === 0 &&
        existing?.cells_json === JSON.stringify(cells) &&
        existing.updated_by === context.identity.email &&
        existing.sheet_id === body.sheet_id
      ))
        throw new WorkspaceError(
          409,
          'Cette fiche a changé. Votre saisie est conservée : fermez la fiche, actualisez puis comparez avant de réessayer.',
        )
    }
    return privateJson({ id })
  } catch (error) {
    return internalError(error)
  }
}
