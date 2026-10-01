import type { SubmissionDatabase } from './candidature-store'
import { hashOperational, operationalRequest } from './operational-data'
import { checkGooglePersonPlan } from './google-form-person'
import {
  planFinalQuestionnaire,
  type FinalConfig,
  type FinalPlan,
} from './final-questionnaire-plan'
import type { FinalQuestionnaireAnswers } from './final-questionnaire'

export type FinalProjection = {
  receipt: string
  received_at: string
  config_digest: string
  payload: string
  state: string
  code: string
  plan: string | null
  owner: string | null
  lease_until: number
  person_id: number | null
  participation_id: number | null
  target_id: number | null
  fields_json: string | null
}
export const readFinalProjection = (db: SubmissionDatabase, receipt: string) =>
  db
    .prepare('SELECT * FROM public_final_questionnaire_projections WHERE receipt=?')
    .bind(receipt)
    .first<FinalProjection>()

export async function initializeFinalProjection(
  db: SubmissionDatabase,
  receipt: string,
  config: FinalConfig,
  payload: string,
) {
  const configDigest = await hashOperational(JSON.stringify(config))
  await db
    .prepare(
      'INSERT OR IGNORE INTO public_final_questionnaire_projections(receipt,received_at,config_digest,payload) VALUES (?,?,?,?)',
    )
    .bind(receipt, new Date().toISOString(), configDigest, payload)
    .run()
  return (await readFinalProjection(db, receipt))!
}

/** Reuse PR38's plan checker with site-owned durable claims/states.
 * Only planning leases expire. A writing marker can ONLY be reconciled by reads,
 * never reclaimed for another write, even when the original process disappeared. */
