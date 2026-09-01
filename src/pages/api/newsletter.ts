import type { APIRoute } from 'astro'
import { brevoEnv, inscrireNewsletter } from '../../lib/brevo'
import { aucunTexteTropLong, champsDansLesLimites, emailValide, modeApercu, origineAutorisee } from '../../lib/forms'

export const prerender = false

/** Segmentation portee par le design lui-meme (3 boutons radio du footer). */
const PROFILS = new Set(['etablissement', 'partenaire', 'curieux'])

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (!origineAutorisee(request)) return new Response('origine non autorisée', { status: 403 })

  const form = await request.formData()
  if (form.get('website')) return redirect('/?nl=ok#newsletter', 303)
  if (!aucunTexteTropLong(form) || !champsDansLesLimites(form, { nom: 160, email: 254, profil: 20 })) {
    return redirect('/?nl=erreur#newsletter', 303)
  }
  const nom = String(form.get('nom') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const profil = String(form.get('profil') ?? '').trim()

  if (!nom || !email) return redirect('/?nl=erreur#newsletter', 303)
  if (!emailValide(email)) return redirect('/?nl=email#newsletter', 303)
  if (!PROFILS.has(profil)) return redirect('/?nl=profil#newsletter', 303)

  if (modeApercu()) return redirect('/?nl=confirmation&preview=1#newsletter', 303)

  try {
    const inscrit = await inscrireNewsletter(
      brevoEnv(locals),
      nom,
      email.toLowerCase(),
      profil,
      `${new URL(request.url).origin}/?nl=confirme#newsletter`,
    )
    if (!inscrit) return redirect('/?nl=indisponible#newsletter', 303)
  } catch (error) {
    console.error('[newsletter]', error instanceof Error ? error.message : error)
    return redirect('/?nl=technique#newsletter', 303)
  }

  return redirect('/?nl=confirmation#newsletter', 303)
}
