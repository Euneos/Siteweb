import { envoyerEmail, type BrevoEnv } from './brevo'
import type { WorkspaceDatabase } from './internal-workspace'

export const conventionNotificationRecipient = 'euneosequipe@gmail.com'
export type ConventionNotificationState = 'pending' | 'sending' | 'sent' | 'unavailable' | 'uncertain' | 'preview' | 'none'
type Notification = {
  id: number; convention_id: string; kind: 'submitted' | 'trainer_signed'
  trainer_name: string; school_names: string; state: ConventionNotificationState
}
type NotificationEnv = BrevoEnv & { INTERNAL_WORKSPACE_PREVIEW?: unknown }
export const conventionMailEnabled = (env: NotificationEnv, origin: string) =>
  ['https://euneos.fr', 'https://www.euneos.fr'].includes(origin) && env.INTERNAL_WORKSPACE_PREVIEW !== 'true' && !!env.BREVO_API_KEY

export async function conventionNotificationReceipts(db: WorkspaceDatabase) {
  const { results } = await db.prepare(`SELECT n.convention_id,n.kind,n.state,n.updated_at
    FROM mission_convention_notifications n
    WHERE n.id IN (SELECT MAX(id) FROM mission_convention_notifications GROUP BY convention_id)
    ORDER BY n.id DESC LIMIT 100`).bind().all<{ convention_id: string; kind: string; state: ConventionNotificationState; updated_at: string }>()
  return results
}

/** Saved documents survive notification errors. Claim before transport; never resend a claimed event. */
export async function notifyConventionEvents(db: WorkspaceDatabase, env: NotificationEnv, id: string, origin: string): Promise<ConventionNotificationState> {
  try {
    const { results: events } = await db.prepare(`SELECT * FROM mission_convention_notifications
      WHERE convention_id=? AND state='pending' ORDER BY id LIMIT 20`).bind(id).all<Notification>()
    for (const event of events) {
      const claimed = await db.prepare(`UPDATE mission_convention_notifications SET state='sending',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=? AND state='pending'`).bind(event.id).run()
      if (claimed.meta.changes !== 1) continue
      let state: ConventionNotificationState = 'uncertain'
      if (!['https://euneos.fr', 'https://www.euneos.fr'].includes(origin) || env.INTERNAL_WORKSPACE_PREVIEW === 'true') state = 'preview'
      else if (!env.BREVO_API_KEY) state = 'unavailable'
      else {
        const signed = event.kind === 'trainer_signed'
        try {
          const sent = await envoyerEmail(env, {
            to: conventionNotificationRecipient,
            subject: signed ? 'EUNEOS — convention signée à vérifier' : 'EUNEOS — convention soumise à vérifier',
            text: `Bonjour,\n\n${signed ? 'Un formateur a déposé son PDF signé. Il attend la vérification et la contresignature EUNEOS.' : 'Une convention a été soumise ou resoumise après correction. Elle attend la vérification EUNEOS.'}\n\nFormateur·rice : ${event.trainer_name}\nÉtablissement(s) : ${event.school_names}\n\nConsulter la convention : https://euneos.fr/interne/convention-mission#convention-${event.convention_id}\n\nConnectez-vous avec un compte équipe autorisé. Le PDF et les informations détaillées restent dans cet espace privé.\n\nL’équipe EUNEOS`,
          })
          state = sent ? 'sent' : 'unavailable'
        } catch {
          // The provider may have accepted the email before the connection was lost.
        }
      }
      await db.prepare(`UPDATE mission_convention_notifications SET state=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='sending'`)
        .bind(state, event.id).run()
      const receipt = await db.prepare('SELECT state FROM mission_convention_notifications WHERE id=?').bind(event.id).first<{ state: string }>()
      if (receipt?.state !== state) return 'uncertain'
    }
    const latest = await db.prepare('SELECT state FROM mission_convention_notifications WHERE convention_id=? ORDER BY id DESC LIMIT 1')
      .bind(id).first<{ state: ConventionNotificationState }>()
    return latest?.state === 'sending' ? 'uncertain' : latest?.state ?? 'none'
  } catch {
    // Do not turn a successfully saved convention into a failed submission.
    return 'uncertain'
  }
}