export async function projectFinal(input: {
  db: SubmissionDatabase
  token: string
  receipt: string
  config: FinalConfig
  answers: FinalQuestionnaireAnswers
}): Promise<FinalProjection> {
  const { db, token, receipt, config, answers } = input
  const read = (path: string) => operationalRequest(token, `/${path}`)
  let row = (await readFinalProjection(db, receipt))!
  if (row.state === 'complete' || row.state === 'review') return row
  const owner = crypto.randomUUID(),
    now = Date.now()
  const owned = await db
    .prepare(
      `UPDATE public_final_questionnaire_projections SET owner=?,lease_until=?,state=CASE WHEN state='writing' THEN state ELSE 'planning' END
    WHERE receipt=? AND (state IN ('queued','retryable') OR (state IN ('planning','writing') AND lease_until<?))`,
    )
    .bind(owner, now + 60000, receipt, now)
    .run()
  if (owned.meta.changes !== 1) return row
  row = (await readFinalProjection(db, receipt))!
  let plan: FinalPlan | null = row.plan ? JSON.parse(row.plan) : null
  let writing = row.state === 'writing'
  const finish = async (state: string, code: string) => {
    await db
      .prepare(
        `UPDATE public_final_questionnaire_projections SET state=?,code=?,plan=?,person_id=?,participation_id=?,target_id=?,fields_json=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE receipt=? AND owner=?`,
      )
      .bind(
        state,
        code,
        plan ? JSON.stringify(plan) : null,
        state === 'complete' ? plan!.personId : null,
        state === 'complete' ? plan!.participationId : null,
        state === 'complete' ? plan!.id : null,
        state === 'complete' ? JSON.stringify(plan!.after) : null,
        receipt,
        owner,
      )
      .run()
    return (await readFinalProjection(db, receipt))!
  }
  try {
    if (row.config_digest !== (await hashOperational(JSON.stringify(config))))
      return finish('review', 'projection_configuration_changed')
    if (!plan) {
      const outcome = await planFinalQuestionnaire(config, answers, row.received_at, read)
      if (outcome.state === 'review') return finish('review', outcome.code)
      plan = outcome.plan
      const saved = await db
        .prepare(
          "UPDATE public_final_questionnaire_projections SET plan=? WHERE receipt=? AND owner=? AND state='planning'",
        )
        .bind(JSON.stringify(plan), receipt, owner)
        .run()
      if (saved.meta.changes !== 1) return (await readFinalProjection(db, receipt))!
    }
    // Reserve the exact receipt field of the confirmed entity.
    // An uncertain claimant retains ownership until a human verifies it.
    const identityKey = await hashOperational(`${plan.table}:${plan.id}:${config.receipt.field}`)
    await db
      .prepare(
        'INSERT OR IGNORE INTO public_final_questionnaire_claims(identity_key,receipt) VALUES (?,?)',
      )
      .bind(identityKey, receipt)
      .run()
    const claim = await db
      .prepare('SELECT receipt FROM public_final_questionnaire_claims WHERE identity_key=?')
      .bind(identityKey)
      .first<{ receipt: string }>()
    const actual = await checkGooglePersonPlan(plan, read)
    const verified = async () => {
      const fresh = await planFinalQuestionnaire(config, answers, row.received_at, read)
      if (
        fresh.state !== 'planned' ||
        fresh.plan.id !== plan!.id ||
        fresh.plan.participationId !== plan!.participationId ||
        fresh.plan.personId !== plan!.personId ||
        JSON.stringify(fresh.plan.guard) !== JSON.stringify(plan!.guard)
      )
        return finish('review', 'identity_or_value_changed')
      return finish(
        'complete',
        plan!.reasons.length ? 'receipt_verified_partial' : 'receipt_fields_verified',
      )
    }
    if (actual === 'after') return await verified()

    if (writing) return finish('review', 'business_write_uncertain')
    if (claim?.receipt !== receipt) return finish('review', 'receipt_already_claimed')
    if (actual !== 'before') return finish('review', 'existing_value_conflict')
    // Recheck uniqueness immediately before writing; no guessed or changed identity.
    const fresh = await planFinalQuestionnaire(config, answers, row.received_at, read)
    if (fresh.state !== 'planned' || JSON.stringify(fresh.plan) !== JSON.stringify(plan))
      return finish('review', 'identity_or_value_changed')
    // Fencing token after all prechecks: an expired planning worker cannot write
    // once a new owner has resumed the receipt.
    const marked = await db
      .prepare(
        `UPDATE public_final_questionnaire_projections SET state='writing',code='business_write_pending',plan=?,lease_until=?
      WHERE receipt=? AND owner=? AND state='planning'`,
      )
      .bind(JSON.stringify(plan), Date.now() + 60000, receipt, owner)
      .run()
    if (marked.meta.changes !== 1) return (await readFinalProjection(db, receipt))!
    writing = true
    try {
      await operationalRequest(token, `/tables/${plan.table}/records`, 'PATCH', [
        {
          Id: plan.id,
          ...Object.fromEntries(
            Object.entries(plan.after).filter(
              ([key, value]) => JSON.stringify(value) !== JSON.stringify(plan!.before[key]),
            ),
          ),
        },
      ])
    } catch {
      /* Only readback may resolve an uncertain write. Never replay it. */
    }
    const after = await checkGooglePersonPlan(plan, read)
    return after === 'after' ? await verified() : finish('review', 'business_write_uncertain')
  } catch (error) {
    const code =
      error instanceof Error && /^(person_|sheet_|identity_)[a-z_]+$/.test(error.message)
        ? error.message
        : writing
          ? 'business_write_uncertain'
          : 'projection_read_unavailable'
    return finish(
      writing ? 'writing' : code === 'projection_read_unavailable' ? 'retryable' : 'review',
      code,
    )
  }
}

export async function requireFinalRegistry(db: SubmissionDatabase) {
  await db
    .prepare('SELECT receipt FROM public_final_questionnaire_projections LIMIT 1')
    .bind()
    .first()
  await db.prepare('SELECT receipt FROM public_final_questionnaire_claims LIMIT 1').bind().first()
}
