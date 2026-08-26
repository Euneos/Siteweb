import type { APIRoute } from 'astro'

/**
 * Point d'arrivee du webhook NocoDB : appele a chaque nouvelle candidature.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * L'ancien systeme d'Elsa prevenait l'equipe a chaque candidature. En passant
 * a NocoDB on a perdu cette notification : une candidature arrivait en
 * silence. C'est une regression, et elle se repare ici.
 *
 * ETAT : la plomberie est posee, l'ENVOI ne l'est pas. EUNEOS n'a pas encore
 * tranche par ou partent les e-mails (Brevo ? leur SMTP Viaduc ? autre).
 * Le jour ou c'est decide, il n'y a que `envoyer()` a completer et deux
 * variables a poser — le reste ne bouge pas.
 */
export const prerender = false

interface Env {
  HOOK_SECRET?: string
  EQUIPE_EMAIL?: string
  BREVO_API_KEY?: string
}

const env = (locals: unknown): Env =>
  ((locals as { runtime?: { env?: Env } })?.runtime?.env ?? {}) as Env

/** Envoie la notification si un transport est configure. Sinon le dit. */
async function envoyer(e: Env, sujet: string, corps: string): Promise<'envoye' | 'pas-de-transport'> {
  const dest = e.EQUIPE_EMAIL
  if (!dest || !e.BREVO_API_KEY) return 'pas-de-transport'

  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': e.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Site EUNEOS', email: 'contact@euneos.fr' },
      to: dest.split(',').map((x) => ({ email: x.trim() })),
      subject: sujet,
      textContent: corps,
    }),
  })
  if (!r.ok) throw new Error(`Brevo ${r.status} : ${(await r.text()).slice(0, 160)}`)
  return 'envoye'
}

export const POST: APIRoute = async ({ request, locals }) => {
  const e = env(locals)

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
    'Aucun accusé de réception n’a été envoyé : c’est volontaire.',
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
