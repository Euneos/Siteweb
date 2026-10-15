import {
  WorkspaceError,
  type WorkspaceDatabase,
  type WorkspaceIdentity,
} from './internal-workspace'

export const taskPeople = ['Candice', 'Charlotte', 'Pauline'] as const
export const taskStatuses = [
  { id: 'en-cours', label: 'Tâches en cours' },
  { id: 'today', label: 'To do today' },
  { id: 'en-attente', label: 'Tâches en file d’attente' },
] as const
export type TaskInput = { title: string; description: string; person: string; status: string }
export type TeamTask = TaskInput & {
  id: string
  version: number
  created_at: string
  updated_at: string
}

export function parseTask(value: unknown): TaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkspaceError(400, 'Tâche invalide.')
  const input = value as Record<string, unknown>
  const text = (key: string, max: number, required = false) => {
    const value = input[key]
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
      throw new WorkspaceError(400, 'Vérifiez le titre et la description de la tâche.')
    return value.trim()
  }
  const title = text('title', 180, true)
  const description = text('description', 4000)
  if (
    !taskPeople.some((person) => person === input.person) ||
    !taskStatuses.some((status) => status.id === input.status)
  )
    throw new WorkspaceError(400, 'Personne ou statut invalide.')
  return { title, description, person: input.person as string, status: input.status as string }
}
export async function listTasks(db: WorkspaceDatabase) {
  return (
    await db
      .prepare(
        'SELECT id, title, description, person, status, version, created_at, updated_at FROM team_tasks ORDER BY created_at, id',
      )
      .bind()
      .all<TeamTask>()
  ).results
}
export async function saveTask(
  db: WorkspaceDatabase,
  identity: WorkspaceIdentity,
  id: string,
  value: unknown,
  version?: unknown,
) {
  const task = parseTask(value)
  const now = new Date().toISOString()
  if (version !== undefined) {
    if (!Number.isSafeInteger(version) || (version as number) < 1)
      throw new WorkspaceError(400, 'Version invalide.')
    const result = await db
      .prepare(
        'UPDATE team_tasks SET title = ?, description = ?, person = ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?',
      )
      .bind(
        task.title,
        task.description,
        task.person,
        task.status,
        identity.email,
        now,
        id,
        version as number,
      )
      .run()
    if (result.meta.changes !== 1)
      throw new WorkspaceError(
        409,
        'Cette tâche a changé. Actualisez le tableau avant de la modifier.',
      )
  } else {
    const result = await db
      .prepare(
        'INSERT INTO team_tasks (id, title, description, person, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(
        id,
        task.title,
        task.description,
        task.person,
        task.status,
        identity.email,
        identity.email,
        now,
        now,
      )
      .run()
    if (result.meta.changes !== 1)
      throw new WorkspaceError(
        409,
        'Cette création a déjà été reçue. Actualisez le tableau pour la retrouver.',
      )
  }
  const saved = await db
    .prepare(
      'SELECT id, title, description, person, status, version, created_at, updated_at FROM team_tasks WHERE id = ?',
    )
    .bind(id)
    .first<TeamTask>()
  if (!saved) throw new WorkspaceError(503, 'Enregistrement non confirmé. Actualisez le tableau.')
  return saved
}
