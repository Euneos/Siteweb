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
  previous_person: string
  contributors: string
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
      'SELECT person, title, description, task_status, assigned_by, previous_person, contributors FROM team_task_notifications WHERE task_id = ? AND task_version = ?',
    )
    .bind(taskId, version)
    .first<Assignment>()
  if (!event) return 'none'
  const deliver = async (previous: boolean): Promise<NotificationState> => {
    // Only these two internal literals can select a receipt column.
    const column = previous ? 'previous_state' : 'state'
    const recipient = previous ? event.previous_person : event.person
    const claimed = await db
      .prepare(
        `UPDATE team_task_notifications SET ${column} = 'sending', updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND task_version = ? AND ${column} = 'pending'`,
      )
      .bind(taskId, version)
      .run()
    if (claimed.meta.changes !== 1) {
      const existing = await db
        .prepare(
          `SELECT ${column} AS state FROM team_task_notifications WHERE task_id = ? AND task_version = ?`,
        )
        .bind(taskId, version)
        .first<{ state: string }>()
      return existing?.state === 'sent' ? 'sent' : 'uncertain'
    }
    let state: Exclude<NotificationState, 'none'> = 'uncertain'
    if (origin !== 'https://euneos.fr' || env.INTERNAL_WORKSPACE_PREVIEW === 'true') {
      state = 'preview'
    } else if (!env.BREVO_API_KEY || !Object.hasOwn(taskRecipients, recipient)) {
      state = 'unavailable'
    } else {
      const status =
        taskStatuses.find((status) => status.id === event.task_status)?.label ?? event.task_status
      try {
        const message = previous
          ? `Vous n’êtes plus responsable de cette tâche. Le nouveau responsable est ${event.person}.${(JSON.parse(event.contributors) as string[]).includes(recipient) ? ' Vous restez contributeur sur cette tâche.' : ''}`
          : `Vous êtes responsable de cette tâche.${event.previous_person ? ` Elle était auparavant attribuée à ${event.previous_person}.` : ''}`
        const sent = await envoyerEmail(env, {
          to: taskRecipients[recipient],
          subject: previous
            ? 'EUNEOS — une tâche a changé de responsable'
            : 'EUNEOS — une tâche vous a été attribuée',
          text: `Bonjour ${recipient},\n\n${message}\n\nTitre : ${event.title}\nStatut : ${status}\nModification effectuée par : ${event.assigned_by}\n${event.description ? `\nDescription :\n${event.description}\n` : ''}\nConsulter le tableau : https://euneos.fr/interne/organisation-equipe\n\nL’équipe EUNEOS`,
        })
        state = sent ? 'sent' : 'unavailable'
      } catch {
        // Brevo may have accepted the message before a network interruption.
      }
    }
    await db
      .prepare(
        `UPDATE team_task_notifications SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND task_version = ?`,
      )
      .bind(state, taskId, version)
      .run()
    const receipt = await db
      .prepare(
        `SELECT ${column} AS state FROM team_task_notifications WHERE task_id = ? AND task_version = ?`,
      )
      .bind(taskId, version)
      .first<{ state: string }>()
    return receipt?.state === state ? state : 'uncertain'
  }
  // Each recipient has an independent claim: one failure cannot resend the other email.
  const deliveries = await Promise.allSettled([
    deliver(false),
    ...(event.previous_person && event.previous_person !== event.person ? [deliver(true)] : []),
  ])
  const states = deliveries.map((result) =>
    result.status === 'fulfilled' ? result.value : 'uncertain',
  )
  if (states.includes('uncertain')) return 'uncertain'
  if (states.includes('unavailable')) return 'unavailable'
  if (states.includes('preview')) return 'preview'
  return 'sent'
}
