import type { APIRoute } from 'astro'
import { brevoEnv, envoyerEmail } from '../../lib/brevo'
import { aucunTexteTropLong, champsDansLesLimites, choixAutorises, donneesTexte, emailValide, modeApercu, origineAutorisee, urlHttpValide } from '../../lib/forms'
import { cohorteActive, creer, jeton, parEtablissement, relier, supprimer } from '../../lib/nocodb'

export const prerender = false

/**
 * Candidature etablissement.
 *
 * Les champs correspondent 1 pour 1 aux 23 questions du Google Form
 * « WISE-UP — 1. Candidature etablissement ». L'identite de l'etablissement
 * va dans `etablissements`, tout ce qui decrit la DEMANDE (enjeux, calendrier,
 * conditions, consentement) va dans `participations` : c'est la candidature
 * dans une cohorte, pas une propriete de l'ecole.
 */

const ROUTE = '/candidater/etablissement'

/** Obligatoires cote Google Form — meme liste, meme exigence. */
const REQUIS = [
  'nom_etab', 'type_etab', 'adresse', 'ville', 'cp', 'region', 'academie',
  'referent_nom', 'referent_fonction', 'referent_email',
  'besoin_partage', 'nb_professionnels', 'faisabilite', 'accord_direction',
  'demarrage_souhaite',
] as const

