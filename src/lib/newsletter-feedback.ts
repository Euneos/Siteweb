/** Messages partagés par le formulaire classique et l'envoi sans rechargement. */
export const newsletterMessages = {
  ok: 'Inscription confirmée. Bienvenue dans la newsletter EUNEOS.',
  confirmation: 'Vérifiez votre boîte e-mail et cliquez sur le lien reçu pour confirmer votre inscription.',
  confirme: 'Inscription confirmée. Bienvenue dans la newsletter EUNEOS.',
  'deja-inscrit': 'Cette adresse e-mail est déjà inscrite à la newsletter.',
  erreur: 'Renseignez votre nom et votre adresse e-mail.',
  email: 'L’adresse e-mail ne semble pas valide.',
  profil: 'Choisissez le profil qui vous correspond.',
  indisponible: 'L’inscription est momentanément indisponible. Réessayez plus tard.',
  technique: 'Une erreur technique empêche l’inscription. Réessayez plus tard.',
} as const

export type NewsletterState = keyof typeof newsletterMessages

export function isNewsletterState(state: unknown): state is NewsletterState {
  return typeof state === 'string' && Object.hasOwn(newsletterMessages, state)
}

export function newsletterSuccess(state: string | null) {
  return state === 'ok' || state === 'confirmation' || state === 'confirme'
}
