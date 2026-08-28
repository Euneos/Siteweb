import type { APIRoute } from 'astro'
import { cohorteActive, creer, jeton, parEmail, relier } from '../../lib/nocodb'

export const prerender = false

/**
 * Candidature formateur·rice.
 *
 * Les champs correspondent 1 pour 1 aux 27 questions du Google Form
 * « WISE-UP — 1. Candidature formateur·rice WISE UP ». L'identite de la
 * personne va dans `formateurs`, tout ce qui decrit la CANDIDATURE (parcours,
 * experience, motivation, etablissement pressenti, consentement) va dans
 * `engagements` : une personne peut candidater sur plusieurs cohortes.
 */

const ROUTE = '/candidater/formateur'

/** Obligatoires cote Google Form — meme liste, meme exigence. */
const REQUIS = [
  'nom', 'prenom', 'ville', 'cp', 'email', 'telephone', 'profession',
  'formation_instructeur', 'pratique_personnelle', 'annees_experience',
  'interventions_animees', 'motivation', 'disponible_2026_27',
  'etab_pressenti', 'etab_pressenti_nom', 'etab_pressenti_adresse',
  'etab_pressenti_ville', 'etab_pressenti_cp', 'etab_pressenti_academie',
  'etab_pressenti_type', 'direction_nom', 'direction_email', 'accord_principe',
] as const

const vider = (v: string | undefined) => {
  const s = (v ?? '').trim()
  return s === '' ? undefined : s
}

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData()
  const d = Object.fromEntries(form) as Record<string, string>
  // Cases a cocher : plusieurs valeurs pour un meme nom. Le libelle du Google
  // Form contient des virgules, donc on stocke en texte separe par « · »
  // (NocoDB refuse les virgules dans un MultiSelect).
  const experience = form.getAll('experience_animation').map(String).filter(Boolean)

  const vide = REQUIS.filter((k) => !vider(d[k]))
  if (!experience.length) vide.push('experience_animation' as never)
  if (vide.length) {
    return redirect(`${ROUTE}?erreur=champs&manquants=${vide.join(',')}`, 303)
  }
  const email = d.email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return redirect(`${ROUTE}?erreur=email`, 303)
  }
  if (!vider(d.consentement)) {
    return redirect(`${ROUTE}?erreur=consentement`, 303)
  }

  const token = jeton(locals)
  if (!token) {
    console.error('[candidature-formateur] NOCODB_TOKEN absent, candidature NON enregistree', email)
    return redirect(`${ROUTE}?erreur=indisponible`, 303)
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
        telephone: vider(d.telephone),
        cp: vider(d.cp),
        ville: d.ville.trim(),
        region: vider(d.region),
        profession: d.profession.trim(),
      })
    }

    const engId = await creer(token, 'engagements', {
      statut: 'Candidature recue',
      date_candidature: new Date().toISOString().slice(0, 10),
      formation_instructeur: d.formation_instructeur,
      experience_animation: experience.join(' · '),
      pratique_personnelle: vider(d.pratique_personnelle),
      annees_experience: vider(d.annees_experience),
      interventions_animees: vider(d.interventions_animees),
      motivation: vider(d.motivation),
      disponible_2026_27: d.disponible_2026_27,
      etab_pressenti: d.etab_pressenti,
      etab_pressenti_nom: vider(d.etab_pressenti_nom),
      etab_pressenti_adresse: vider(d.etab_pressenti_adresse),
      etab_pressenti_ville: vider(d.etab_pressenti_ville),
      etab_pressenti_cp: vider(d.etab_pressenti_cp),
      etab_pressenti_academie: vider(d.etab_pressenti_academie),
      etab_pressenti_type: vider(d.etab_pressenti_type),
      direction_nom: vider(d.direction_nom),
      direction_email: vider(d.direction_email)?.toLowerCase(),
      accord_principe: d.accord_principe,
      contexte_complement: vider(d.contexte_complement),
      consentement: true,
    })
    await relier(token, 'engagements.formateur', 'engagements', engId, formId)
    const coh = await cohorteActive(token)
    if (coh) await relier(token, 'engagements.cohorte', 'engagements', engId, coh)

    return redirect(`${ROUTE}?ok=1`, 303)
  } catch (e) {
    console.error('[candidature-formateur]', e instanceof Error ? e.message : e)
    return redirect(`${ROUTE}?erreur=technique`, 303)
  }
}
