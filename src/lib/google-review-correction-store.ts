import { WorkspaceError, type WorkspaceDatabase } from './internal-workspace'
import type { SubmissionDatabase } from './candidature-store'
import { digest } from './google-form-sync'
import { checkGooglePersonPlan } from './google-form-person'
import { reviewVersion, positiveId, type GoogleRow } from './google-review'
import { reviewTargets, reviewConfiguration } from './google-review-store'
import {
  correctionSources,
  correctionOptions,
  sourceFor,
  sourceAnswer,
  activeAnnualDossier,
  correctionFail,
  readCorrectionRow,
  planCorrection,
  type CorrectionSource,
  type CorrectionClient,
  type CorrectionPlan,
} from './google-review-correction-plan'

export type CorrectionContext = {
  db: WorkspaceDatabase
  shared: SubmissionDatabase
  table: string
  client: CorrectionClient
  sources: CorrectionSource[]
  now?: () => string
}
type Saved = {
  id: string
  journal_id: number
  source_key: string
  source_version: string
  target_key: string
  actor: string
  plan_hash: string
  plan_json: string
  state: 'prepared' | 'writing' | 'uncertain' | 'complete' | 'conflict'
  created_at: string
  updated_at: string
  verified_at: string | null
  result_json: string | null
}
const clock = (ctx: CorrectionContext) => ctx.now?.() ?? new Date().toISOString()
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
export function correctionContext(
  env: Record<string, unknown>,
  db: WorkspaceDatabase,
): CorrectionContext {
  const base = reviewConfiguration(env, db),
    shared = env.FORM_SUBMISSIONS as SubmissionDatabase
  if (!shared?.prepare)
    return correctionFail('Le registre partagé des formulaires n’est pas disponible.', 503)
  return {
    ...base,
    shared,
    sources: correctionSources(env.GOOGLE_REVIEW_CORRECTION_SOURCES),
    client: async (path, method = 'GET', body) => {
      if (method === 'GET') return base.client(path)
      if (method !== 'PATCH') return correctionFail('Écriture non autorisée.', 400)
      // Exactly one write attempt. A timeout, non-2xx or unreadable response is uncertain.
      const response = await fetch('https://app.nocodb.com/api/v2' + path, {
        method,
        redirect: 'manual',
        headers: { 'xc-token': String(env.NOCODB_TOKEN), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      })
      if (!response.ok) throw new Error('correction_write_unconfirmed')
      return response.json()
    },
  }
}
const load = (ctx: CorrectionContext, id: string) =>
  ctx.db.prepare('SELECT * FROM google_review_corrections WHERE id=?').bind(id).first<Saved>()
const savedPlan = (s: Saved): CorrectionPlan => JSON.parse(s.plan_json)
function presentation(s: Saved) {
  const p = savedPlan(s)
  const result = s.result_json ? JSON.parse(s.result_json) : {}
  const explanations: Record<string, string> = {
    collector_busy:
      'La collecte Google est en cours. Attendez sa fin puis préparez un nouvel aperçu.',
    dossier_busy:
      'Un autre formulaire traite ce dossier ou attend une vérification. Aucune correction envoyée.',
    preview_expired: 'L’aperçu a expiré. Préparez-le de nouveau avant de confirmer.',
  }
  return {
    id: s.id,
    hash: s.plan_hash,
    planHash: s.plan_hash,
    state: s.state === 'writing' ? 'uncertain' : s.state,
    at: s.verified_at ?? s.updated_at,
    title: p.title,
    targetLabel: p.target.label,
    changes: p.changes,
    actor: s.actor,
    reason: p.reason,
    sourceKey: s.source_key,
    fields: Object.keys(p.plan.after),
    message:
      s.state === 'complete'
        ? 'Correction enregistrée et relue dans NocoDB. Les autres réponses du formulaire restent conservées.'
        : s.state === 'prepared'
          ? 'Vérifiez l’avant/après puis confirmez. Aucune donnée n’a encore été modifiée.'
          : s.state === 'conflict'
            ? (result.message ??
              explanations[result.code] ??
              'La situation a changé : préparez un nouvel aperçu. Aucune réussite n’est attestée.')
            : 'Résultat incertain. Vérifiez le résultat ; ne renvoyez pas la correction. La collecte Google reste suspendue jusqu’à cette vérification.',
  }
}
export async function listCorrections(
  ctx: Pick<CorrectionContext, 'db'>,
  rows: { id: number; sourceKey: string }[],
) {
  const all = await ctx.db
    .prepare('SELECT * FROM google_review_corrections ORDER BY created_at DESC,id DESC')
    .bind()
    .all<Saved>()
  return rows.map((row) => {
    const list = all.results.filter(
      (s) => s.journal_id === row.id && s.source_key === row.sourceKey,
    )
    const selected = list.find((s) => s.state === 'uncertain' || s.state === 'writing') ?? list[0]
    return { ...row, correction: selected ? presentation(selected) : null }
  })
}
export async function getCorrectionOptions(ctx: CorrectionContext, id: number) {
  if (!positiveId(id)) return correctionFail('Référence de réponse invalide.', 400)
  const row = await readCorrectionRow(ctx.client, ctx.table, id)
  const [withCorrection] = await listCorrections(ctx, [
    { id: row.Id, sourceKey: String(row.cle_reponse) },
  ])
  return { options: correctionOptions(row, ctx.sources), correction: withCorrection.correction }
}
function exactKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some((k) => !keys.includes(k)))
    return correctionFail('La demande contient un champ non autorisé.', 400)
}
export async function prepareCorrection(
  ctx: CorrectionContext,
  body: Record<string, unknown>,
  actor: string,
) {
  exactKeys(body, ['action', 'id', 'version', 'targetKind', 'targetId', 'values', 'reason'])
  if (
    !positiveId(body.id) ||
    !positiveId(body.targetId) ||
    !['school', 'trainer'].includes(String(body.targetKind)) ||
    typeof body.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.version) ||
    typeof body.reason !== 'string' ||
    !body.reason.trim() ||
    body.reason.length > 2000 ||
    /[\u0000-\u001f]/.test(body.reason) ||
    !body.values ||
    typeof body.values !== 'object' ||
    Array.isArray(body.values)
  )
    return correctionFail('Choisissez le dossier annuel et justifiez la correction.', 400)
  const row = await readCorrectionRow(ctx.client, ctx.table, body.id)
  if ((await reviewVersion(row)) !== body.version)
    return correctionFail('La réponse a changé. Actualisez avant de préparer la correction.')
  if (typeof row.cle_reponse !== 'string' || !row.cle_reponse)
    return correctionFail('La référence source est absente.')
  const source = sourceFor(row, ctx.sources)
  if (!source)
    return correctionFail('Ce formulaire n’a pas de correspondance de correction vérifiée.')
  const target = (await reviewTargets(ctx.client)).find(
    (t) => t.id === body.targetId && t.kind === body.targetKind,
  )
  if (!target) return correctionFail('Ce dossier annuel n’est plus disponible.')
  const at = clock(ctx)
  const plan = await planCorrection({
    row,
    source,
    target,
    values: body.values as Record<string, unknown>,
    actor,
    reason: body.reason.trim(),
    client: ctx.client,
    now: at,
  })
  const fresh = await readCorrectionRow(ctx.client, ctx.table, row.Id)
  if ((await reviewVersion(fresh)) !== body.version)
    return correctionFail('La source a changé pendant la préparation. Actualisez.')
  const hash = await digest(JSON.stringify(plan)),
    id = crypto.randomUUID()
  // Reservations begin only at confirmation, so abandoned previews never block work.
  await ctx.db
    .prepare(
      "INSERT INTO google_review_corrections(id,journal_id,source_key,source_version,target_key,actor,plan_hash,plan_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'prepared',?,?)",
    )
    .bind(
      id,
      row.Id,
      plan.sourceKey,
      plan.sourceVersion,
      `${plan.plan.table}:${plan.plan.id}`,
      actor,
      hash,
      JSON.stringify(plan),
      at,
      at,
    )
    .run()
  return { preview: presentation((await load(ctx, id))!) }
}
async function freshness(ctx: CorrectionContext, s: Saved, p: CorrectionPlan) {
  if ((await digest(s.plan_json)) !== s.plan_hash)
    return correctionFail('Le plan enregistré ne peut pas être vérifié.')
  const source = ctx.sources.find((x) => x.label === p.sourceConfig.label)
  if (!source || !same(source, p.sourceConfig))
    return correctionFail('La correspondance du formulaire a changé. Préparez un nouvel aperçu.')
  const row = await readCorrectionRow(ctx.client, ctx.table, s.journal_id)
  if (
    String(row.cle_reponse) !== p.sourceKey ||
    (await reviewVersion(row)) !== p.sourceVersion ||
    String(row.reponses) !== p.sourceRaw
  )
    return correctionFail('La réponse source a changé. Aucun résultat ne peut être confirmé.')
  const targets = await reviewTargets(ctx.client)
  if (!targets.some((t) => t.kind === p.target.kind && t.id === p.target.id))
    return correctionFail('Le dossier annuel n’est plus disponible.')
  // Check duplicate annual dossiers and changed people directories, not just the chosen row.
  const dossierGuard = p.plan.guard.find((g) => Object.hasOwn(g.fields, 'cohortes_id'))
  if (dossierGuard) {
    const relation = Object.hasOwn(dossierGuard.fields, 'etablissements_id')
      ? 'etablissements_id'
      : 'formateurs_id'
    const res = await activeAnnualDossier(
      ctx.client,
      dossierGuard.table,
      relation,
      Number(dossierGuard.fields[relation]),
      Number(dossierGuard.fields.cohortes_id),
    )
    if (res.Id !== dossierGuard.id) return correctionFail('Le dossier annuel n’est plus unique.')
  }
  const personGuard =
    p.plan.guard.find(
      (g) => Object.hasOwn(g.fields, 'email_2') || Object.hasOwn(g.fields, 'referent_email'),
    ) ?? p.plan.guard.find((g) => Object.hasOwn(g.fields, 'email'))
  if (personGuard) {
    const email = sourceAnswer(row, p.sourceConfig, 'email').toLowerCase()
    if (email) {
      const keys = Object.hasOwn(personGuard.fields, 'referent_email')
        ? ['referent_email', 'email_direction', 'email_institutionnel', 'email_logistique']
        : Object.hasOwn(personGuard.fields, 'email_2')
          ? ['email', 'email_2']
          : ['email']
      const res = await ctx.client(
        `/tables/${personGuard.table}/records?${new URLSearchParams({ where: keys.map((k) => `(${k},eq,${email})`).join('~or'), limit: '2' })}`,
      )
      if (
        !Array.isArray(res.list) ||
        res.pageInfo?.isLastPage !== true ||
        res.list.length !== 1 ||
        res.list[0].Id !== personGuard.id
      )
        return correctionFail('L’identité n’est plus unique.')
    }
  }
  return checkGooglePersonPlan(p.plan, (path) => ctx.client('/' + path))
}
async function finish(
  ctx: CorrectionContext,
  s: Saved,
  state: Saved['state'],
  details: Record<string, unknown> = {},
) {
  const at = clock(ctx)
  await ctx.db
    .prepare(
      "UPDATE google_review_corrections SET state=?,updated_at=?,verified_at=?,result_json=? WHERE id=? AND state<>'complete'",
    )
    .bind(state, at, state === 'complete' ? at : null, JSON.stringify(details), s.id)
    .run()
  const saved = (await load(ctx, s.id))!
  return {
    state: saved.state === 'writing' ? 'uncertain' : saved.state,
    message: presentation(saved).message,
    correction: presentation(saved),
  }
}
async function operation(
  ctx: CorrectionContext,
  body: Record<string, unknown>,
  actor: string,
  check = false,
) {
  exactKeys(
    body,
    check
      ? ['action', 'operationId', 'planHash']
      : ['action', 'operationId', 'planHash', 'confirmed'],
  )
  if (
    typeof body.operationId !== 'string' ||
    typeof body.planHash !== 'string' ||
    (!check && body.confirmed !== true)
  )
    return correctionFail('Confirmez exactement l’aperçu affiché.', 400)
  const s = await load(ctx, body.operationId)
  if (!s || s.actor !== actor || s.plan_hash !== body.planHash)
    return correctionFail('Cet aperçu ne correspond pas à votre confirmation.', 403)
  const p = savedPlan(s)
  if (s.state === 'complete') {
    await releaseSharedTarget(ctx, s, p)
    await releaseCollector(ctx, s)
    return { state: 'complete', message: presentation(s).message, correction: presentation(s) }
  }
  if (s.state === 'conflict')
    return { state: 'conflict', message: presentation(s).message, correction: presentation(s) }
  if (check) {
    if (!['uncertain', 'writing'].includes(s.state))
      return correctionFail('Aucune écriture incertaine à vérifier.')
    // Explicit check is read-only on NocoDB. Only verified values can complete an audit.
    try {
      const actual = await freshness(ctx, s, p)
      if (actual !== 'after') return finish(ctx, s, 'uncertain', { code: 'readback_not_verified' })
      const result = await finish(ctx, s, 'complete', {
        code: 'readback_verified_after_uncertainty',
      })
      await releaseSharedTarget(ctx, s, p)
      await releaseCollector(ctx, s)
      return result
    } catch {
      return finish(ctx, s, 'uncertain', { code: 'readback_unavailable_or_changed' })
    }
  }
  if (s.state === 'writing' || s.state === 'uncertain')
    return { state: 'uncertain', message: presentation(s).message, correction: presentation(s) }
  if (Date.parse(p.expiresAt) < Date.parse(clock(ctx)))
    return finish(ctx, s, 'conflict', { code: 'preview_expired' })
  try {
    if ((await freshness(ctx, s, p)) === 'conflict')
      return finish(ctx, s, 'conflict', { code: 'existing_value_changed' })
  } catch (error) {
    if (error instanceof WorkspaceError)
      return finish(ctx, s, 'conflict', { code: 'source_or_guard_changed', message: error.message })
    throw error
  }
  // Both partial UNIQUE indexes arbitrate concurrent source and target confirmations.
  let marked
  try {
    marked = await ctx.db
      .prepare(
        "UPDATE google_review_corrections SET state='writing',updated_at=? WHERE id=? AND state='prepared'",
      )
      .bind(clock(ctx), s.id)
      .run()
  } catch {
    return correctionFail(
      'Une correction de cette réponse ou de cette fiche est déjà en cours. Actualisez.',
    )
  }
  if (marked.meta.changes !== 1) {
    const current = (await load(ctx, s.id))!
    return {
      state: current.state === 'writing' ? 'uncertain' : current.state,
      message: presentation(current).message,
      correction: presentation(current),
    }
  }
  let workerLocked = false,
    targetLocked = false,
    attempted = false
  const lockOwner = `manual-correction:${s.id}`
  try {
    // Share the existing Worker lease so a captured source cannot project concurrently.
    const now = Date.parse(clock(ctx))
    const lock = await ctx.shared
      .prepare(
        "INSERT INTO google_transition_runs(id,owner,expires_at) VALUES('poll',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<?",
      )
      .bind(lockOwner, Number.MAX_SAFE_INTEGER, now)
      .run()
    if (lock.meta.changes !== 1) return await finish(ctx, s, 'conflict', { code: 'collector_busy' })
    workerLocked = true
    // Date corrections share the site's existing operational dossier lock.
    if (p.target.kind === 'school') {
      const locked = await ctx.shared
        .prepare(
          'INSERT INTO operational_submission_locks(target_id,link_hash) VALUES(?,?) ON CONFLICT(target_id) DO NOTHING',
        )
        .bind(p.target.id, lockOwner)
        .run()
      if (locked.meta.changes !== 1)
        return await finish(ctx, s, 'conflict', { code: 'dossier_busy' })
      targetLocked = true
    }
    await reserveNativeClaims(ctx, s, p)
    const current = await freshness(ctx, s, p)
    if (current === 'conflict')
      return await finish(ctx, s, 'conflict', { code: 'existing_value_changed' })
    if (current === 'after')
      return await finish(ctx, s, 'complete', { code: 'already_verified', writes: 0 })
    const lease = await ctx.shared
      .prepare(
        "SELECT owner FROM google_transition_runs WHERE id='poll' AND owner=? AND expires_at>?",
      )
      .bind(lockOwner, Date.parse(clock(ctx)))
      .first()
    if (!lease) return await finish(ctx, s, 'conflict', { code: 'collector_lock_lost' })
    const patch = Object.fromEntries(
      Object.entries(p.plan.after).filter(([k, v]) => !same(v, p.plan.before[k])),
    )
    attempted = true
    try {
      await ctx.client(`/tables/${p.plan.table}/records`, 'PATCH', [{ Id: p.plan.id, ...patch }])
    } catch {
      return await finish(ctx, s, 'uncertain', { code: 'write_response_lost' })
    }
    const actual = await freshness(ctx, s, p)
    if (actual !== 'after') return await finish(ctx, s, 'uncertain', { code: 'readback_mismatch' })
    return await finish(ctx, s, 'complete', { code: 'readback_verified', writes: 1 })
  } catch (error) {
    return await finish(ctx, s, attempted ? 'uncertain' : 'conflict', {
      code: attempted ? 'readback_unavailable' : 'prewrite_failed',
      ...(!attempted && error instanceof WorkspaceError ? { message: error.message } : {}),
    })
  } finally {
    const current = await load(ctx, s.id)
    // An uncertain operational write retains its dossier lock. check-correction can release it after proof.
    if (targetLocked && current && ['complete', 'conflict'].includes(current.state))
      await releaseSharedTarget(ctx, s, p)
    if (workerLocked && current && ['complete', 'conflict'].includes(current.state))
      await releaseCollector(ctx, s)
  }
}
async function releaseSharedTarget(ctx: CorrectionContext, s: Saved, p: CorrectionPlan) {
  if (p.target.kind === 'school')
    await ctx.shared
      .prepare('DELETE FROM operational_submission_locks WHERE target_id=? AND link_hash=?')
      .bind(p.target.id, `manual-correction:${s.id}`)
      .run()
}
async function releaseCollector(ctx: CorrectionContext, s: Saved) {
  await ctx.shared
    .prepare("UPDATE google_transition_runs SET expires_at=0 WHERE id='poll' AND owner=?")
    .bind(`manual-correction:${s.id}`)
    .run()
}
/** Coordinate with the existing native executors, not a parallel lock namespace.
 * Claims never expire or change owner. A terminal native projection cannot write again.
 * A technical receipt represents only the manual audit; it is not a user submission.
 */
