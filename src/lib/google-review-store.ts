import { NC, reconcilierActifs } from './nocodb'
import { WorkspaceError, type WorkspaceDatabase } from './internal-workspace'
import {
  manualReview,
  parseReviewCommand,
  positiveId,
  reviewVersion,
  reviewView,
  REVIEW_OPEN,
  REVIEW_CLOSE,
  type GoogleRow,
  type ReviewTarget,
  type ManualReview,
} from './google-review'

const unavailable = () =>
  new WorkspaceError(
    503,
    'Les réponses Google sont momentanément indisponibles. Aucune nouvelle confirmation ne doit être envoyée sans actualiser.',
  )
/** Same bounded 650ms pacing and explicit-429 retry policy as the transition client.
 * Its client is private to the Worker, so this adapter has no Worker dependency.
 * No retry of writes after transport/5xx errors; token never follows redirects. */
export function reviewClient(
  token: string,
  transport: typeof fetch = fetch,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
) {
  return async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(650)
      let response: Response
      try {
        response = await transport(`https://app.nocodb.com/api/v2${path}`, {
          method,
          redirect: 'manual',
          signal: AbortSignal.timeout(12000),
          headers: { 'xc-token': token, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      } catch {
        throw unavailable()
      }
      if (response.status === 429 && attempt < 2) {
        const header = response.headers.get('retry-after'),
          parsed =
            header && /^\d+(\.\d+)?$/.test(header)
              ? Number(header) * 1000
              : header
                ? Date.parse(header) - Date.now()
                : 2000
        const delay = Math.max(1500 * 2 ** attempt, Number.isFinite(parsed) ? parsed : 2000)
        await response.body?.cancel()
        if (delay > 10000)
          throw new WorkspaceError(
            429,
            'La base limite les lectures. Attendez quelques instants avant d’actualiser.',
          )
        await sleep(delay)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw unavailable()
      }
      try {
        return await response.json()
      } catch {
        throw unavailable()
      }
    }
    throw unavailable()
  }
}
type Client = ReturnType<typeof reviewClient>
export function reviewConfiguration(env: Record<string, unknown>, db: WorkspaceDatabase) {
  if (
    typeof env.NOCODB_TOKEN !== 'string' ||
    !env.NOCODB_TOKEN ||
    typeof env.GOOGLE_REVIEW_JOURNAL_TABLE !== 'string' ||
    !/^[a-z0-9]{10,30}$/.test(env.GOOGLE_REVIEW_JOURNAL_TABLE)
  )
    throw new WorkspaceError(503, 'La revue des réponses Google est en préparation.')
  return { db, table: env.GOOGLE_REVIEW_JOURNAL_TABLE, client: reviewClient(env.NOCODB_TOKEN) }
}
type Context = { db: WorkspaceDatabase; table: string; client: Client }
async function all(client: Client, table: string): Promise<GoogleRow[]> {
  const rows: GoogleRow[] = [],
    ids = new Set<number>()
  for (;;) {
    const data = await client(`/tables/${table}/records?limit=200&offset=${rows.length}&sort=Id`)
    if (!Array.isArray(data.list)) throw unavailable()
    for (const row of data.list) {
      if (!positiveId(row?.Id) || ids.has(row.Id)) throw unavailable()
      ids.add(row.Id)
      rows.push(row)
    }
    if (
      data.pageInfo?.isLastPage === true ||
      (!data.list.length && data.pageInfo?.isLastPage !== false)
    )
      return rows
    if (!data.list.length || rows.length > 10000) throw unavailable()
  }
}
async function read(client: Client, table: string, id: number) {
  const row = await client(`/tables/${table}/records/${id}`)
  if (!row || row.Id !== id) throw unavailable()
  return row as GoogleRow
}
export async function reviewTargets(client: Client): Promise<ReviewTarget[]> {
  const schools = await all(client, NC.tables.etablissements),
    parts = reconcilierActifs(await all(client, NC.tables.participations), [
      'etablissements_id',
      'cohortes_id',
    ])
  const trainers = await all(client, NC.tables.formateurs),
    engagements = reconcilierActifs(
      await all(client, NC.tables.engagements),
      ['formateurs_id', 'cohortes_id'],
      ['cohortes_id'],
    )
  const cohorts = await all(client, NC.tables.cohortes)
  const cohort = (id: unknown) => {
    const c = cohorts.find((c) => c.Id === id)
    return c ? String(c.nom || `${c.annee_debut}–${c.annee_fin}`) : 'Cohorte non renseignée'
  }
  const targets: ReviewTarget[] = []
  for (const p of parts) {
    const s = schools.find((s) => s.Id === p.etablissements_id && s.fusionne_vers == null)
    if (s)
      targets.push({
        kind: 'school',
        id: p.Id,
        label: `${s.nom} — ${s.ville ?? ''} — ${cohort(p.cohortes_id)} — ${p.code || `dossier #${p.Id}`} — ${p.statut ?? ''}`,
      })
  }
  for (const p of engagements) {
    const t = trainers.find((t) => t.Id === p.formateurs_id && t.fusionne_vers == null)
    if (t)
      targets.push({
        kind: 'trainer',
        id: p.Id,
        label: `${t.prenom ?? ''} ${t.nom ?? ''} — ${t.email ?? ''} — ${cohort(p.cohortes_id)} — parcours #${p.Id}`,
      })
  }
  return targets.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}
export async function listReviews(ctx: Context) {
  // Fail closed until the durable audit registry has been migrated.
  const operations = (
    await ctx.db
      .prepare('SELECT journal_id, state, audit_json FROM google_review_attachments')
      .bind()
      .all<{ journal_id: number; state: string; audit_json: string }>()
  ).results
  const rows = await all(ctx.client, ctx.table)
  return {
    rows: await Promise.all(
      rows.map(async (row) => ({
        ...(await reviewView(row)),
        operation: operations.find((o) => o.journal_id === row.Id) ?? null,
      })),
    ),
    targets: await reviewTargets(ctx.client),
  }
}
export async function attachReview(ctx: Context, body: Record<string, unknown>, actor: string) {
  const command = parseReviewCommand(body),
    row = await read(ctx.client, ctx.table, command.id)
  if ((await reviewVersion(row)) !== command.version || manualReview(row))
    throw new WorkspaceError(
      409,
      'Cette réponse a changé ou possède déjà un rattachement. Actualisez pour la relire.',
    )
  if (typeof row.cle_reponse !== 'string' || !row.cle_reponse) throw unavailable()
  const target = (await reviewTargets(ctx.client)).find(
    (t) => t.kind === command.targetKind && t.id === command.targetId,
  )
  if (!target)
    throw new WorkspaceError(
      409,
      'Ce dossier n’est plus disponible. Actualisez et choisissez un dossier actif.',
    )
  const audit: ManualReview = {
    version: 1,
    sourceKey: row.cle_reponse,
    target,
    actor,
    at: new Date().toISOString(),
    reason: command.reason,
    action: 'attachment-only',
    id: crypto.randomUUID(),
  }
  const previous = typeof row.detail_reprise === 'string' ? row.detail_reprise : ''
  const detail = `${previous}\n${REVIEW_OPEN}${JSON.stringify(audit)}${REVIEW_CLOSE}`
  if (detail.length > 90000)
    throw new WorkspaceError(
      409,
      'Cet historique doit être traité par l’administrateur pour être préservé intégralement.',
    )
  const claim = await ctx.db
    .prepare(
      "INSERT INTO google_review_attachments(journal_id,source_key,state,audit_json,before_detail,after_detail) VALUES (?,?,'pending',?,?,?) ON CONFLICT(journal_id) DO NOTHING",
    )
    .bind(row.Id, row.cle_reponse, JSON.stringify(audit), previous, detail)
    .run()
  if (claim.meta.changes !== 1)
    throw new WorkspaceError(
      409,
      'Un rattachement existe ou doit être vérifié. Actualisez ; ne recommencez pas la confirmation.',
    )
  // Keep the claim after every uncertainty. Never erase an audit or retry blindly.
  const fresh = await read(ctx.client, ctx.table, row.Id)
  if ((await reviewVersion(fresh)) !== command.version)
    throw new WorkspaceError(
      409,
      'La source a changé pendant la vérification. Le rattachement reste en attente de contrôle ; aucune donnée métier n’a été modifiée.',
    )
  await ctx.client(`/tables/${ctx.table}/records`, 'PATCH', [
    { Id: row.Id, detail_reprise: detail },
  ])
  const verified = await read(ctx.client, ctx.table, row.Id)
  if (verified.detail_reprise !== detail) throw unavailable()
  await ctx.db
    .prepare(
      "UPDATE google_review_attachments SET state='complete' WHERE journal_id=? AND audit_json=?",
    )
    .bind(row.Id, JSON.stringify(audit))
    .run()
  return {
    row: await reviewView(verified),
    message:
      'Rattachement enregistré. Les données de la réponse ne sont pas intégrées aux champs du dossier par cette action.',
  }
}
