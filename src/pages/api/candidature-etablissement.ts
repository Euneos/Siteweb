import type { APIRoute } from 'astro'
import { cohorteActive, creer, jeton, relier } from '../../lib/nocodb'

export const prerender = false

const REQUIS = ['nom_etab', 'type_etab', 'cp', 'ville', 'referent_nom', 'referent_email'] as const
const TYPES = ['College', 'Lycee general et technologique', 'Lycee professionnel',
               'Ecole primaire', 'Ecole elementaire', 'Autre']

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData()
  const d = Object.fromEntries(form) as Record<string, string>
  const vide = REQUIS.filter((k) => !d[k]?.trim())
  if (vide.length) return redirect(`/candidater/etablissement?erreur=champs&manquants=${vide.join(',')}`, 303)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.referent_email)) {
    return redirect('/candidater/etablissement?erreur=email', 303)
  }

  const token = jeton(locals)
  if (!token) {
    // On refuse plutot que de perdre la candidature en silence — le mode de
    // defaillance qui a coute des mois au systeme precedent.
    console.error('[candidature-etab] NOCODB_TOKEN absent, candidature NON enregistree', d.nom_etab)
    return redirect('/candidater/etablissement?erreur=indisponible', 303)
  }

  try {
    const etabId = await creer(token, 'etablissements', {
      nom: d.nom_etab.trim(),
      type_etab: TYPES.includes(d.type_etab) ? d.type_etab : 'Autre',
      adresse: d.adresse || undefined,
      cp: d.cp.trim(),
      ville: d.ville.trim(),
      region: d.region || undefined,
      academie: d.academie || undefined,
      public_prive: d.public_prive === 'Prive' ? 'Prive' : 'Public',
      referent_nom: d.referent_nom.trim(),
      referent_email: d.referent_email.trim().toLowerCase(),
      referent_fonction: d.referent_fonction || undefined,
      referent_telephone: d.referent_telephone || undefined,
      email_institutionnel: d.email_institutionnel || undefined,
      notes: d.message || undefined,
    })

    const partId = await creer(token, 'participations', {
      statut: 'Candidature recue',
      date_candidature: new Date().toISOString().slice(0, 10),
    })
    await relier(token, 'participations.etablissement', 'participations', partId, etabId)
    const coh = await cohorteActive(token)
    if (coh) await relier(token, 'participations.cohorte', 'participations', partId, coh)

    return redirect('/candidater/etablissement?ok=1', 303)
  } catch (e) {
    console.error('[candidature-etab]', e instanceof Error ? e.message : e)
    return redirect('/candidater/etablissement?erreur=technique', 303)
  }
}
