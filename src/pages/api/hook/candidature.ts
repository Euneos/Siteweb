import type { APIRoute } from 'astro'
import { brevoEnv, envoyerEmail } from '../../../lib/brevo'

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

/** Envoie la notification si un transport est configure. Sinon le dit. */
async function envoyer(e: ReturnType<typeof brevoEnv>, sujet: string, corps: string): Promise<'envoye' | 'pas-de-transport'> {
  const dest = e.EQUIPE_EMAIL
  if (!dest || !e.BREVO_API_KEY) return 'pas-de-transport'

  await envoyerEmail(e, { to: dest, subject: sujet, text: corps })
  return 'envoye'
}

export const POST: APIRoute = async ({ request, locals }) => {
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
  const resume = lignes.map((r) => {
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
