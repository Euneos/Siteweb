import type { APIRoute } from 'astro'

// Endpoint rendu a la demande (le reste du site est statique).
export const prerender = false

const REQUIRED = ['nom', 'prenom', 'email', 'message'] as const

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData()
  const data = Object.fromEntries(form) as Record<string, string>

  const manquants = REQUIRED.filter((k) => !data[k]?.trim())
  if (manquants.length) {
    return redirect(`/contact?erreur=champs&manquants=${manquants.join(',')}`, 303)
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
    return redirect('/contact?erreur=email', 303)
  }

  // TODO Brevo : le brief client prevoit « accuse de reception automatique via Brevo ».
  // Il ne manque que la cle API (BREVO_API_KEY) pour brancher l'envoi ici :
  //   1. notification a contact@euneos.fr
  //   2. accuse de reception au demandeur
  // Tant que la cle n'est pas fournie, on trace la demande dans les logs Cloudflare
  // pour ne rien perdre.
  const env = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env
  console.log('[contact]', {
    recu_le: new Date().toISOString(),
    nom: data.nom,
    prenom: data.prenom,
    fonction: data.fonction ?? '',
    email: data.email,
    message: data.message.slice(0, 2000),
    brevo_configure: Boolean(env?.BREVO_API_KEY),
  })

  return redirect('/contact?ok=1', 303)
}