const CHOIX = {
  type_etab: ['École primaire', 'Collège', 'Lycée général et technologique', 'Lycée professionnel', 'Autre'],
  region: ['Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Bretagne', 'Centre-Val de Loire', 'Corse', 'Grand Est', 'Guadeloupe', 'Guyane', 'Hauts-de-France', 'Île-de-France', 'La Réunion', 'Martinique', 'Mayotte', 'Normandie', 'Nouvelle-Aquitaine', 'Occitanie', 'Pays de la Loire', "Provence-Alpes-Côte d'Azur"],
  referent_fonction: ["Chef d'établissement", 'Direction adjointe', 'CPE', 'Enseignant·e', 'Enseignant·e référent·e', 'Personnel éducatif / vie scolaire', 'Personnel médico-social', 'Autre'],
  enjeux: ['Attention / concentration des élèves', 'Gestion du stress ou de la surcharge', 'Usages numériques', 'Climat scolaire / qualité des relations', 'Besoin de renforcer les compétences psychosociales', "Besoin d'outils concrets pour les équipes", 'Autre'],
  besoin_partage: ['Oui, clairement', 'Oui, partiellement', 'Pas encore vraiment', 'Je ne sais pas'],
  nb_professionnels: ['Moins de 10', '10 à 20', '21 à 40', 'Plus de 40', 'À préciser ultérieurement'],
  faisabilite: ['Facilement envisageable', 'Envisageable sous certaines conditions', 'Encore incertaine', 'Trop tôt pour le dire'],
  point_vigilance: ['Calendrier / disponibilité', 'Mobilisation des équipes', 'Arbitrage de direction', 'Organisation interne', 'Besoin de mieux comprendre le programme', 'Autre'],
  accord_direction: ['Oui', 'Non', 'En discussion'],
  demarrage_souhaite: ['Dans les 1 à 2 prochains mois', 'Dans le trimestre à venir', 'Au prochain semestre', 'À la prochaine rentrée', 'À définir'],
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
    !champsDansLesLimites(form, { referent_email: 254, apporteur_email: 254, document_lien: 2000 }) ||
    !choixAutorises(form, CHOIX)
  ) {
    return redirect(`${ROUTE}?erreur=champs`, 303)
  }
  const d = donneesTexte(form)
  // Les cases a cocher arrivent en plusieurs exemplaires : fromEntries n'en
  // garde qu'un. NocoDB stocke un MultiSelect en liste separee par virgules.
  const enjeux = form.getAll('enjeux').map(String).filter(Boolean)

  const vide = REQUIS.filter((k) => !vider(d[k]))
  if (!enjeux.length) vide.push('enjeux' as never)
  if (vide.length) {
    return redirect(`${ROUTE}?erreur=champs&manquants=${vide.join(',')}`, 303)
  }
  const referentEmail = d.referent_email.trim().toLowerCase()
  const apporteurEmail = vider(d.apporteur_email)?.toLowerCase()
  if (!emailValide(referentEmail) || (apporteurEmail && !emailValide(apporteurEmail))) {
    return redirect(`${ROUTE}?erreur=email`, 303)
  }
  const documentLien = vider(d.document_lien)
  if (documentLien && !urlHttpValide(documentLien)) {
    return redirect(`${ROUTE}?erreur=champs`, 303)
  }
  if (d.consentement !== 'Oui, je confirme') {
    return redirect(`${ROUTE}?erreur=consentement`, 303)
  }

  if (modeApercu()) return redirect(`${ROUTE}?ok=1&preview=1`, 303)

  const token = jeton(locals)
  if (!token) {
    // On refuse plutot que de perdre la candidature en silence — le mode de
    // defaillance qui a coute des mois au systeme precedent.
    console.error('[candidature-etab] NOCODB_TOKEN absent, candidature NON enregistree', d.nom_etab)
    return redirect(`${ROUTE}?erreur=indisponible`, 303)
  }

  let etabId: number | null = null
  let etabCree = false
  let partId: number | null = null

  try {
    etabId = await parEtablissement(token, referentEmail, d.nom_etab)
    if (!etabId) {
      etabId = await creer(token, 'etablissements', {
        nom: d.nom_etab.trim(),
        type_etab: d.type_etab,
        adresse: vider(d.adresse),
        cp: d.cp.trim(),
        ville: d.ville.trim(),
        region: vider(d.region),
        academie: vider(d.academie),
        referent_nom: d.referent_nom.trim(),
        referent_fonction: vider(d.referent_fonction),
        referent_email: referentEmail,
        referent_telephone: vider(d.referent_telephone),
      })
      etabCree = true
    }

    partId = await creer(token, 'participations', {
      statut: 'Candidature recue',
      date_candidature: new Date().toISOString().slice(0, 10),
      enjeux: enjeux.join(','),
      besoin_partage: d.besoin_partage,
      nb_professionnels: d.nb_professionnels,
      faisabilite: d.faisabilite,
      point_vigilance: vider(d.point_vigilance),
      accord_direction: d.accord_direction,
      document_lien: documentLien,
      demarrage_souhaite: d.demarrage_souhaite,
      contrainte_calendrier: vider(d.contrainte_calendrier),
      apporteur_nom: vider(d.apporteur_nom),
      apporteur_email: apporteurEmail,
      consentement: true,
    })
    await relier(token, 'participations.etablissement', 'participations', partId, etabId)
    const coh = await cohorteActive(token)
    if (coh) await relier(token, 'participations.cohorte', 'participations', partId, coh)

    let emailEnvoye = false
    try {
      emailEnvoye = await envoyerEmail(brevoEnv(locals), {
        to: referentEmail,
        subject: 'EUNEOS a bien reçu votre candidature WISE-UP',
        text: `Bonjour,\n\nLa candidature de ${d.nom_etab.trim()} au Programme WISE-UP a bien été enregistrée. Notre équipe va l’étudier et reviendra vers vous dans les prochaines semaines.\n\nEUNEOS`,
      })
    } catch (emailError) {
      console.error('[candidature-etab-email]', emailError instanceof Error ? emailError.message : emailError)
    }
    return redirect(`${ROUTE}?ok=1${emailEnvoye ? '&email=1' : ''}`, 303)
  } catch (e) {
    if (partId) {
      try {
        await supprimer(token, 'participations', partId)
      } catch (rollbackError) {
        console.error('[candidature-etab-rollback-participation]', rollbackError instanceof Error ? rollbackError.message : rollbackError)
      }
    }
    if (etabCree && etabId) {
      try {
        await supprimer(token, 'etablissements', etabId)
      } catch (rollbackError) {
        console.error('[candidature-etab-rollback-etablissement]', rollbackError instanceof Error ? rollbackError.message : rollbackError)
      }
    }
    console.error('[candidature-etab]', e instanceof Error ? e.message : e)
    return redirect(`${ROUTE}?erreur=technique`, 303)
  }
}
