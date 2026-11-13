import type { APIRoute } from 'astro'
import publicKey from '../../../config/agenda-reminder-public.pem?raw'
import { internalEnvironment, privateJson } from '../../lib/internal-context'
import { agendaToday } from '../../lib/event-agenda'
import {
  verifyReminderSignature,
  sendAgendaReminder,
  isAgendaMonday,
} from '../../lib/agenda-reminder'
import type { WorkspaceDatabase } from '../../lib/internal-workspace'
export const prerender = false
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    if (Number(request.headers.get('Content-Length') || 0) > 4000)
      return privateJson({ error: 'Requête invalide.' }, 400)
    const raw = await request.text()
    if (raw.length > 4000) return privateJson({ error: 'Requête invalide.' }, 400)
    const body = JSON.parse(raw),
      check = body.check === true,
      env = internalEnvironment(locals)
    if (
      body.date !== agendaToday() ||
      !(await verifyReminderSignature(body.date, check, body.signature || '', publicKey))
    )
      return privateJson({ error: 'Accès refusé.' }, 403)
    if (
      env.CF_PAGES_BRANCH !== 'main' ||
      env.INTERNAL_WORKSPACE_PREVIEW === 'true' ||
      !env.TEAM_WORKSPACE ||
      !env.BREVO_API_KEY
    )
      return privateJson({ error: 'Rappel indisponible.' }, 503)
    if (check) return privateJson({ ready: true })
    if (!isAgendaMonday(body.date)) return privateJson({ error: 'Rappel réservé au lundi.' }, 400)
    const result = await sendAgendaReminder(
      env.TEAM_WORKSPACE as WorkspaceDatabase,
      env as any,
      body.date,
    )
    return privateJson(result, ['sent', 'already_sent'].includes(result.state) ? 200 : 503)
  } catch {
    return privateJson({ error: 'Rappel non confirmé. Ne pas répéter automatiquement.' }, 503)
  }
}
