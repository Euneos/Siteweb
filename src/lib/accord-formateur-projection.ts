import type { SubmissionDatabase } from './candidature-store'
import { internalEnvironment } from './internal-context'
import { hashOperational, operationalRequest } from './operational-data'
import { OperationalLinkError } from './operational-links'
import {
  planGooglePerson,
  checkGooglePersonPlan,
  validatePersonConfig,
  type PersonPlan,
  type PersonProjectionConfig,
} from './google-form-person'
import { accordQuestions } from './accord-formateur-definition'
import { accordSignatureMatches, type AccordAnswers } from './accord-formateur'

const headers = ['receivedAt', ...accordQuestions.map((q) => q.key)]
const mapping = {
  timestamp: 'receivedAt',
  email: 'email',
  firstName: 'firstName',
  lastName: 'lastName',
  agreement: 'agreement',
  agreementDate: 'agreementDate',
}

/** Private configuration only. A dedicated copy of the audited personProjection
 * wins; otherwise reuse exactly one accord_formateur entry in shared SOURCES parts.
 * No guess based on a source label, active cohort or school year. */
export async function accordProjectionConfig(locals: unknown): Promise<PersonProjectionConfig> {
  try {
    const env = internalEnvironment(locals)
    let source: PersonProjectionConfig
    if (env.ACCORD_FORMATEUR_PERSON_PROJECTION !== undefined) {
      source = JSON.parse(String(env.ACCORD_FORMATEUR_PERSON_PROJECTION))
    } else {
      const sources: { personProjection?: PersonProjectionConfig }[] = []
      let gap = false
      for (let i = 1; i <= 12; i++) {
        const value = env[i === 1 ? 'SOURCES' : `SOURCES_${i}`]
        if (value === undefined) {
          gap = true
          continue
        }
        if (gap || typeof value !== 'string') throw new Error('Invalid source parts')
        const part = JSON.parse(value)
        if (!Array.isArray(part)) throw new Error('Invalid source part')
        sources.push(...part)
      }
      const matches = sources.filter((s) => s?.personProjection?.family === 'accord_formateur')
      if (matches.length !== 1) throw new Error('Ambiguous agreement configuration')
      source = matches[0].personProjection!
    }
    validatePersonConfig(source)
    if (
      source.family !== 'accord_formateur' ||
      source.businessFields ||
      source.fixedCohort !== null ||
      source.cohorts.length !== 1 ||
      source.cohorts[0].id !== null ||
      source.agreementAnswer !== 'Oui'
    )
      throw new Error('Invalid family')
    // Only the site's exact question selectors differ. Private identity mappings,
    // tables and explicit NULL cohort come from the audit.
    return {
      family: 'accord_formateur',
      tables: source.tables,
      cohorts: source.cohorts,
      fixedCohort: null,
      agreementAnswer: 'Oui',
      headerDigest: await hashOperational(JSON.stringify(headers)),
      mapping,
      captureOnly: headers.filter((h) => !Object.values(mapping).includes(h)),
    }
  } catch {
    throw new OperationalLinkError(
      503,
      'projection_configuration',
      'Ce formulaire est momentanément indisponible. Contactez l’équipe EUNEOS.',
    )
  }
}
export type AccordProjection = {
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
  journey_id: number | null
  agreement_date: string | null
}
export const readAccordProjection = (db: SubmissionDatabase, receipt: string) =>
  db
    .prepare('SELECT * FROM public_accord_projections WHERE receipt=?')
    .bind(receipt)
    .first<AccordProjection>()

export async function initializeAccordProjection(
  db: SubmissionDatabase,
  receipt: string,
  config: PersonProjectionConfig,
  payload: string,
) {
  const configDigest = await hashOperational(JSON.stringify(config))
  await db
    .prepare(
      'INSERT OR IGNORE INTO public_accord_projections(receipt,received_at,config_digest,payload) VALUES (?,?,?,?)',
    )
    .bind(receipt, new Date().toISOString(), configDigest, payload)
    .run()
  return (await readAccordProjection(db, receipt))!
}

/** Execute PR38's audited planner/checker with site-owned durable claims/states.
 * Only planning leases expire. A writing marker can ONLY be reconciled by reads,
 * never reclaimed for another write, even when the original process disappeared. */
