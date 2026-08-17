import type { APIRoute } from 'astro'

export const prerender = false

/** Segmentation portee par le design lui-meme (3 boutons radio du footer). */
const PROFILS = new Set(['etablissement', 'partenaire', 'curieux'])

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData()
  const nom = String(form.get('nom') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const profil = String(form.get('profil') ?? '').trim()

  if (!nom || !email) return redirect('/?nl=erreur', 303)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirect('/?nl=email', 303)
  if (!PROFILS.has(profil)) return redirect('/?nl=profil', 303)

  // TODO Brevo : creer le contact dans la liste correspondant au profil.
  // La segmentation etablissement / partenaire / curieux est exactement la donnee
  // d'entree du portail de candidature : elle doit alimenter la meme base.
  const env = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env
  console.log('[newsletter]', {
    recu_le: new Date().toISOString(),
    nom,
    email,
    profil,
    brevo_configure: Boolean(env?.BREVO_API_KEY),
  })

  return redirect('/?nl=ok', 303)
}
