import {
  WorkspaceError,
  type WorkspaceDatabase,
  type WorkspaceIdentity,
} from './internal-workspace'

export const taskPeople = ['Candice', 'Charlotte', 'Pauline'] as const
export const taskStatuses = [
  { id: 'today', label: 'À faire aujourd’hui' },
  { id: 'en-cours', label: 'En cours' },
  { id: 'en-attente', label: 'En file d’attente' },
  { id: 'terminee', label: 'Terminées' },
] as const
export type TaskInput = {
  title: string
  description: string
  person: string
  status: string
  contributors: string[]
  priority: boolean
  due_on: string
  blocked: boolean
  blocker: string
  archived: boolean
}
export type TeamTask = TaskInput & {
  id: string
  version: number
  created_at: string
  updated_at: string
  completed_at: string
  archived_at: string
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
  const contributors = input.contributors === undefined ? [] : input.contributors
  if (
    !Array.isArray(contributors) ||
    contributors.length > taskPeople.length - 1 ||
    contributors.some((person) => !taskPeople.some((known) => known === person)) ||
    new Set(contributors).size !== contributors.length ||
    contributors.includes(input.person)
  )
    throw new WorkspaceError(400, 'Choisissez des contributeurs distincts du responsable.')
  for (const key of ['priority', 'blocked', 'archived']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new WorkspaceError(400, 'Option de tâche invalide.')
  }
  const due = input.due_on ?? ''
  if (
    typeof due !== 'string' ||
    (due !== '' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(due) ||
        due < '1900-01-01' ||
        due > '2200-12-31' ||
        !Number.isFinite(Date.parse(due)) ||
        new Date(due).toISOString().slice(0, 10) !== due))
  )
    throw new WorkspaceError(400, 'Échéance invalide.')
  const blocker = input.blocker ?? ''
  if (
    typeof blocker !== 'string' ||
    blocker.length > 1000 ||
    (input.blocked === true && !blocker.trim())
  )
    throw new WorkspaceError(400, 'Précisez la raison du blocage (1 000 caractères maximum).')
  if (input.archived === true && input.status !== 'terminee')
    throw new WorkspaceError(400, 'Seule une tâche terminée peut être archivée.')
  return {
    title,
    description,
    person: input.person as string,
    status: input.status as string,
    contributors: taskPeople.filter((person) => contributors.includes(person)),
    priority: input.priority === true,
    due_on: due,
    blocked: input.blocked === true,
    blocker: blocker.trim(),
    archived: input.archived === true,
  }
}
type StoredTask = Omit<TeamTask, 'contributors' | 'priority' | 'blocked' | 'archived'> & {
  contributors: string
  priority: number
  blocked: number
}
const taskColumns =
  'id, title, description, person, status, contributors, priority, due_on, blocked, blocker, completed_at, archived_at, version, created_at, updated_at'
const hydrateTask = (row: StoredTask): TeamTask => ({
  ...row,
  contributors: JSON.parse(row.contributors),
  priority: row.priority === 1,
  blocked: row.blocked === 1,
  archived: row.archived_at !== '',
  status: row.completed_at ? 'terminee' : row.status,
})
export async function listTasks(db: WorkspaceDatabase) {
  return (
    await db
      .prepare(`SELECT ${taskColumns} FROM team_tasks ORDER BY created_at, id`)
      .bind()
      .all<StoredTask>()
  ).results.map(hydrateTask)
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
  const notification = (nextVersion: number, previousPerson = '') =>
    db
      .prepare(
        'INSERT INTO team_task_notifications (task_id, task_version, person, title, description, task_status, assigned_by, previous_person, contributors) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1',
      )
      .bind(
        id,
        nextVersion,
        task.person,
        task.title,
        task.description,
        task.status,
        identity.email,
        previousPerson,
        JSON.stringify(task.contributors),
      )
  if (version !== undefined) {
    if (!Number.isSafeInteger(version) || (version as number) < 1)
      throw new WorkspaceError(400, 'Version invalide.')
    const previous = await db
      .prepare(`SELECT ${taskColumns} FROM team_tasks WHERE id = ? AND version = ?`)
      .bind(id, version as number)
      .first<StoredTask>()
    // Older clients do not know this field: preserve contributors on their edits.
    if (previous && !Object.hasOwn(value as object, 'contributors'))
      task.contributors = (JSON.parse(previous.contributors) as string[]).filter(
        (person) => person !== task.person,
      )
    if (previous) {
      const prior = hydrateTask(previous)
      for (const key of ['priority', 'due_on', 'blocked', 'blocker', 'archived'] as const) {
        if (!Object.hasOwn(value as object, key)) Object.assign(task, { [key]: prior[key] })
      }
      if (prior.archived && task.status !== 'terminee') task.archived = false
      parseTask(task)
    }
    const completedAt = task.status === 'terminee' ? previous?.completed_at || now : ''
    const archivedAt = task.archived ? previous?.archived_at || now : ''
    const update = db
      .prepare(
        'UPDATE team_tasks SET title = ?, description = ?, person = ?, status = ?, contributors = ?, priority = ?, due_on = ?, blocked = ?, blocker = ?, completed_at = ?, archived_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?',
      )
      .bind(
        task.title,
        task.description,
        task.person,
        task.status === 'terminee' ? previous?.status || 'en-cours' : task.status,
        JSON.stringify(task.contributors),
        Number(task.priority),
        task.due_on,
        Number(task.blocked),
        task.blocker,
        completedAt,
        archivedAt,
        identity.email,
        now,
        id,
        version as number,
      )
    // Optimistic locking and the notification share one atomic batch. A stale
    // update changes zero rows, so it cannot enqueue an assignment notification.
    const [result] = await db.batch(
      previous && previous.person !== task.person
        ? [update, notification((version as number) + 1, previous.person)]
        : [update],
    )
    if (result.meta.changes !== 1)
      throw new WorkspaceError(
        409,
        'Cette tâche a changé. Actualisez le tableau avant de la modifier.',
      )
  } else {
    const insert = db
      .prepare(
        'INSERT INTO team_tasks (id, title, description, person, status, contributors, priority, due_on, blocked, blocker, completed_at, archived_at, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(
        id,
        task.title,
        task.description,
        task.person,
        task.status === 'terminee' ? 'en-cours' : task.status,
        JSON.stringify(task.contributors),
        Number(task.priority),
        task.due_on,
        Number(task.blocked),
        task.blocker,
        task.status === 'terminee' ? now : '',
        task.archived ? now : '',
        identity.email,
        identity.email,
        now,
        now,
      )
    const [result] = await db.batch([insert, notification(1)])
    if (result.meta.changes !== 1)
      throw new WorkspaceError(
        409,
        'Cette création a déjà été reçue. Actualisez le tableau pour la retrouver.',
      )
  }
  const saved = await db
    .prepare(`SELECT ${taskColumns} FROM team_tasks WHERE id = ?`)
    .bind(id)
    .first<StoredTask>()
  if (!saved) throw new WorkspaceError(503, 'Enregistrement non confirmé. Actualisez le tableau.')
  return hydrateTask(saved)
}
