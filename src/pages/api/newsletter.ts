import type { APIRoute } from 'astro'
import type { NewsletterState } from '../../lib/newsletter-feedback'
import { brevoEnv, inscrireNewsletter } from '../../lib/brevo'
import { aucunTexteTropLong, champsDansLesLimites, emailValide, modeApercu, origineAutorisee } from '../../lib/forms'

export const prerender = false

/** Segmentation portee par le design lui-meme (3 boutons radio du footer). */
const PROFILS = new Set(['etablissement', 'formateur', 'partenaire'])

/** Deux formulaires envoient ici : le pied de page (toutes les pages) et la
    page dediee `/newsletter`. Le champ cache `retour` dit ou renvoyer la
    personne ; tout autre valeur retombe sur l'accueil. */
const RETOURS: Record<string, string> = {
  '/': '/?nl=%s#newsletter',
  '/newsletter': '/newsletter?nl=%s#inscription',
}

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (!origineAutorisee(request)) return new Response('origine non autorisée', { status: 403 })

  const form = await request.formData()
  const gabarit = RETOURS[String(form.get('retour') ?? '')] ?? RETOURS['/']
  const wantsJson = request.headers.get('accept')?.includes('application/json')
  const vers = (etat: NewsletterState, preview = false) => {
    if (wantsJson) {
      const status = ['erreur', 'email', 'profil'].includes(etat) ? 400
        : ['technique', 'indisponible'].includes(etat) ? 503 : 200
      return Response.json({ state: etat, ...(preview ? { preview: true } : {}) }, {
        status,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    return redirect(gabarit.replace('%s', `${etat}${preview ? '&preview=1' : ''}`), 303)
  }

  if (form.get('website')) return vers('ok')
  if (!aucunTexteTropLong(form) || !champsDansLesLimites(form, { nom: 160, email: 254, profil: 20, retour: 40 })) {
    return vers('erreur')
  }
  const nom = String(form.get('nom') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const profil = String(form.get('profil') ?? '').trim()

  if (!nom || !email) return vers('erreur')
  if (!emailValide(email)) return vers('email')
  if (!PROFILS.has(profil)) return vers('profil')

  if (modeApercu(request)) return vers('confirmation', true)

  try {
    const inscrit = await inscrireNewsletter(
      brevoEnv(locals),
      nom,
      email.toLowerCase(),
      profil,
      `${new URL(request.url).origin}${gabarit.replace('%s', 'confirme')}`,
    )
    if (!inscrit) return vers('indisponible')
    if (inscrit === 'deja-inscrit') return vers('deja-inscrit')
  } catch (error) {
    console.error('[newsletter]', error instanceof Error ? error.message : error)
    return vers('technique')
  }

  return vers('confirmation')
}
