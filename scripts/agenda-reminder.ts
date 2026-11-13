import { sign, constants } from 'node:crypto'
import { agendaToday } from '../src/lib/event-agenda'
import { reminderDue, reminderPayload } from '../src/lib/agenda-reminder'
if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Contexte non autorisé')
const check = process.env.AGENDA_REMINDER_CHECK === 'true'
if (!check && !reminderDue())
  console.log('Hors de la plage du lundi 11 h 30 Europe/Paris : aucun envoi.')
else {
  const date = agendaToday(),
    signature = sign('sha256', Buffer.from(reminderPayload(date, check)), {
      key: process.env.AGENDA_REMINDER_PRIVATE_KEY!,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }).toString('base64url')
  const r = await fetch('https://euneos.fr/api/agenda-reminder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, check, signature }),
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) throw new Error('Rappel non confirmé. Aucune répétition automatique.')
  const result = await r.json()
  console.log(
    check
      ? 'Configuration du rappel serveur vérifiée sans envoi.'
      : 'Résultat du rappel : ' + result.state,
  )
}
