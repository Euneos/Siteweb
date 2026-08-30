import type { APIRoute } from 'astro'
import { brevoEnv, envoyerEmail } from '../../lib/brevo'
import { aucunTexteTropLong, champsDansLesLimites, choixAutorises, donneesTexte, emailValide, origineAutorisee } from '../../lib/forms'
import { cohorteActive, creer, jeton, parEmail, relier, supprimer } from '../../lib/nocodb'

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

const CHOIX = {
  region: ['Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Bretagne', 'Centre-Val de Loire', 'Corse', 'Grand Est', 'Guadeloupe', 'Guyane', 'Hauts-de-France', 'Île-de-France', 'La Réunion', 'Martinique', 'Mayotte', 'Normandie', 'Nouvelle-Aquitaine', 'Occitanie', 'Pays de la Loire', "Provence-Alpes-Côte d'Azur"],
  formation_instructeur: ['Oui, je suis instructeur·rice certifié·e MBSR', 'Oui, je suis instructeur·rice certifié·e MBCT', 'Oui, je suis instructeur·rice / formateur·rice PEACE', "Oui, j'ai suivi une autre formation professionnelle de formateur·rice en mindfulness", "Non, j'ai uniquement suivi un cycle en tant que participant·e"],
  experience_animation: ["Oui, auprès d'adultes", "Oui, auprès d'enseignants", "Oui, auprès d'élèves", 'Non'],
  disponible_2026_27: ['Oui', 'Non', 'Partiellement'],
  etab_pressenti: ['Oui', 'Non', 'En discussion'],
  etab_pressenti_type: ['École primaire', 'Collège', 'Lycée général et technologique', 'Lycée professionnel', 'Autre', 'Non défini à ce stade'],
  accord_principe: ['Oui', 'Non', 'En discussion'],
} as const

const vider = (v: string | undefined) => {
  const s = (v ?? '').trim()
  return s === '' ? undefined : s
}

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  if (!origineAutorisee(request)) return new Response('origine non autorisée', { status: 403 })

  const form = await request.formData()
  if (form.get('website')) return redirect(`${ROUTE}?ok=1`, 303)
  if (
    !aucunTexteTropLong(form) ||
    !champsDansLesLimites(form, { email: 254, direction_email: 254 }) ||
    !choixAutorises(form, CHOIX)
  ) {
    return redirect(`${ROUTE}?erreur=champs`, 303)
  }
  const d = donneesTexte(form)
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
  const directionEmail = d.direction_email.trim().toLowerCase()
  if (!emailValide(email) || !emailValide(directionEmail)) {
    return redirect(`${ROUTE}?erreur=email`, 303)
  }
  if (d.consentement !== 'Oui, je confirme') {
    return redirect(`${ROUTE}?erreur=consentement`, 303)
  }

  const token = jeton(locals)
  if (!token) {
    console.error('[candidature-formateur] NOCODB_TOKEN absent, candidature NON enregistree', email)
    return redirect(`${ROUTE}?erreur=indisponible`, 303)
  }

  let formId: number | null = null
  let formCree = false
  let engId: number | null = null

  try {
    // Une personne = une fiche. Si elle recandidate, on ajoute un engagement
    // a la fiche existante au lieu de creer un doublon.
    formId = await parEmail(token, 'formateurs', email)
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
      formCree = true
    }

    engId = await creer(token, 'engagements', {
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
      direction_email: directionEmail,
      accord_principe: d.accord_principe,
      contexte_complement: vider(d.contexte_complement),
      consentement: true,
    })
    await relier(token, 'engagements.formateur', 'engagements', engId, formId)
    const coh = await cohorteActive(token)
    if (coh) await relier(token, 'engagements.cohorte', 'engagements', engId, coh)

    let emailEnvoye = false
    try {
      emailEnvoye = await envoyerEmail(brevoEnv(locals), {
        to: email,
        subject: 'EUNEOS a bien reçu votre candidature WISE-UP',
        text: `Bonjour ${d.prenom.trim()},\n\nVotre candidature pour devenir formateur·rice WISE-UP a bien été enregistrée. Notre équipe va l’étudier et reviendra vers vous dans les prochaines semaines.\n\nEUNEOS`,
      })
    } catch (emailError) {
      console.error('[candidature-formateur-email]', emailError instanceof Error ? emailError.message : emailError)
    }
    return redirect(`${ROUTE}?ok=1${emailEnvoye ? '&email=1' : ''}`, 303)
  } catch (e) {
    if (engId) {
      try {
        await supprimer(token, 'engagements', engId)
      } catch (rollbackError) {
        console.error('[candidature-formateur-rollback-engagement]', rollbackError instanceof Error ? rollbackError.message : rollbackError)
      }
    }
    if (formCree && formId) {
      try {
        await supprimer(token, 'formateurs', formId)
      } catch (rollbackError) {
        console.error('[candidature-formateur-rollback-formateur]', rollbackError instanceof Error ? rollbackError.message : rollbackError)
      }
    }
    console.error('[candidature-formateur]', e instanceof Error ? e.message : e)
    return redirect(`${ROUTE}?erreur=technique`, 303)
  }
}
