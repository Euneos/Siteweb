export interface BrevoEnv {
  HOOK_SECRET?: string
  BREVO_API_KEY?: string
  BREVO_SENDER_EMAIL?: string
  CONTACT_EMAIL?: string
  EQUIPE_EMAIL?: string
  BREVO_LIST_ETABLISSEMENT?: string
  BREVO_LIST_PARTENAIRE?: string
  BREVO_LIST_FORMATEUR?: string
  BREVO_LIST_ENJEUX?: string
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
  options: { skipExistingContact?: boolean } = {},
) {
  if (!env.BREVO_API_KEY) return false

  const listes: Record<string, string | undefined> = {
    etablissement: env.BREVO_LIST_ETABLISSEMENT,
    partenaire: env.BREVO_LIST_PARTENAIRE,
    formateur: env.BREVO_LIST_FORMATEUR,
    enjeux: env.BREVO_LIST_ENJEUX,
  }
  const listId = Number(listes[profil])
  const templateId = Number(env.BREVO_DOI_TEMPLATE_ID)
  const listesNewsletter = Object.values(listes).map(Number)
  if (
    !Object.hasOwn(listes, profil) ||
    listesNewsletter.some((id) => !Number.isInteger(id) || id <= 0) ||
    !Number.isInteger(templateId) ||
    templateId <= 0
  )
    return false

  // Le formulaire public ne permet pas de changer un profil déjà confirmé.
  // Ne jamais traiter une panne de lecture comme un contact inexistant.
  const contact = await fetch(`${API}/contacts/${encodeURIComponent(email)}`, {
    headers: { 'api-key': env.BREVO_API_KEY },
    signal: AbortSignal.timeout(12_000),
  })
  if (contact.ok) {
    const details: unknown = await contact.json()
    if (
      !details ||
      typeof details !== 'object' ||
      !('listIds' in details) ||
      !Array.isArray(details.listIds) ||
      !details.listIds.every(Number.isInteger)
    ) {
      throw new Error('Réponse Brevo invalide lors de la vérification des listes')
    }
    if (
      options.skipExistingContact ||
      details.listIds.some((id: number) => listesNewsletter.includes(id))
    )
      return 'deja-inscrit'
  } else if (contact.status !== 404) {
    throw new Error(`Vérification des listes Brevo indisponible (${contact.status})`)
  }

  await appeler(env.BREVO_API_KEY, '/contacts/doubleOptinConfirmation', {
    method: 'POST',
    body: JSON.stringify({
      email,
      attributes: { NOM: nom },
      includeListIds: [listId],
      templateId,
      redirectionUrl,
    }),
  })
  return true
}

export async function ajouterEtablissementNewsletter(
  env: BrevoEnv,
  email: string,
  identity?: { fullName: string } | { firstName: string; lastName: string },
) {
  const apiKey = env.BREVO_API_KEY
  const listId = Number(env.BREVO_LIST_ETABLISSEMENT)
  if (!apiKey || !Number.isSafeInteger(listId) || listId <= 0) return false

  const chemin = `/contacts/${encodeURIComponent(email)}`
  const contact = await fetch(`${API}${chemin}`, {
    headers: { 'api-key': apiKey },
    signal: AbortSignal.timeout(12_000),
  })
  if (contact.status === 404) {
    const attributes =
      identity &&
      ('fullName' in identity
        ? { NOM: identity.fullName }
        : { FIRSTNAME: identity.firstName, LASTNAME: identity.lastName })
    await appeler(apiKey, '/contacts', {
      method: 'POST',
      body: JSON.stringify({ email, attributes, listIds: [listId] }),
    })
    return true
  }
  if (!contact.ok) throw new Error('Vérification du contact Brevo indisponible')

  const details = (await contact.json()) as {
    emailBlacklisted?: boolean
    listIds?: number[]
    listUnsubscribed?: number[]
  }
  if (typeof details.emailBlacklisted !== 'boolean' || !Array.isArray(details.listIds))
    throw new Error('Réponse Brevo invalide')
  if (details.emailBlacklisted || details.listUnsubscribed?.includes(listId)) return true
  const listesNewsletter = [
    listId,
    Number(env.BREVO_LIST_PARTENAIRE),
    Number(env.BREVO_LIST_FORMATEUR),
    Number(env.BREVO_LIST_ENJEUX),
  ]
  if (details.listIds.some((id) => listesNewsletter.includes(id))) return true

  await appeler(apiKey, chemin, {
    method: 'PUT',
    body: JSON.stringify({ listIds: [listId] }),
  })
  return true
}
