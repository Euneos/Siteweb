import type { APIRoute } from 'astro'
import { cohorteActive, creer, jeton, relier } from '../../lib/nocodb'

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

const vider = (v: string | undefined) => {
  const s = (v ?? '').trim()
  return s === '' ? undefined : s
}

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData()
  const d = Object.fromEntries(form) as Record<string, string>
  // Les cases a cocher arrivent en plusieurs exemplaires : fromEntries n'en
  // garde qu'un. NocoDB stocke un MultiSelect en liste separee par virgules.
  const enjeux = form.getAll('enjeux').map(String).filter(Boolean)

  const vide = REQUIS.filter((k) => !vider(d[k]))
  if (!enjeux.length) vide.push('enjeux' as never)
  if (vide.length) {
    return redirect(`${ROUTE}?erreur=champs&manquants=${vide.join(',')}`, 303)
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.referent_email)) {
    return redirect(`${ROUTE}?erreur=email`, 303)
  }
  if (!vider(d.consentement)) {
    return redirect(`${ROUTE}?erreur=consentement`, 303)
  }

  const token = jeton(locals)
  if (!token) {
    // On refuse plutot que de perdre la candidature en silence — le mode de
    // defaillance qui a coute des mois au systeme precedent.
    console.error('[candidature-etab] NOCODB_TOKEN absent, candidature NON enregistree', d.nom_etab)
    return redirect(`${ROUTE}?erreur=indisponible`, 303)
  }

  try {
    const etabId = await creer(token, 'etablissements', {
      nom: d.nom_etab.trim(),
      type_etab: d.type_etab,
      adresse: vider(d.adresse),
      cp: d.cp.trim(),
      ville: d.ville.trim(),
      region: vider(d.region),
      academie: vider(d.academie),
      referent_nom: d.referent_nom.trim(),
      referent_fonction: vider(d.referent_fonction),
      referent_email: d.referent_email.trim().toLowerCase(),
      referent_telephone: vider(d.referent_telephone),
    })

    const partId = await creer(token, 'participations', {
      statut: 'Candidature recue',
      date_candidature: new Date().toISOString().slice(0, 10),
      enjeux: enjeux.join(','),
      besoin_partage: d.besoin_partage,
      nb_professionnels: d.nb_professionnels,
      faisabilite: d.faisabilite,
      point_vigilance: vider(d.point_vigilance),
      accord_direction: d.accord_direction,
      document_lien: vider(d.document_lien),
      demarrage_souhaite: d.demarrage_souhaite,
      contrainte_calendrier: vider(d.contrainte_calendrier),
      apporteur_nom: vider(d.apporteur_nom),
      apporteur_email: vider(d.apporteur_email)?.toLowerCase(),
      consentement: true,
    })
    await relier(token, 'participations.etablissement', 'participations', partId, etabId)
    const coh = await cohorteActive(token)
    if (coh) await relier(token, 'participations.cohorte', 'participations', partId, coh)

    return redirect(`${ROUTE}?ok=1`, 303)
  } catch (e) {
    console.error('[candidature-etab]', e instanceof Error ? e.message : e)
    return redirect(`${ROUTE}?erreur=technique`, 303)
  }
}
