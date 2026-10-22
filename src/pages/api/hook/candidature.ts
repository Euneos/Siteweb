import type { APIRoute } from 'astro'
import { brevoEnv, envoyerEmail } from '../../../lib/brevo'
import { modeApercu } from '../../../lib/forms'
import { IMPORT_CANDIDATURE_VERSION, separerReprises } from '../../../lib/candidature-import'
import { NC } from '../../../lib/nocodb'

/**
 * Point d'arrivee du webhook NocoDB : appele a chaque nouvelle candidature.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * L'ancien systeme d'Elsa prevenait l'equipe a chaque candidature. En passant
 * a NocoDB on a perdu cette notification : une candidature arrivait en
 * silence. C'est une regression, et elle se repare ici.
 *
 * L'envoi passe par Brevo lorsque les secrets sont configures. Sans transport,
 * la reponse et les logs indiquent explicitement que rien n'est parti.
 */
export const prerender = false

/** Authenticated, side-effect-free deployment preflight for the import runner. */
export const GET: APIRoute = async ({ request, locals }) => {
  if (modeApercu(request)) return new Response('indisponible en aperçu', { status: 404 })
  const attendu = brevoEnv(locals).HOOK_SECRET
  if (!attendu || request.headers.get('x-hook-secret') !== attendu) {
    return new Response('non autorise', { status: 401 })
  }
  return Response.json({ historicalImportVersion: IMPORT_CANDIDATURE_VERSION }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/** Envoie la notification si un transport est configure. Sinon le dit. */
async function envoyer(e: ReturnType<typeof brevoEnv>, sujet: string, corps: string): Promise<'envoye' | 'pas-de-transport'> {
  const dest = e.EQUIPE_EMAIL
  if (!dest || !e.BREVO_API_KEY) return 'pas-de-transport'

  await envoyerEmail(e, { to: dest, subject: sujet, text: corps })
  return 'envoye'
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (modeApercu(request)) return new Response('indisponible en aperçu', { status: 404 })

  const e = brevoEnv(locals)

  // Le webhook est public : sans secret partage, n'importe qui pourrait
  // declencher des notifications. On refuse plutot que d'accepter.
  const attendu = e.HOOK_SECRET
  const recu = request.headers.get('x-hook-secret')
  if (!attendu || recu !== attendu) return new Response('non autorise', { status: 401 })

  // NocoDB a change la forme de sa charge entre versions. On lit le texte
  // brut et on cherche les lignes la ou elles peuvent etre, plutot que de
  // refuser une forme qu'on n'avait pas prevue.
  const brut = await request.text()
  let charge: Record<string, unknown> = {}
  try {
    charge = JSON.parse(brut) as Record<string, unknown>
  } catch {
    console.error('[hook-candidature] charge illisible :', brut.slice(0, 400))
    return new Response('charge illisible', { status: 400 })
  }

  const d = charge?.data as Record<string, unknown> | undefined
  const lignes =
    (d?.rows as Record<string, unknown>[] | undefined) ??
    (d?.records as Record<string, unknown>[] | undefined) ??
    (charge?.rows as Record<string, unknown>[] | undefined) ??
    (Array.isArray(d) ? (d as Record<string, unknown>[]) : []) ??
    []

  if (!lignes.length) {
    // On trace la forme reelle : c'est le seul moyen de la corriger.
    // Le diagnostic part aussi dans la reponse : c'est ce que NocoDB affiche
    // dans son journal de webhook, et donc le seul endroit ou on peut le lire.
    const diag = `rien a signaler | cles=${Object.keys(charge).join(',')}` +
      ` | data=${d ? Object.keys(d).join(',') : 'absent'}`
    console.log('[hook-candidature]', diag, brut.slice(0, 300))
    return new Response(diag, { status: 200 })
  }
  let selection: ReturnType<typeof separerReprises>
  try {
    selection = separerReprises(charge, lignes)
  } catch {
    console.error('[hook-candidature] reprise historique non reconnue')
    return new Response('reprise historique non reconnue', { status: 422 })
  }
  if (!selection.nouvelles.length) {
    console.log('[hook-candidature]', { etat: 'reprise-historique', nb: selection.reprises })
    return new Response('reprise-historique', { status: 200 })
  }
  // The trainer insert can precede linking the person. Link by the stable dossier
  // ID instead of announcing an unrelated/missing school or guessing an identity.
  if (d?.table_id === NC.tables.engagements) {
    if (charge.type !== 'records.after.insert') return new Response('événement ignoré', { status: 200 })
    const candidatures = selection.nouvelles.filter(r => r.fusionne_vers == null && r.statut === 'Candidature recue')
    if (!candidatures.length) return new Response('aucune nouvelle candidature', { status: 200 })
    if (candidatures.some(r => !Number.isSafeInteger(r.Id) || Number(r.Id) <= 0)) {
      return new Response('identifiant de candidature absent', { status: 422 })
    }
    try {
      const sent = await envoyerEmail(e, {
        to: 'wiseup@euneos.fr',
        subject: candidatures.length === 1 ? 'WISE-UP — Nouvelle candidature formateur' : `WISE-UP — ${candidatures.length} nouvelles candidatures formateurs`,
        text: [
          'Une nouvelle candidature formateur WISE-UP est à examiner dans l’espace interne.',
          '',
          ...candidatures.map(r => `Dossier #${r.Id} — https://www.euneos.fr/interne/formateurs#dossier-${r.Id}`),
          '',
          'Ouvrez « Consulter la candidature » pour lire les réponses et le statut enregistré.',
          'La décision et les échanges avec la personne restent à la charge de l’équipe.',
        ].join('\n'),
      })
      return new Response(sent ? 'envoye' : 'pas-de-transport', { status: sent ? 200 : 503 })
    } catch {
      console.error('[hook-candidature-formateur] Envoi non confirmé')
      return new Response('erreur envoi', { status: 503 })
    }
  }
  const resume = selection.nouvelles.map((r) => {
    const etab = (r.etablissement as { nom?: string } | undefined)?.nom ?? '(etablissement non relie)'
    return `• ${etab} — statut ${r.statut ?? '?'} — reçue le ${r.date_candidature ?? "aujourd'hui"}`
  })
  const sujet =
    resume.length === 1
      ? 'Nouvelle candidature sur euneos.fr'
      : `${resume.length} nouvelles candidatures sur euneos.fr`

  const corps = [
    resume.length === 1 ? 'Une candidature vient d’arriver :' : 'Des candidatures viennent d’arriver :',
    '',
    ...resume,
    '',
    'Le site envoie un accusé de réception lorsque le transport Brevo est configuré.',
    'Ouvrez la base pour traiter le dossier, ou demandez à l’agent',
    '« montre-moi les candidatures pas encore traitées ».',
  ].join('\n')

  try {
    const etat = await envoyer(e, sujet, corps)
    // Toujours tracer : quand le transport manque, la trace est le seul filet.
    console.log('[hook-candidature]', { etat, nb: resume.length, resume })
    return new Response(etat, { status: 200 })
  } catch (err) {
    console.error('[hook-candidature]', err instanceof Error ? err.message : err)
    return new Response('erreur envoi', { status: 500 })
  }
}
