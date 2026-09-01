import type { APIRoute } from 'astro'
import { brevoEnv, envoyerEmail } from '../../lib/brevo'
import { aucunTexteTropLong, champsDansLesLimites, donneesTexte, emailValide, modeApercu, origineAutorisee } from '../../lib/forms'

// Endpoint rendu a la demande (le reste du site est statique).
export const prerender = false

const REQUIRED = ['nom', 'prenom', 'email', 'message'] as const

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (!origineAutorisee(request)) return new Response('origine non autorisée', { status: 403 })

  const form = await request.formData()
  if (form.get('website')) return redirect('/contact?ok=1', 303)
  if (
    !aucunTexteTropLong(form) ||
    !champsDansLesLimites(form, { nom: 120, prenom: 120, fonction: 160, email: 254, message: 5000 })
  ) {
    return redirect('/contact?erreur=champs', 303)
  }
  const data = donneesTexte(form)

  const manquants = REQUIRED.filter((k) => !data[k]?.trim())
  if (manquants.length) {
    return redirect(`/contact?erreur=champs&manquants=${manquants.join(',')}`, 303)
  }
  const email = data.email.trim().toLowerCase()
  if (!emailValide(email)) {
    return redirect('/contact?erreur=email', 303)
  }

  if (modeApercu()) return redirect('/contact?ok=1&preview=1', 303)

  const env = brevoEnv(locals)
  if (!env.BREVO_API_KEY) return redirect('/contact?erreur=indisponible', 303)

  try {
    const destinataire = env.EQUIPE_EMAIL ?? 'contact@euneos.fr'
    await envoyerEmail(env, {
      to: destinataire,
      replyTo: email,
      subject: `Message reçu sur euneos.fr — ${data.prenom} ${data.nom}`,
      text: [
        `Nom : ${data.prenom} ${data.nom}`,
        `Fonction : ${data.fonction || 'Non renseignée'}`,
        `E-mail : ${email}`,
        '',
        data.message.slice(0, 5000),
      ].join('\n'),
    })
  } catch (error) {
    console.error('[contact]', error instanceof Error ? error.message : error)
    return redirect('/contact?erreur=technique', 303)
  }

  let accuseEnvoye = false
  try {
    accuseEnvoye = await envoyerEmail(env, {
      to: email,
      subject: 'EUNEOS a bien reçu votre message',
      text: `Bonjour ${data.prenom},\n\nNous avons bien reçu votre message. L’équipe EUNEOS vous répondra dans les meilleurs délais.\n\nEUNEOS`,
    })
  } catch (error) {
    console.error('[contact-accuse]', error instanceof Error ? error.message : error)
  }

  return redirect(`/contact?ok=1${accuseEnvoye ? '&email=1' : ''}`, 303)
}
