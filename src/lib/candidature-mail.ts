import type { BrevoEnv } from './brevo'
import type { SubmissionDatabase } from './candidature-store'
import { cohorteActive, lireEnregistrement, lireToutes } from './nocodb'
import { statutCandidature } from './statut-candidature'
import {
  acknowledgementPayload,
  decisionTemplate,
  renderDecision,
  validatePayload,
  type DecisionMailKind,
  type MailPayload,
} from './candidature-mail-templates'

export interface CandidatureMailEnv extends BrevoEnv {
  CANDIDATURE_MAIL_REGISTRY_ENABLED?: string
  CANDIDATURE_MAIL_SEND_ENABLED?: string
  CANDIDATURE_MAIL_OWNER?: string
  CANDIDATURE_DECISION_SEND_ENABLED?: string
  CANDIDATURE_DECISION_TEMPLATES?: string
}
export class CandidatureMailError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export type MailRow = {
  id: string
  participation_id: number
  school_id: number
  cohort_id: number
  kind: 'ar' | DecisionMailKind
  source: string
  submission_key: string | null
  state: string
  payload: string
  preview_hash: string
  template_version: string
  approval_ref: string | null
  issuer: string
  before_status: string | null
  confirmed_at: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
  attempt_id: string | null
  attempt_started_at: string | null
  message_id: string | null
  provider_state: string | null
  last_error: string | null
}
type Context = { db: SubmissionDatabase; token: string; env: CandidatureMailEnv }
const now = () => new Date().toISOString()
const fail = (status: number, message: string): never => {
  throw new CandidatureMailError(status, message)
}
export const registryEnabled = (env: CandidatureMailEnv) =>
  env.CANDIDATURE_MAIL_REGISTRY_ENABLED === 'true'
function registry(env: CandidatureMailEnv) {
  if (!registryEnabled(env)) fail(503, 'Le registre des emails de candidature n’est pas activé.')
}
const target = (kind: DecisionMailKind) => (kind === 'accepted' ? 'Candidature acceptée' : 'Refuse')
const positiveId = (id: unknown): id is number =>
  typeof id === 'number' && Number.isSafeInteger(id) && id > 0
export async function mailHash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
export async function getCandidatureMail(db: SubmissionDatabase, id: string) {
  const row = await db
    .prepare('SELECT * FROM candidature_mails WHERE id=?')
    .bind(id)
    .first<MailRow>()
  if (!row) return fail(404, 'Email introuvable.')
  return row
}
export async function listCandidatureMails(db: SubmissionDatabase, participationId: number) {
  if (!positiveId(participationId)) return fail(400, 'Dossier invalide.')
  return (
    await db
      .prepare('SELECT * FROM candidature_mails WHERE participation_id=? ORDER BY created_at,id')
      .bind(participationId)
      .all<MailRow>()
  ).results
}
/** Stored before the candidature is complete. The SQL trigger promotes this
 * intent atomically with its receipt; only the site creation path calls this. */
