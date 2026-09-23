import { envoyerEmail, type BrevoEnv } from './brevo'
import type { SubmissionDatabase } from './candidature-store'
import type { OperationalKind } from './operational-data'

/** One automatic acknowledgement per accepted link. Never retry an uncertain
 * send: Brevo may have accepted the message before a transport interruption. */
export async function acknowledgeOperational(input: {
  db: SubmissionDatabase
  env: BrevoEnv
  linkHash: string
  email: string
  kind: OperationalKind
}): Promise<'sent' | 'unavailable' | 'uncertain' | 'already_claimed'> {
  const claimed = await input.db
    .prepare(
      `INSERT INTO operational_mail_receipts (link_hash,state) VALUES (?,'sending') ON CONFLICT(link_hash) DO NOTHING`,
    )
    .bind(input.linkHash)
    .run()
  if (claimed.meta.changes !== 1) return 'already_claimed'
  const names = {
    contact: 'votre fiche contact',
    deploiement: 'les informations d’organisation de la formation',
    participants: 'votre liste de participants',
  }
  let state: 'sent' | 'unavailable' | 'uncertain' = 'uncertain'
  try {
    const sent = await envoyerEmail(input.env, {
      to: input.email,
      subject: 'EUNEOS — vos informations ont été enregistrées',
      text: `Bonjour,\n\nNous avons bien enregistré ${names[input.kind]} dans le dossier de votre établissement. L’équipe EUNEOS peut maintenant les consulter.\n\nPour apporter une correction, demandez un nouveau lien à votre contact EUNEOS.\n\nMerci,\nL’équipe EUNEOS`,
    })
    state = sent ? 'sent' : 'unavailable'
  } catch {
    /* No provider response, credentials or submitted answers in logs. */
  }
  await input.db
    .prepare(
      `UPDATE operational_mail_receipts SET state=?,updated_at=CURRENT_TIMESTAMP WHERE link_hash=?`,
    )
    .bind(state, input.linkHash)
    .run()
  return state
}
