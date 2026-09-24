import { submissionDatabase, type SubmissionDatabase } from './candidature-store'
import { internalEnvironment } from './internal-context'
import { lireEnregistrement, lireToutes, jeton, NC } from './nocodb'
import { modeApercu } from './forms'
import {
  readOperationalContext,
  type OperationalKind,
  type OperationalTarget,
} from './operational-data'
import { readOperationalSubmission } from './operational-store'

export const operationalHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
}
export const operationalJson = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: operationalHeaders })
export class OperationalLinkError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export function operationalError(error: unknown) {
  if (error instanceof OperationalLinkError)
    return operationalJson({ code: error.code, message: error.message }, error.status)
  // Do not log URLs, tokens, API responses or form answers.
  return operationalJson(
    {
      code: 'indisponible',
      message:
        'Le service est momentanément indisponible. Conservez votre saisie et réessayez plus tard.',
    },
    503,
  )
}
export function operationalKind(value: unknown): OperationalKind {
  if (value === 'fiche-contact' || value === 'contact') return 'contact'
  if (value === 'deploiement' || value === 'participants') return value
  throw new OperationalLinkError(404, 'introuvable', 'Ce formulaire n’existe pas.')
}
export const operationalPath = (kind: OperationalKind) =>
  `/suivi/${kind === 'contact' ? 'fiche-contact' : kind}`