export async function prepareAcknowledgement(input: {
  db: SubmissionDatabase
  env: CandidatureMailEnv
  submissionKey: string
  participationId: number
  schoolId: number
  cohortId: number
  school: string
  email: string
}) {
  registry(input.env)
  const payload = acknowledgementPayload(input.school, input.email)
  const id = 'ar:' + input.submissionKey,
    timestamp = now()
  const receipt = await input.db
    .prepare(
      'SELECT state,phase,record_id,parent_id,cohort_id FROM form_submissions WHERE submission_key=?',
    )
    .bind(input.submissionKey)
    .first<{
      state: string
      phase: string
      record_id: number
      parent_id: number
      cohort_id: number
    }>()
  if (
    !receipt ||
    receipt.state !== 'processing' ||
    receipt.phase !== 'verifying' ||
    receipt.record_id !== input.participationId ||
    receipt.parent_id !== input.schoolId ||
    receipt.cohort_id !== input.cohortId
  )
    return fail(409, 'Cet accusé ne correspond pas à une nouvelle candidature vérifiée.')
  await input.db
    .prepare(
      `INSERT INTO candidature_mails
    (id,participation_id,school_id,cohort_id,kind,source,submission_key,state,payload,preview_hash,template_version,issuer,created_at,updated_at)
    VALUES(?,?,?,?,'ar','site_submission',?,'awaiting_receipt',?,?,'site-ar-v1','site',?,?)`,
    )
    .bind(
      id,
      input.participationId,
      input.schoolId,
      input.cohortId,
      input.submissionKey,
      JSON.stringify(payload),
      await mailHash(payload),
      timestamp,
      timestamp,
    )
    .run()
  return id
}
export async function readDossier(token: string, id: number) {
  if (!positiveId(id)) return fail(400, 'Dossier invalide.')
  const part = await lireEnregistrement(token, 'participations', id)
  if (
    part.Id !== id ||
    part.fusionne_vers != null ||
    !positiveId(part.etablissements_id) ||
    !positiveId(part.cohortes_id)
  )
    return fail(409, 'Le dossier est archivé ou ses liens sont incomplets.')
  const activeDossiers = await lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers')
  const sameDossier = activeDossiers.filter(row => row.etablissements_id === part.etablissements_id && row.cohortes_id === part.cohortes_id)
  if (sameDossier.length !== 1 || sameDossier[0].Id !== id) return fail(409, 'Le dossier courant est ambigu ou a été archivé. Aucune décision possible.')
  if ((await cohorteActive(token)) !== part.cohortes_id)
    return fail(409, 'Ce dossier n’appartient pas à la campagne active.')
  const school = await lireEnregistrement(token, 'etablissements', part.etablissements_id)
  const cohort = await lireEnregistrement(token, 'cohortes', part.cohortes_id)
  if (
    school.Id !== part.etablissements_id ||
    cohort.Id !== part.cohortes_id ||
    typeof school.nom !== 'string' ||
    !school.nom.trim() ||
    typeof school.referent_email !== 'string'
  )
    return fail(409, 'Les coordonnées du dossier doivent être vérifiées.')
  return { part, school, cohort, code: statutCandidature(String(part.statut ?? '')).code }
}
/** A server-created prospective intent is mandatory BEFORE the human decision.
 * Existing accepted/refused/ambiguous rows cannot be backfilled into this flow.
 * This service never PATCHes NocoDB, nor subscribes to its update webhook. */
