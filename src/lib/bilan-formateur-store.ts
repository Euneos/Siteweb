import type { SubmissionDatabase } from './candidature-store'
import { hashOperational, operationalRequest } from './operational-data'
import { checkGooglePersonPlan } from './google-form-person'
import { planBilan, type BilanConfig, type BilanPlan } from './bilan-formateur-plan'
import type { BilanAnswers } from './bilan-formateur'

export type BilanProjection = {
  receipt: string
  received_at: string
  config_digest: string
  payload: string
  state: string
  code: string
  plan: string | null
  owner: string | null
  lease_until: number
  trainer_id: number | null
  participation_id: number | null
  mission_id: number | null
  fields_json: string | null
}
export const readBilanProjection = (db: SubmissionDatabase, receipt: string) =>
  db
    .prepare('SELECT * FROM public_bilan_formateur_projections WHERE receipt=?')
    .bind(receipt)
    .first<BilanProjection>()

export async function initializeBilanProjection(
  db: SubmissionDatabase,
  receipt: string,
  config: BilanConfig,
  payload: string,
) {
  const configDigest = await hashOperational(JSON.stringify(config))
  await db
    .prepare(
      'INSERT OR IGNORE INTO public_bilan_formateur_projections(receipt,received_at,config_digest,payload) VALUES (?,?,?,?)',
    )
    .bind(receipt, new Date().toISOString(), configDigest, payload)
    .run()
  return (await readBilanProjection(db, receipt))!
}

/** Execute PR38's audited planner/checker with site-owned durable claims/states.
 * Only planning leases expire. A writing marker can ONLY be reconciled by reads,
 * never reclaimed for another write, even when the original process disappeared. */
export async function projectBilan(input: {
  db: SubmissionDatabase
  token: string
  receipt: string
  config: BilanConfig
  answers: BilanAnswers
}): Promise<BilanProjection> {
  const { db, token, receipt, config, answers } = input
  const read = (path: string) => operationalRequest(token, `/${path}`)
  let row = (await readBilanProjection(db, receipt))!
  if (row.state === 'complete' || row.state === 'review') return row
  const owner = crypto.randomUUID(),
    now = Date.now()
  const owned = await db
    .prepare(
      `UPDATE public_bilan_formateur_projections SET owner=?,lease_until=?,state=CASE WHEN state='writing' THEN state ELSE 'planning' END
    WHERE receipt=? AND (state IN ('queued','retryable') OR (state IN ('planning','writing') AND lease_until<?))`,
    )
    .bind(owner, now + 60000, receipt, now)
    .run()
  if (owned.meta.changes !== 1) return row
  row = (await readBilanProjection(db, receipt))!
  let plan: BilanPlan | null = row.plan ? JSON.parse(row.plan) : null
  let writing = row.state === 'writing'
  const finish = async (state: string, code: string) => {
    await db
      .prepare(
        `UPDATE public_bilan_formateur_projections SET state=?,code=?,plan=?,trainer_id=?,participation_id=?,mission_id=?,fields_json=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE receipt=? AND owner=?`,
      )
      .bind(
        state,
        code,
        plan ? JSON.stringify(plan) : null,
        state === 'complete' ? plan!.trainerId : null,
        state === 'complete' ? plan!.participationId : null,
        state === 'complete' ? plan!.id : null,
        state === 'complete' ? JSON.stringify(plan!.after) : null,
        receipt,
        owner,
      )
      .run()
    return (await readBilanProjection(db, receipt))!
  }
  try {
    if (row.config_digest !== (await hashOperational(JSON.stringify(config))))
      return finish('review', 'projection_configuration_changed')
    if (!plan) {
      const outcome = await planBilan(config, answers, read)
      if (outcome.state === 'review') return finish('review', outcome.code)
      plan = outcome.plan
      const saved = await db
        .prepare(
          "UPDATE public_bilan_formateur_projections SET plan=? WHERE receipt=? AND owner=? AND state='planning'",
        )
        .bind(JSON.stringify(plan), receipt, owner)
        .run()
      if (saved.meta.changes !== 1) return (await readBilanProjection(db, receipt))!
    }
    // Reserve the mission, not an email spelling or a guessed cohort.
    // An uncertain claimant retains ownership until a human verifies it.
    const identityKey = await hashOperational(`${plan.table}:${plan.id}`)
    await db
      .prepare(
        'INSERT OR IGNORE INTO public_bilan_formateur_claims(identity_key,receipt) VALUES (?,?)',
      )
      .bind(identityKey, receipt)
      .run()
    const claim = await db
      .prepare('SELECT receipt FROM public_bilan_formateur_claims WHERE identity_key=?')
      .bind(identityKey)
      .first<{ receipt: string }>()
    const actual = await checkGooglePersonPlan(plan, read)
    if (actual === 'after')
      return finish(
        'complete',
        Object.keys(plan.after).length ? 'mission_fields_verified' : 'mission_link_verified',
      )
    if (writing) return finish('review', 'business_write_uncertain')
    if (claim?.receipt !== receipt) return finish('review', 'mission_already_claimed')
    if (actual !== 'before') return finish('review', 'existing_value_conflict')
    // Recheck uniqueness too: a second mission created after planning is ambiguous.
    const fresh = await planBilan(config, answers, read)
    if (fresh.state !== 'planned' || JSON.stringify(fresh.plan) !== JSON.stringify(plan))
      return finish('review', 'identity_or_value_changed')
    // Fencing token after all prechecks: an expired planning worker cannot write
    // once a new owner has resumed the receipt.
    const marked = await db
      .prepare(
        `UPDATE public_bilan_formateur_projections SET state='writing',code='business_write_pending',plan=?,lease_until=?
      WHERE receipt=? AND owner=? AND state='planning'`,
      )
      .bind(JSON.stringify(plan), Date.now() + 60000, receipt, owner)
      .run()
    if (marked.meta.changes !== 1) return (await readBilanProjection(db, receipt))!
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
    return after === 'after'
      ? finish(
          'complete',
          Object.keys(plan.after).length ? 'mission_fields_verified' : 'mission_link_verified',
        )
      : finish('review', 'business_write_uncertain')
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
