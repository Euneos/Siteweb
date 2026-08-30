export interface BrevoEnv {
  HOOK_SECRET?: string
  BREVO_API_KEY?: string
  BREVO_SENDER_EMAIL?: string
  EQUIPE_EMAIL?: string
  BREVO_LIST_ETABLISSEMENT?: string
  BREVO_LIST_PARTENAIRE?: string
  BREVO_LIST_CURIEUX?: string
  BREVO_DOI_TEMPLATE_ID?: string
}

const API = 'https://api.brevo.com/v3'

export function brevoEnv(locals: unknown): BrevoEnv {
  return ((locals as { runtime?: { env?: BrevoEnv } })?.runtime?.env ?? {}) as BrevoEnv
}

async function appeler(apiKey: string, chemin: string, init: RequestInit) {
  const response = await fetch(`${API}${chemin}`, {
    ...init,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    throw new Error(`Brevo ${response.status} ${chemin} : ${(await response.text()).slice(0, 200)}`)
  }
}

export async function envoyerEmail(
  env: BrevoEnv,
  options: { to: string | string[]; subject: string; text: string; replyTo?: string },
) {
  if (!env.BREVO_API_KEY) return false

  const destinataires = (Array.isArray(options.to) ? options.to : options.to.split(','))
    .map((email) => email.trim())
    .filter(Boolean)

  await appeler(env.BREVO_API_KEY, '/smtp/email', {
    method: 'POST',
    body: JSON.stringify({
      sender: {
        name: 'EUNEOS',
        email: env.BREVO_SENDER_EMAIL ?? 'wiseup@euneos.fr',
      },
      to: destinataires.map((email) => ({ email })),
      replyTo: options.replyTo ? { email: options.replyTo } : undefined,
      subject: options.subject,
      textContent: options.text,
    }),
  })
  return true
}

export async function inscrireNewsletter(
  env: BrevoEnv,
  nom: string,
  email: string,
  profil: string,
  redirectionUrl: string,
) {
  if (!env.BREVO_API_KEY) return false

  const listes: Record<string, string | undefined> = {
    etablissement: env.BREVO_LIST_ETABLISSEMENT,
    partenaire: env.BREVO_LIST_PARTENAIRE,
    curieux: env.BREVO_LIST_CURIEUX,
  }
  const listId = Number(listes[profil])
  const templateId = Number(env.BREVO_DOI_TEMPLATE_ID)
  const autresListes = Object.values(listes)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && id !== listId)
  if (!Number.isInteger(listId) || listId <= 0 || !Number.isInteger(templateId) || templateId <= 0) return false

  await appeler(env.BREVO_API_KEY, '/contacts/doubleOptinConfirmation', {
    method: 'POST',
    body: JSON.stringify({
      email,
      attributes: { NOM: nom },
      includeListIds: [listId],
      excludeListIds: autresListes,
      templateId,
      redirectionUrl,
    }),
  })
  return true
}