async function reserveNativeClaims(ctx: CorrectionContext, s: Saved, p: CorrectionPlan) {
  if (['contact', 'organisation'].includes(p.family)) return
  const table =
    p.family === 'preformation'
      ? 'public_preformation_person_claims'
      : p.family === 'accord_formateur'
        ? 'public_accord_claims'
        : ['evaluation', 'bilan_etablissement'].includes(p.family)
          ? 'public_final_questionnaire_claims'
          : 'public_postformation_claims'
  const projection =
    p.family === 'preformation'
      ? 'public_preformation_projections'
      : p.family === 'accord_formateur'
        ? 'public_accord_projections'
        : ['evaluation', 'bilan_etablissement'].includes(p.family)
          ? 'public_final_questionnaire_projections'
          : 'public_postformation_projections'
  const identity = p.plan.guard.find((g) => g.table === p.plan.table && g.id === p.plan.id)
  const emails = [
    ...new Set(
      [identity?.fields.email, identity?.fields.email_2]
        .filter((v): v is string => typeof v === 'string' && !!v.trim())
        .map((v) => v.trim().toLowerCase()),
    ),
  ]
  const keys =
    p.family === 'preformation'
      ? emails.map((email) => `${p.plan.table}:${p.target.id}:${email}`)
      : [
          p.family === 'accord_formateur'
            ? `${p.plan.table}:${p.plan.id}`
            : `${p.plan.table}:${p.plan.id}:${Object.keys(p.plan.after)[0]}`,
        ]
  if (!keys.length) return correctionFail('La clé de coordination des réceptions est absente.')
  const receipt = await digest(`manual-google-correction:${s.id}`)
  await ctx.shared
    .prepare(
      "INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash,code) VALUES(?,'manual_google_correction',?,?)",
    )
    .bind(receipt, s.plan_hash, s.id)
    .run()
  for (const key of keys) {
    const identityKey = await digest(key)
    await ctx.shared
      .prepare(`INSERT OR IGNORE INTO ${table}(identity_key,receipt) VALUES(?,?)`)
      .bind(identityKey, receipt)
      .run()
    const claim = await ctx.shared
      .prepare(`SELECT receipt FROM ${table} WHERE identity_key=?`)
      .bind(identityKey)
      .first<{ receipt: string }>()
    if (!claim) return correctionFail('Le verrou de réception ne peut pas être vérifié.')
    if (claim.receipt === receipt) continue
    const native = await ctx.shared
      .prepare(`SELECT state FROM ${projection} WHERE receipt=?`)
      .bind(claim.receipt)
      .first<{ state: string }>()
    // A terminal review can follow a timed-out write: it does not prove the request stopped.
    // Only a verified complete projection allows a later manual correction.
    if (native?.state === 'complete') continue
    const manual = await ctx.shared
      .prepare(
        "SELECT code FROM public_form_receipts WHERE receipt=? AND kind='manual_google_correction'",
      )
      .bind(claim.receipt)
      .first<{ code: string }>()
    const audit = manual ? await load(ctx, manual.code) : null
    if (audit && ['complete', 'conflict'].includes(audit.state)) continue
    return correctionFail(
      'Une réception du site est en cours ou incertaine pour cette fiche. Vérifiez-la avant de corriger.',
    )
  }
}
export const confirmCorrection = (
  ctx: CorrectionContext,
  body: Record<string, unknown>,
  actor: string,
) => operation(ctx, body, actor)
export const checkCorrection = (
  ctx: CorrectionContext,
  body: Record<string, unknown>,
  actor: string,
) => operation(ctx, body, actor, true)
