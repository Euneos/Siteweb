import type { APIRoute } from 'astro'
import { cohorteActive, creer, jeton, parEmail, relier } from '../../lib/nocodb'

export const prerender = false

const REQUIS = ['nom', 'prenom', 'email', 'ville', 'profession'] as const

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData()
  const d = Object.fromEntries(form) as Record<string, string>
  const vide = REQUIS.filter((k) => !d[k]?.trim())
  if (vide.length) return redirect(`/candidater/formateur?erreur=champs&manquants=${vide.join(',')}`, 303)
  const email = d.email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirect('/candidater/formateur?erreur=email', 303)

  const token = jeton(locals)
  if (!token) {
    console.error('[candidature-formateur] NOCODB_TOKEN absent, candidature NON enregistree', email)
    return redirect('/candidater/formateur?erreur=indisponible', 303)
  }

  try {
    // Une personne = une fiche. Si elle recandidate, on ajoute un engagement
    // a la fiche existante au lieu de creer un doublon.
    let formId = await parEmail(token, 'formateurs', email)
    if (!formId) {
      formId = await creer(token, 'formateurs', {
        nom: d.nom.trim(),
        prenom: d.prenom.trim(),
        email,
        telephone: d.telephone || undefined,
        cp: d.cp || undefined,
        ville: d.ville.trim(),
        region: d.region || undefined,
        academie: d.academie || undefined,
        profession: d.profession.trim(),
      })
    }

    const engId = await creer(token, 'engagements', {
      statut: 'Candidature recue',
      date_candidature: new Date().toISOString().slice(0, 10),
      notes: d.motivation || undefined,
    })
    await relier(token, 'engagements.formateur', 'engagements', engId, formId)
    const coh = await cohorteActive(token)
    if (coh) await relier(token, 'engagements.cohorte', 'engagements', engId, coh)

    return redirect('/candidater/formateur?ok=1', 303)
  } catch (e) {
    console.error('[candidature-formateur]', e instanceof Error ? e.message : e)
    return redirect('/candidater/formateur?erreur=technique', 303)
  }
}
