import type { WorkspaceDatabase } from './internal-workspace'
import { envoyerEmail, type BrevoEnv } from './brevo'
import { agendaToday } from './event-agenda'
export const reminderPayload = (date: string, check: boolean) =>
  `euneos:agenda-reminder:${check ? 'check' : 'send'}:${date}`
export async function verifyReminderSignature(
  date: string,
  check: boolean,
  signature: string,
  publicPem: string,
) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || signature.length > 2000) return false
    const der = Uint8Array.from(atob(publicPem.replace(/-----[^-]+-----|\s/g, '')), (c) =>
      c.charCodeAt(0),
    )
    const key = await crypto.subtle.importKey(
      'spki',
      der,
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const bytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
      c.charCodeAt(0),
    )
    return await crypto.subtle.verify(
      { name: 'RSA-PSS', saltLength: 32 },
      key,
      bytes,
      new TextEncoder().encode(reminderPayload(date, check)),
    )
  } catch {
    return false
  }
}
export async function sendAgendaReminder(
  db: WorkspaceDatabase,
  env: BrevoEnv,
  date: string,
  send = envoyerEmail,
) {
  if (!env.BREVO_API_KEY) return { state: 'unavailable' }
  const claim = await db
    .prepare(
      "INSERT INTO event_agenda_reminders(reminder_date,state) VALUES(?,'sending') ON CONFLICT(reminder_date) DO NOTHING",
    )
    .bind(date)
    .run()
  if (claim.meta.changes !== 1) {
    const row = await db
      .prepare('SELECT state FROM event_agenda_reminders WHERE reminder_date=?')
      .bind(date)
      .first<{ state: string }>()
    return { state: row?.state === 'sent' ? 'already_sent' : 'uncertain' }
  }
  let state = 'uncertain'
  try {
    if (
      await send(env, {
        to: 'pauline.euneos@gmail.com',
        subject: 'EUNEOS — rappel du lundi : agenda des événements',
        text: 'Bonjour Pauline,\n\nC’est le moment de vérifier les événements repérés dans les newsletters. Ouvrez Codex sur votre ordinateur, avec une connexion Internet. Le contrôle est prévu le lundi à 11 h 35 si l’application est ouverte.\n\nSi vous n’êtes pas disponible maintenant, vous pouvez le faire plus tard : revenez dans le chat de l’agenda dans Codex et écrivez « Vérifie les newsletters et mets à jour l’agenda des événements maintenant. »\n\nVotre agenda : https://euneos.fr/interne/communication/agenda-evenements\n\nVous pouvez aussi y ajouter un événement manuellement ou en supprimer un. Les décisions de statut et de présence restent sous le contrôle de l’équipe.\n\nEUNEOS',
      })
    )
      state = 'sent'
  } catch {
    /* No retry after an uncertain provider response. */
  }
  await db
    .prepare(
      "UPDATE event_agenda_reminders SET state=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE reminder_date=?",
    )
    .bind(state, date)
    .run()
  return { state }
}
export const isAgendaMonday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay() === 1
export function reminderDue(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = parts.find((p) => p.type === 'hour')?.value,
    minute = Number(parts.find((p) => p.type === 'minute')?.value)
  return isAgendaMonday(agendaToday(now)) && hour === '11' && minute >= 30
}