export async function prepareDecisionMail(
  input: Context & { participationId: number; kind: DecisionMailKind; actor: string },
) {
  registry(input.env)
  if (!['accepted', 'refused'].includes(input.kind)) return fail(400, 'Décision invalide.')
  const d = await readDossier(input.token, input.participationId)
  if (d.code !== 'Candidature recue')
    return fail(
      409,
      'Préparez l’email avant la décision, sur une candidature reçue. Aucune reprise historique automatique.',
    )
  const template = decisionTemplate(input.env.CANDIDATURE_DECISION_TEMPLATES, input.kind)
  const cohort = String(d.cohort.nom ?? `${d.cohort.annee_debut}–${d.cohort.annee_fin}`)
  const payload = renderDecision(template, {
    school: String(d.school.nom),
    cohort,
    email: String(d.school.referent_email),
  })
  const id = crypto.randomUUID(),
    timestamp = now(),
    expires = new Date(Date.now() + 15 * 60_000).toISOString()
  const hash = await mailHash([
    id,
    input.kind,
    input.participationId,
    d.part.etablissements_id,
    d.part.cohortes_id,
    payload,
    template,
  ])
  try {
    await input.db
      .prepare(
        `INSERT INTO candidature_mails
      (id,participation_id,school_id,cohort_id,kind,source,state,payload,preview_hash,template_version,approval_ref,issuer,before_status,expires_at,created_at,updated_at)
      VALUES(?,?,?,?,?,'interactive_decision','draft',?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        input.participationId,
        Number(d.part.etablissements_id),
        Number(d.part.cohortes_id),
        input.kind,
        JSON.stringify(payload),
        hash,
        template.version,
        template.approvalRef || null,
        input.actor,
        String(d.part.statut),
        expires,
        timestamp,
        timestamp,
      )
      .run()
  } catch (error) {
    const existing = await listCandidatureMails(input.db, input.participationId)
    if (
      existing.some(
        (m) =>
          m.state !== 'cancelled' &&
          (m.kind === input.kind ||
            (['draft', 'queued', 'sending', 'uncertain'].includes(m.state) && m.kind !== 'ar')),
      )
    )
      return fail(
        409,
        'Un email de décision existe déjà. Consultez ou annulez le brouillon avant de reprendre.',
      )
    throw error
  }
  return {
    ...(await getCandidatureMail(input.db, id)),
    canConfirm: Boolean(template.approvalRef),
    payload: payload,
  }
}
export async function confirmDecisionMail(
  input: Context & { id: string; previewHash: string; actor: string; confirm: boolean },
) {
  registry(input.env)
  const m = await getCandidatureMail(input.db, input.id)
  if (
    m.source !== 'interactive_decision' ||
    m.kind === 'ar' ||
    !input.confirm ||
    m.issuer !== input.actor ||
    input.previewHash !== m.preview_hash
  )
    return fail(409, 'La confirmation doit porter sur l’aperçu préparé par cette personne.')
  if (m.state !== 'draft') return m // idempotent confirmation, never another event
  if (!m.expires_at || now() > m.expires_at)
    return fail(409, 'Le brouillon a expiré. Aucun envoi n’a été demandé.')
  const template = decisionTemplate(input.env.CANDIDATURE_DECISION_TEMPLATES, m.kind)
  const d = await readDossier(input.token, m.participation_id)
  const payload = renderDecision(template, {
    school: String(d.school.nom),
    cohort: String(d.cohort.nom ?? `${d.cohort.annee_debut}–${d.cohort.annee_fin}`),
    email: String(d.school.referent_email),
  })
  const hash = await mailHash([
    m.id,
    m.kind,
    m.participation_id,
    d.part.etablissements_id,
    d.part.cohortes_id,
    payload,
    template,
  ])
  if (!template.approvalRef || hash !== m.preview_hash)
    return fail(
      409,
      'Le contenu ou les coordonnées ont changé, ou le modèle n’est pas validé. Préparez un nouvel aperçu.',
    )
  if (d.code !== target(m.kind))
    return fail(
      409,
      'La décision explicite doit d’abord être enregistrée dans le dossier et relue.',
    )
  const timestamp = now()
  await input.db
    .prepare(
      `UPDATE candidature_mails SET state='queued',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=? AND state='draft' AND expires_at>=?`,
    )
    .bind(timestamp, input.actor, timestamp, m.id, timestamp)
    .run()
  return getCandidatureMail(input.db, m.id)
}
export async function cancelDecisionDraft(db: SubmissionDatabase, id: string, actor: string) {
  const result = await db
    .prepare(
      `UPDATE candidature_mails SET state='cancelled',updated_at=? WHERE id=? AND state='draft' AND issuer=?`,
    )
    .bind(now(), id, actor)
    .run()
  if (result.meta.changes !== 1)
    return fail(409, 'Seul un brouillon non envoyé peut être annulé ici.')
}
async function validateDispatch(ctx: Context, m: MailRow) {
  const payload = validatePayload(JSON.parse(m.payload))
  const d = await readDossier(ctx.token, m.participation_id)
  if (
    d.part.etablissements_id !== m.school_id ||
    d.part.cohortes_id !== m.cohort_id ||
    String(d.school.referent_email).trim().toLowerCase() !== payload.to
  )
    return fail(409, 'Les coordonnées ou liens ont changé : vérification requise.')
  if (m.kind === 'ar') {
    const receipt = await ctx.db
      .prepare(
        'SELECT state,phase,record_id,parent_id,cohort_id FROM form_submissions WHERE submission_key=?',
      )
      .bind(m.submission_key)
      .first<{
        state: string
        phase: string
        record_id: number
        parent_id: number
        cohort_id: number
      }>()
    if (
      !receipt ||
      receipt.state !== 'complete' ||
      receipt.phase !== 'saved' ||
      receipt.record_id !== m.participation_id ||
      receipt.parent_id !== m.school_id ||
      receipt.cohort_id !== m.cohort_id ||
      d.code !== 'Candidature recue'
    )
      return fail(409, 'Le dépôt doit être vérifié avant son accusé.')
  } else {
    if (!m.confirmed_at || !m.approval_ref || d.code !== target(m.kind))
      return fail(409, 'La décision ne correspond plus à cet email.')
    const template = decisionTemplate(ctx.env.CANDIDATURE_DECISION_TEMPLATES, m.kind)
    const rendered = renderDecision(template, {
      school: String(d.school.nom),
      cohort: String(d.cohort.nom ?? `${d.cohort.annee_debut}–${d.cohort.annee_fin}`),
      email: payload.to,
    })
    if (
      template.version !== m.template_version ||
      template.approvalRef !== m.approval_ref ||
      JSON.stringify(rendered) !== m.payload
    )
      return fail(409, 'Le modèle a changé depuis la confirmation.')
  }
  return payload
}
/** One conditional claim per attempt, persisted BEFORE POST. No lease expiry
 * or automatic retry after a timeout, HTTP 5xx, bad response or lost DB write. */
export async function dispatchCandidatureMail(ctx: Context & { id: string }) {
  registry(ctx.env)
  if (ctx.env.CANDIDATURE_MAIL_SEND_ENABLED !== 'true' || ctx.env.CANDIDATURE_MAIL_OWNER !== 'site')
    return fail(503, 'Envoi désactivé : le propriétaire unique du circuit doit être confirmé.')
  if (!ctx.env.BREVO_API_KEY) return fail(503, 'Le transport email n’est pas configuré.')
  const m = await getCandidatureMail(ctx.db, ctx.id)
  if (m.state !== 'queued') return m
  if (m.kind !== 'ar' && ctx.env.CANDIDATURE_DECISION_SEND_ENABLED !== 'true') return fail(503, 'Les emails de décision ne sont pas activés ; les accusés ont un périmètre distinct.')
  const payload = await validateDispatch(ctx, m)
  const attempt = crypto.randomUUID(),
    started = now()
  const claim = await ctx.db
    .prepare(
      `UPDATE candidature_mails SET state='sending',attempt_id=?,attempt_started_at=?,updated_at=?,last_error=NULL WHERE id=? AND state='queued' RETURNING id`,
    )
    .bind(attempt, started, started, m.id)
    .first<{ id: string }>()
  if (claim?.id !== m.id) return getCandidatureMail(ctx.db, m.id)
  let state = 'uncertain',
    error: string | null = 'provider_unknown',
    messageId: string | null = null,
    status: number | null = null
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': ctx.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'EUNEOS', email: ctx.env.BREVO_SENDER_EMAIL ?? 'wiseup@euneos.fr' },
        to: [{ email: payload.to }],
        subject: payload.subject,
        textContent: payload.text,
        tags: [`candidate-${attempt}`],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    status = response.status
    if (response.ok) {
      const body = await response.json()
      if (
        typeof body.messageId === 'string' &&
        body.messageId.trim() &&
        body.messageId.length <= 512
      ) {
        messageId = body.messageId
        state = 'accepted'
        error = null
      }
    } else if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
      state = 'rejected'
      error = `provider_${response.status}`
    }
  } catch {
    /* Secret, body and recipient are never logged. Unknown means do not resend. */
  }
  // If either write fails, the durable sending claim remains non-retryable.
  await ctx.db
    .prepare('UPDATE candidature_mail_attempts SET state=?,http_status=?,message_id=? WHERE id=?')
    .bind(state, status, messageId, attempt)
    .run()
  await ctx.db
    .prepare(
      `UPDATE candidature_mails SET state=?,message_id=?,last_error=?,updated_at=? WHERE id=? AND attempt_id=? AND state='sending'`,
    )
    .bind(state, messageId, error, now(), m.id, attempt)
    .run()
  return getCandidatureMail(ctx.db, m.id)
}
export async function retryRejectedMail(db: SubmissionDatabase, id: string) {
  const result = await db
    .prepare(
      `UPDATE candidature_mails SET state='queued',updated_at=? WHERE id=? AND state='rejected' AND message_id IS NULL`,
    )
    .bind(now(), id)
    .run()
  if (result.meta.changes !== 1)
    return fail(
      409,
      'Seul un rejet explicite du fournisseur peut être remis en attente. Un envoi incertain doit être rapproché.',
    )
  return getCandidatureMail(db, id)
}
/** Authenticated provider GET only. Positive evidence can reconcile an unknown
 * attempt; a missing event NEVER grants permission to resend. */
export async function reconcileCandidatureMail(ctx: Context & { id: string }) {
  const m = await getCandidatureMail(ctx.db, ctx.id)
  if (
    !['sending', 'uncertain', 'accepted'].includes(m.state) ||
    !ctx.env.BREVO_API_KEY ||
    !m.attempt_id ||
    !m.attempt_started_at
  )
    return fail(409, 'Aucune tentative fournisseur à vérifier.')
  const payload: MailPayload = JSON.parse(m.payload),
    tag = `candidate-${m.attempt_id}`
  const events: Record<string, unknown>[] = []
  let complete = false
  for (let offset = 0; offset < 1000; offset += 100) {
    const q = new URLSearchParams({
      limit: '100',
      offset: String(offset),
      email: payload.to,
      startDate: m.attempt_started_at.slice(0, 10),
      endDate: now().slice(0, 10),
      tags: JSON.stringify([tag]),
    })
    if (m.message_id) q.set('messageId', m.message_id)
    const response = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${q}`, {
      headers: { 'api-key': ctx.env.BREVO_API_KEY },
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return fail(503, 'Lecture des événements Brevo indisponible.')
    const data = await response.json()
    if (!Array.isArray(data.events)) return fail(503, 'Réponse fournisseur invalide.')
    events.push(...data.events)
    if (data.events.length < 100) {
      complete = true
      break
    }
  }
  if (!complete) return fail(409, 'Trop d’événements : rapprochement manuel requis.')
  const matched = events.filter(
    (e) =>
      e.email === payload.to &&
      e.tag === tag &&
      typeof e.messageId === 'string' &&
      typeof e.date === 'string' &&
      Number.isFinite(Date.parse(e.date)) &&
      Date.parse(e.date) >= Date.parse(m.attempt_started_at!) - 5000 &&
      Date.parse(e.date) <= Date.now() + 60000 &&
      (!m.message_id || e.messageId === m.message_id),
  )
  const ids = new Set(matched.map((e) => String(e.messageId)))
  if (ids.size > 1)
    return fail(409, 'Plusieurs messages fournisseur pour cette tentative : vérification requise.')
  const recognized = matched.filter((e) =>
    [
      'requests',
      'request',
      'delivered',
      'hardBounce',
      'softBounce',
      'blocked',
      'invalid',
      'error',
      'deferred',
    ].includes(String(e.event)),
  )
  if (!recognized.length) return { mail: m, evidence: 'not_found' }
  const messageId = String(recognized[0].messageId)
  for (const e of recognized) {
    const key = await mailHash([m.id, messageId, e.event, e.date])
    await ctx.db
      .prepare(
        `INSERT INTO candidature_mail_events(event_key,mail_id,message_id,event,occurred_at,observed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING`,
      )
      .bind(key, m.id, messageId, String(e.event), new Date(String(e.date)).toISOString(), now())
      .run()
  }
  const latest = await ctx.db
    .prepare(
      `SELECT event FROM candidature_mail_events WHERE mail_id=? ORDER BY occurred_at DESC,event DESC LIMIT 1`,
    )
    .bind(m.id)
    .first<{ event: string }>()
  await ctx.db
    .prepare(
      `UPDATE candidature_mails SET state='accepted',message_id=?,provider_state=?,last_error=NULL,updated_at=? WHERE id=? AND attempt_id=? AND state IN ('sending','uncertain','accepted')`,
    )
    .bind(messageId, latest!.event, now(), m.id, m.attempt_id)
    .run()
  await ctx.db
    .prepare(
      `UPDATE candidature_mail_attempts SET state='accepted',message_id=? WHERE id=? AND state IN ('sending','uncertain','accepted')`,
    )
    .bind(messageId, m.attempt_id)
    .run()
  return { mail: await getCandidatureMail(ctx.db, m.id), evidence: 'provider_observed' }
}
