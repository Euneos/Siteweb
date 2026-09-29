import { emailValide } from './forms'

export type DecisionMailKind = 'accepted' | 'refused'
export type MailPayload = { to: string; subject: string; text: string }
export type ApprovedDecisionTemplate = {
  version: string
  approvalRef: string
  subject: string
  text: string
}
/** These are proposals, not approved institutional messages. Runtime sending
 * requires the team's versioned, explicitly approved template configuration. */
export const DECISION_MAIL_PROPOSALS = {
  accepted: {
    subject: 'EUNEOS — candidature WISE-UP de {{etablissement}}',
    text: 'Bonjour,\n\nNous avons le plaisir de vous informer que la candidature de {{etablissement}} au programme WISE-UP pour la cohorte {{cohorte}} est acceptée.\n\nL’équipe EUNEOS reviendra vers vous pour les prochaines étapes.\n\nL’équipe EUNEOS',
  },
  refused: {
    subject: 'EUNEOS — réponse à la candidature WISE-UP de {{etablissement}}',
    text: 'Bonjour,\n\nAprès étude, nous ne pouvons pas retenir la candidature de {{etablissement}} au programme WISE-UP pour la cohorte {{cohorte}}.\n\nMerci de l’intérêt porté au programme. Vous pouvez répondre à ce message pour échanger avec l’équipe.\n\nL’équipe EUNEOS',
  },
} as const
export function acknowledgementPayload(school: string, email: string): MailPayload {
  // Existing site copy, deliberately unchanged. NocoDB accuse_etab is a
  // distinct historical template, not silently substituted here.
  return validatePayload({
    to: email,
    subject: 'EUNEOS a bien reçu votre candidature WISE-UP',
    text: `Bonjour,\n\nLa candidature de ${school} au Programme WISE-UP a bien été enregistrée. Notre équipe va l’étudier et reviendra vers vous dans les prochaines semaines.\n\nEUNEOS`,
  })
}
export function validatePayload(p: MailPayload): MailPayload {
  if (
    !emailValide(p.to) ||
    p.to.length > 254 ||
    /[,;\r\n]/.test(p.to) ||
    !p.subject.trim() ||
    p.subject.length > 250 ||
    /[\r\n]/.test(p.subject) ||
    !p.text.trim() ||
    p.text.length > 15000 ||
    /\{\{|\}\}|\[URL/.test(p.subject + p.text)
  )
    throw new Error('Invalid candidature mail content')
  return { ...p, to: p.to.trim().toLowerCase() }
}
export function decisionTemplate(config: string | undefined, kind: DecisionMailKind) {
  let template: ApprovedDecisionTemplate | undefined
  if (config) {
    const raw = JSON.parse(config)?.[kind]
    if (raw) {
      if (
        ['version', 'approvalRef', 'subject', 'text'].some(
          (k) => typeof raw[k] !== 'string' || !raw[k].trim(),
        ) ||
        raw.version.length > 120 ||
        raw.approvalRef.length > 300
      )
        throw new Error('Invalid approved template')
      template = raw
    }
  }
  return (
    template ?? {
      ...DECISION_MAIL_PROPOSALS[kind],
      version: 'proposal-2026-09-29',
      approvalRef: '',
    }
  )
}
export function renderDecision(
  template: ApprovedDecisionTemplate,
  data: { school: string; cohort: string; email: string },
) {
  const substitute = (s: string) =>
    s
      .replace(/\{\{etablissement\}\}/g, () => data.school)
      .replace(/\{\{cohorte\}\}/g, () => data.cohort)
  return validatePayload({
    to: data.email,
    subject: substitute(template.subject),
    text: substitute(template.text),
  })
}
