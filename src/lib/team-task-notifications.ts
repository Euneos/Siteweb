import { envoyerEmail, type BrevoEnv } from './brevo'
import type { WorkspaceDatabase } from './internal-workspace'
import { taskStatuses } from './team-tasks'

// Team addresses published on the EUNEOS team page. Never accept a recipient from the client.
export const taskRecipients: Record<string, string> = {
  Candice: 'gouvernance@euneos.fr',
  Charlotte: 'charlotte@euneos.fr',
  Pauline: 'pauline@euneos.fr',
}
type Assignment = {
  person: string
  title: string
  description: string
  task_status: string
  assigned_by: string
}
export type NotificationState = 'sent' | 'unavailable' | 'uncertain' | 'preview' | 'none'

/** Claim once before sending. A timeout must never cause an automatic resend. */
export async function notifyTaskAssignment(
  db: WorkspaceDatabase,
  env: BrevoEnv & { INTERNAL_WORKSPACE_PREVIEW?: unknown },
  taskId: string,
  version: number,
  origin: string,
): Promise<NotificationState> {
  const event = await db
    .prepare(
      'SELECT person, title, description, task_status, assigned_by FROM team_task_notifications WHERE task_id = ? AND task_version = ?',
    )
    .bind(taskId, version)
    .first<Assignment>()
  if (!event) return 'none'
  const claimed = await db
    .prepare(
      "UPDATE team_task_notifications SET state = 'sending', updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND task_version = ? AND state = 'pending'",
    )
    .bind(taskId, version)
    .run()
  if (claimed.meta.changes !== 1) return 'uncertain'
  let state: Exclude<NotificationState, 'none'> = 'uncertain'
  if (origin !== 'https://euneos.fr' || env.INTERNAL_WORKSPACE_PREVIEW === 'true') {
    state = 'preview'
  } else if (!env.BREVO_API_KEY || !Object.hasOwn(taskRecipients, event.person)) {
    state = 'unavailable'
  } else {
    const status =
      taskStatuses.find((status) => status.id === event.task_status)?.label ?? event.task_status
    try {
      const sent = await envoyerEmail(env, {
        to: taskRecipients[event.person],
        subject: 'EUNEOS — une tâche vous a été attribuée',
        text: `Bonjour ${event.person},\n\nUne tâche vous a été attribuée dans Organisation équipe.\n\nTitre : ${event.title}\nStatut : ${status}\nAttribuée par : ${event.assigned_by}\n${event.description ? `\nDescription :\n${event.description}\n` : ''}\nConsulter le tableau : https://euneos.fr/interne/organisation-equipe\n\nL’équipe EUNEOS`,
      })
      state = sent ? 'sent' : 'unavailable'
    } catch {
      // Brevo may have accepted the message before a network interruption.
    }
  }
  await db
    .prepare(
      'UPDATE team_task_notifications SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND task_version = ?',
    )
    .bind(state, taskId, version)
    .run()
  const receipt = await db
    .prepare('SELECT state FROM team_task_notifications WHERE task_id = ? AND task_version = ?')
    .bind(taskId, version)
    .first<{ state: string }>()
  return receipt?.state === state ? state : 'uncertain'
}
