import type { WorkspaceDatabase } from './internal-workspace'
import { WorkspaceError } from './internal-workspace'
export const categoricalColumns = [
  'Type de média',
  'Type',
  'Statut',
  'Priorité',
  'Tags',
  'Vivier',
  'Public principal',
]
export type CommunicationChoice = {
  id: string
  scope: string
  column_name: string
  value: string
  role: string
  version: number
  deleted_at: string | null
}
export type ChoiceAlias = { scope: string; column_name: string; value: string; choice_id: string }
export type ChoiceCatalog = { choices: CommunicationChoice[]; aliases: ChoiceAlias[] }
export const choiceScope = (table: string, column: string) =>
  column === 'Statut' ? 'status' : table
export const splitChoices = (column: string, value: string) =>
  column === 'Tags'
    ? value
        .split(/[,;\n]/)
        .map((v) => v.trim())
        .filter(Boolean)
    : value.trim()
      ? [value.trim()]
      : []
export async function readChoices(db: WorkspaceDatabase, table: string): Promise<ChoiceCatalog> {
  const choices = await db
    .prepare("SELECT * FROM communication_choices WHERE scope IN (?,'status') ORDER BY rowid")
    .bind(table)
    .all<CommunicationChoice>()
  const aliases = await db
    .prepare("SELECT * FROM communication_choice_aliases WHERE scope IN (?,'status')")
    .bind(table)
    .all<ChoiceAlias>()
  return { choices: choices.results, aliases: aliases.results }
}
export function resolveChoice(
  catalog: ChoiceCatalog,
  table: string,
  column: string,
  value: string,
) {
  const scope = choiceScope(table, column),
    alias = catalog.aliases.find(
      (a) => a.scope === scope && a.column_name === column && a.value === value,
    )
  return alias ? catalog.choices.find((c) => c.id === alias.choice_id) : undefined
}
export function resolveCells(
  cells: string[],
  columns: string[],
  table: string,
  catalog: ChoiceCatalog,
  strict = false,
) {
  return cells.map((cell, i) => {
    const column = columns[i]
    if (!categoricalColumns.includes(column)) return cell
    return [
      ...new Set(
        splitChoices(column, cell).flatMap((value) => {
          const choice = resolveChoice(catalog, table, column, value)
          if (strict && (!choice || choice.deleted_at))
            throw new WorkspaceError(
              409,
              'Une valeur de ce menu a changé. Actualisez les choix avant d’enregistrer votre fiche.',
            )
          return choice ? (choice.deleted_at ? [] : [choice.value]) : [value]
        }),
      ),
    ].join(column === 'Tags' ? ', ' : '')
  })
}
export function effectiveChoiceCells(
  cells: string[],
  columns: string[],
  table: string,
  catalog: ChoiceCatalog,
  since: string,
  now = Date.now(),
) {
  const result = resolveCells(cells, columns, table, catalog),
    index = columns.indexOf('Statut'),
    start = Date.parse(since)
  if (
    index >= 0 &&
    resolveChoice(catalog, table, 'Statut', result[index])?.role === 'waiting' &&
    Number.isFinite(start) &&
    now - start >= 20 * 86400000
  ) {
    const next = catalog.choices.find(
      (c) => c.scope === 'status' && c.role === 'followup' && !c.deleted_at,
    )
    if (next) result[index] = next.value
  }
  return result
}
export async function mutateChoice(
  db: WorkspaceDatabase,
  table: string,
  body: Record<string, unknown>,
) {
  const column = body.column
  if (typeof column !== 'string' || !categoricalColumns.includes(column))
    throw new WorkspaceError(400, 'Menu inconnu.')
  const scope = choiceScope(table, column),
    action = body.choiceAction
  if (!['add', 'rename', 'delete'].includes(String(action)))
    throw new WorkspaceError(400, 'Action inconnue.')
  const value = typeof body.value === 'string' ? body.value.trim() : ''
  if (
    action !== 'delete' &&
    (!value ||
      value.length > 160 ||
      /[\r\n]/.test(value) ||
      (column === 'Tags' && /[,;]/.test(value)))
  )
    throw new WorkspaceError(
      400,
      'Saisissez une valeur de 1 à 160 caractères (un seul tag à la fois).',
    )
  if (action === 'add') {
    const existing = await db
      .prepare(
        'SELECT c.* FROM communication_choice_aliases a JOIN communication_choices c ON c.id=a.choice_id WHERE a.scope=? AND a.column_name=? AND a.value=?',
      )
      .bind(scope, column, value)
      .first<CommunicationChoice>()
    if (existing) {
      if (existing.deleted_at) {
        const restored = await db
          .prepare(
            'UPDATE communication_choices SET deleted_at=NULL,version=version+1 WHERE id=? AND version=?',
          )
          .bind(existing.id, existing.version)
          .run()
        if (restored.meta.changes < 1)
          throw new WorkspaceError(
            409,
            'Cette valeur a changé. Actualisez le menu avant de réessayer.',
          )
      } else if (existing.value !== value)
        throw new WorkspaceError(409, `Cette valeur a été renommée « ${existing.value} ».`)
      return existing.id
    }
    const id = crypto.randomUUID()
    await db
      .prepare('INSERT INTO communication_choices(id,scope,column_name,value) VALUES(?,?,?,?)')
      .bind(id, scope, column, value)
      .run()
    return id
  }
  if (typeof body.choiceId !== 'string' || !Number.isSafeInteger(body.version))
    throw new WorkspaceError(400, 'Valeur ou version invalide.')
  const saved =
    action === 'rename'
      ? await db
          .prepare(
            `UPDATE communication_choices SET value=?,version=version+1 WHERE id=? AND scope=? AND column_name=? AND version=? AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM communication_choice_aliases a WHERE a.scope=? AND a.column_name=? AND a.value=? AND a.choice_id<>?)`,
          )
          .bind(
            value,
            body.choiceId,
            scope,
            column,
            Number(body.version),
            scope,
            column,
            value,
            body.choiceId,
          )
          .run()
      : await db
          .prepare(
            "UPDATE communication_choices SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE id=? AND scope=? AND column_name=? AND version=? AND deleted_at IS NULL",
          )
          .bind(body.choiceId, scope, column, Number(body.version))
          .run()
  if (saved.meta.changes < 1)
    throw new WorkspaceError(
      409,
      'Cette valeur a déjà changé ou ce nom est utilisé. Actualisez les choix avant de réessayer.',
    )
  return body.choiceId
}