export async function projectAccord(input: {
  db: SubmissionDatabase
  token: string
  receipt: string
  config: PersonProjectionConfig
  answers: AccordAnswers
}): Promise<AccordProjection> {
  const { db, token, receipt, config, answers } = input
  const read = (path: string) => operationalRequest(token, `/${path}`)
  let row = (await readAccordProjection(db, receipt))!
  if (row.state === 'complete' || row.state === 'review') return row
  const owner = crypto.randomUUID(),
    now = Date.now()
  const owned = await db
    .prepare(
      `UPDATE public_accord_projections SET owner=?,lease_until=?,state=CASE WHEN state='writing' THEN state ELSE 'planning' END
    WHERE receipt=? AND (state IN ('queued','retryable') OR (state IN ('planning','writing') AND lease_until<?))`,
    )
    .bind(owner, now + 60000, receipt, now)
    .run()
  if (owned.meta.changes !== 1) return row
  row = (await readAccordProjection(db, receipt))!
  let plan: PersonPlan | null = row.plan ? JSON.parse(row.plan) : null
  let writing = row.state === 'writing'
  const finish = async (state: string, code: string) => {
    const trainer = plan?.guard.find((g) => g.table === config.tables.people)
    await db
      .prepare(
        `UPDATE public_accord_projections SET state=?,code=?,plan=?,trainer_id=?,journey_id=?,agreement_date=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE receipt=? AND owner=?`,
      )
      .bind(
        state,
        code,
        plan ? JSON.stringify(plan) : null,
        state === 'complete' ? trainer!.id : null,
        state === 'complete' ? plan!.id : null,
        state === 'complete' ? String(plan!.after.date_accord) : null,
        receipt,
        owner,
      )
      .run()
    return (await readAccordProjection(db, receipt))!
  }
  try {
    if (row.config_digest !== (await hashOperational(JSON.stringify(config))))
      return finish('review', 'projection_configuration_changed')
    if (answers.agreement !== 'Oui') return finish('review', 'agreement_not_confirmed')
    if (!accordSignatureMatches(answers)) return finish('review', 'signature_identity_conflict')
    if (!plan) {
      const outcome = await planGooglePerson(
        config,
        headers,
        [row.received_at, ...accordQuestions.map((q) => answers[q.key])],
        row.received_at,
        read,
      )
      if (outcome.state === 'review') return finish('review', outcome.code)
      plan = outcome.plan
      // The only permitted projection is this respondent's explicit agreement.
      if (
        plan.family !== 'accord_formateur' ||
        plan.table !== config.tables.records ||
        plan.linkOnly ||
        !plan.guard.some((g) => g.table === config.tables.records) ||
        plan.create ||
        plan.after.accord_signe !== true ||
        typeof plan.after.date_accord !== 'string' ||
        Object.keys(plan.after).some((k) => !['accord_signe', 'date_accord'].includes(k))
      )
        return finish('review', 'projection_plan_invalid')
      const saved = await db
        .prepare(
          "UPDATE public_accord_projections SET plan=? WHERE receipt=? AND owner=? AND state='planning'",
        )
        .bind(JSON.stringify(plan), receipt, owner)
        .run()
      if (saved.meta.changes !== 1) return (await readAccordProjection(db, receipt))!
    }
    // Reserve the journey, not an email spelling or a guessed cohort.
    // An uncertain claimant retains ownership until a human verifies it.
    const identityKey = await hashOperational(`${plan.table}:${plan.id}`)
    await db
      .prepare('INSERT OR IGNORE INTO public_accord_claims(identity_key,receipt) VALUES (?,?)')
      .bind(identityKey, receipt)
      .run()
    const claim = await db
      .prepare('SELECT receipt FROM public_accord_claims WHERE identity_key=?')
      .bind(identityKey)
      .first<{ receipt: string }>()
    const actual = await checkGooglePersonPlan(plan, read)
    if (actual === 'after') return finish('complete', 'agreement_verified')
    if (writing) return finish('review', 'business_write_uncertain')
    if (claim?.receipt !== receipt) return finish('review', 'journey_already_claimed')
    if (actual !== 'before') return finish('review', 'existing_value_conflict')
    // Recheck uniqueness too: a second journey created after planning is ambiguous.
    const fresh = await planGooglePerson(
      config,
      headers,
      [row.received_at, ...accordQuestions.map((q) => answers[q.key])],
      row.received_at,
      read,
    )
    if (fresh.state !== 'planned' || JSON.stringify(fresh.plan) !== JSON.stringify(plan))
      return finish('review', 'identity_or_value_changed')
    // Fencing token after all prechecks: an expired planning worker cannot write
    // once a new owner has resumed the receipt.
    const marked = await db
      .prepare(
        `UPDATE public_accord_projections SET state='writing',code='business_write_pending',plan=?,lease_until=?
      WHERE receipt=? AND owner=? AND state='planning'`,
      )
      .bind(JSON.stringify(plan), Date.now() + 60000, receipt, owner)
      .run()
    if (marked.meta.changes !== 1) return (await readAccordProjection(db, receipt))!
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
      ? finish('complete', 'agreement_verified')
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