export const operationalLinkColumns = {
  contact: 'lien_fiche_contact',
  deploiement: 'lien_deploiement',
  participants: 'lien_participants',
} as const
export async function operationalHash(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export function operationalConfig(locals: unknown) {
  const env = internalEnvironment(locals),
    db = submissionDatabase(locals),
    token = jeton(locals)
  if (env.OPERATIONAL_FORMS_ENABLED !== 'true' || !db || !token)
    throw new OperationalLinkError(
      503,
      'indisponible',
      'Les formulaires sont en préparation. Contactez l’équipe EUNEOS.',
    )
  return { db, token }
}
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0
export const closedDossier = (value: unknown) =>
  /^(abandonne|annule|refuse|archive)$/.test(
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase(),
  )
export async function operationalTarget(token: string, id: unknown): Promise<OperationalTarget> {
  if (!positive(id)) throw new OperationalLinkError(400, 'dossier', 'Choisissez un dossier valide.')
  const row = await lireEnregistrement(token, 'participations', id)
  if (
    row.Id !== id ||
    row.fusionne_vers != null ||
    !positive(row.etablissements_id) ||
    !positive(row.cohortes_id) ||
    closedDossier(row.statut)
  )
    throw new OperationalLinkError(
      409,
      'dossier',
      'Ce dossier n’est plus ouvert à la collecte. Vérifiez son état dans le suivi.',
    )
  const cohorts = await lireToutes(token, 'cohortes', 'Id,active')
  const active = cohorts.filter((c) => c.active === true || c.active === 1)
  if (active.length !== 1 || active[0].Id !== row.cohortes_id)
    throw new OperationalLinkError(
      409,
      'cohorte',
      'Ce dossier ne relève pas de la campagne active.',
    )
  return { participationId: id, schoolId: row.etablissements_id, cohortId: row.cohortes_id }
}
export async function issueOperationalLink(input: {
  db: SubmissionDatabase
  token: string
  participationId: unknown
  kind: OperationalKind
  issuer: string
  now?: number
}) {
  const target = await operationalTarget(input.token, input.participationId)
  await readOperationalContext(input.token, target)
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  const hash = await operationalHash(secret),
    expiresAt = (input.now ?? Date.now()) + 90 * 86400000
  const url = `https://euneos.fr${operationalPath(input.kind)}?t=${secret}`
  const acquired = await input.db
    .prepare(
      'INSERT INTO operational_submission_locks (target_id,link_hash,acquired_at) VALUES (?,?,?) ON CONFLICT(target_id) DO NOTHING',
    )
    .bind(target.participationId, hash, new Date().toISOString())
    .run()
  if (acquired.meta.changes !== 1)
    throw new OperationalLinkError(
      409,
      'dossier_occupe',
      'Une opération est en cours ou reste à vérifier sur ce dossier. Son lien ne peut pas encore être renouvelé.',
    )
  let mutationStarted = false
  try {
    const before = await operationalTarget(input.token, target.participationId)
    if (JSON.stringify(before) !== JSON.stringify(target))
      throw new OperationalLinkError(409, 'dossier', 'Ce dossier a changé. Rechargez la page.')
    await input.db
      .prepare(
        `INSERT INTO operational_links (token_hash,target_id,school_id,cohort_id,kind,issuer_hash,expires_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .bind(
        hash,
        target.participationId,
        target.schoolId,
        target.cohortId,
        input.kind,
        await operationalHash(input.issuer.toLowerCase()),
        expiresAt,
      )
      .run()
    // The private NocoDB field makes the link available to the team and its agent.
    // A lost PATCH response retains the lock: a late write must not overwrite a
    // later issuance. No URL is advertised before its readback and D1 activation.
    mutationStarted = true
    const written = await fetch(
      `https://app.nocodb.com/api/v2/tables/${NC.tables.participations}/records`,
      {
        method: 'PATCH',
        headers: { 'xc-token': input.token, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { Id: target.participationId, [operationalLinkColumns[input.kind]]: url },
        ]),
        signal: AbortSignal.timeout(12000),
      },
    )
    if (!written.ok) throw new Error('Link persistence unavailable')
    const after = await lireEnregistrement(input.token, 'participations', target.participationId)
    const freshTarget = await operationalTarget(input.token, target.participationId)
    if (
      after[operationalLinkColumns[input.kind]] !== url ||
      JSON.stringify(freshTarget) !== JSON.stringify(target)
    )
      throw new Error('Link readback differs')
    // Only the latest slot is valid. Interrupted issuance leaves an unusable orphan,
    // never two valid links. Existing receipt/lock state is preserved.
    await input.db
      .prepare(
        `INSERT INTO operational_link_slots (target_id,kind,token_hash) VALUES (?,?,?) ON CONFLICT(target_id,kind) DO UPDATE SET token_hash=excluded.token_hash`,
      )
      .bind(target.participationId, input.kind, hash)
      .run()
    const current = await input.db
      .prepare('SELECT token_hash FROM operational_link_slots WHERE target_id=? AND kind=?')
      .bind(target.participationId, input.kind)
      .first<{ token_hash: string }>()
    if (current?.token_hash !== hash)
      throw new OperationalLinkError(
        409,
        'lien_renouvele',
        'Un autre lien vient d’être créé pour ce dossier. Recommencez si nécessaire.',
      )
    await input.db
      .prepare('DELETE FROM operational_submission_locks WHERE target_id=? AND link_hash=?')
      .bind(target.participationId, hash)
      .run()
    return { url, expiresAt: new Date(expiresAt).toISOString() }
  } catch (error) {
    if (!mutationStarted)
      await input.db
        .prepare('DELETE FROM operational_submission_locks WHERE target_id=? AND link_hash=?')
        .bind(target.participationId, hash)
        .run()
    throw error
  }
}
export async function resolveOperationalLink(
  db: SubmissionDatabase,
  secret: unknown,
  kind: OperationalKind,
  now = Date.now(),
) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret))
    throw new OperationalLinkError(
      403,
      'lien_invalide',
      'Ce lien est invalide ou a expiré. Demandez un nouveau lien à l’équipe EUNEOS.',
    )
  const hash = await operationalHash(secret)
  const row = await db
    .prepare(
      `SELECT l.target_id,l.school_id,l.cohort_id,l.kind,l.expires_at FROM operational_links l JOIN operational_link_slots s ON s.token_hash=l.token_hash AND s.target_id=l.target_id AND s.kind=l.kind WHERE l.token_hash=?`,
    )
    .bind(hash)
    .first<{
      target_id: number
      school_id: number
      cohort_id: number
      kind: OperationalKind
      expires_at: number
    }>()
  if (!row || row.kind !== kind || row.expires_at <= now)
    throw new OperationalLinkError(
      403,
      'lien_invalide',
      'Ce lien est invalide ou a expiré. Demandez un nouveau lien à l’équipe EUNEOS.',
    )
  return {
    hash,
    expiresAt: new Date(row.expires_at).toISOString(),
    target: { participationId: row.target_id, schoolId: row.school_id, cohortId: row.cohort_id },
  }
}
/** Staff-only projection; stale or hand-edited URLs are never advertised. */
export async function savedOperationalLinks(db: SubmissionDatabase, row: Record<string, unknown>) {
  const links: Partial<Record<OperationalKind, { url: string; expiresAt: string }>> = {}
  for (const kind of Object.keys(operationalLinkColumns) as OperationalKind[]) {
    const value = row[operationalLinkColumns[kind]]
    if (typeof value !== 'string' || !value) continue
    let url: URL
    try {
      url = new URL(value)
    } catch {
      continue
    }
    if (
      url.origin !== 'https://euneos.fr' ||
      url.pathname !== operationalPath(kind) ||
      url.hash ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].join(',') !== 't'
    )
      continue
    try {
      const resolved = await resolveOperationalLink(db, url.searchParams.get('t'), kind)
      if (
        resolved.target.participationId === row.Id &&
        resolved.target.schoolId === row.etablissements_id &&
        resolved.target.cohortId === row.cohortes_id
      )
        links[kind] = { url: value, expiresAt: resolved.expiresAt }
    } catch (error) {
      if (!(error instanceof OperationalLinkError)) throw error
    }
  }
  return links
}
export async function getOperationalPageContext(
  request: Request,
  locals: unknown,
  rawKind: unknown,
) {
  try {
    const kind = operationalKind(rawKind),
      secret = new URL(request.url).searchParams.get('t') ?? ''
    if (modeApercu(request)) {
      if (secret !== 'demo')
        throw new OperationalLinkError(
          404,
          'apercu',
          'Cet aperçu utilise uniquement des données fictives.',
        )
      return {
        kind,
        token: secret,
        context: { schoolName: 'Collège Exemple', city: 'Ville Exemple', cohortLabel: '2026–2027' },
        state: 'ready' as const,
        preview: true,
      }
    }
    const { db, token } = operationalConfig(locals)
    const { hash, target } = await resolveOperationalLink(db, secret, kind)
    const current = await operationalTarget(token, target.participationId)
    if (JSON.stringify(current) !== JSON.stringify(target))
      throw new OperationalLinkError(
        409,
        'dossier',
        'Ce dossier a changé. Demandez un nouveau lien à l’équipe.',
      )
    const context = await readOperationalContext(token, target)
    const receipt = await readOperationalSubmission(db, hash)
    const state =
      receipt?.state === 'complete'
        ? ('complete' as const)
        : receipt && receipt.state !== 'retryable'
          ? ('review' as const)
          : ('ready' as const)
    return { kind, token: secret, context, state, preview: false }
  } catch (error) {
    return operationalError(error)
  }
}
/** Bound the actual stream, including chunked input; don't read unbounded text. */
export async function readOperationalBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new OperationalLinkError(403, 'origine', 'Rechargez ce formulaire avant de réessayer.')
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new OperationalLinkError(415, 'format', 'Format de formulaire non pris en charge.')
  const reader = request.body?.getReader()
  if (!reader) throw new OperationalLinkError(400, 'champs', 'Vérifiez les champs du formulaire.')
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 65536) {
      await reader.cancel()
      throw new OperationalLinkError(
        413,
        'taille',
        'Le formulaire contient trop de texte ou de participants.',
      )
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch {
    throw new OperationalLinkError(400, 'champs', 'Vérifiez les champs du formulaire.')
  }
}
