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
import { preformationQuestions } from './preformation-definition'
import type { PreformationAnswers } from './preformation'

const headers = ['receivedAt', ...preformationQuestions.map((q) => q.key)]
const mapping = {
  timestamp: 'receivedAt',
  email: 'email',
  name: 'name',
  cohort: 'year',
  establishment: 'school',
}

/** Private configuration only. A dedicated copy of the audited personProjection
 * wins; otherwise reuse exactly one preformation_a entry in shared SOURCES parts.
 * No guess based on a source label, active cohort or public school directory. */
export async function preformationProjectionConfig(
  locals: unknown,
): Promise<PersonProjectionConfig> {
  try {
    const env = internalEnvironment(locals)
    let source: PersonProjectionConfig
    if (env.PRE_FORMATION_PERSON_PROJECTION !== undefined) {
      source = JSON.parse(String(env.PRE_FORMATION_PERSON_PROJECTION))
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
      const matches = sources.filter((s) => s?.personProjection?.family === 'preformation_a')
      if (matches.length !== 1) throw new Error('Ambiguous preformation configuration')
      source = matches[0].personProjection!
    }
    validatePersonConfig(source)
    if (source.family !== 'preformation_a' || source.businessFields)
      throw new Error('Invalid family')
    // Only the site's exact question selectors differ. Private identity mappings,
    // tables, cohort aliases and explicit creation policy come from the audit.
    return {
      family: 'preformation_a',
      tables: source.tables,
      cohorts: source.cohorts,
      createMissingAdults: source.createMissingAdults ?? false,
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
export type PreformationProjection = {
  receipt: string
  received_at: string
  config_digest: string
  state: string
  code: string
  plan: string | null
  owner: string | null
  lease_until: number
  adult_id: number | null
  participation_id: number | null
  date_pre: string | null
}
export const readPreformationProjection = (db: SubmissionDatabase, receipt: string) =>
  db
    .prepare('SELECT * FROM public_preformation_projections WHERE receipt=?')
    .bind(receipt)
    .first<PreformationProjection>()

export async function initializePreformationProjection(
  db: SubmissionDatabase,
  receipt: string,
  config: PersonProjectionConfig,
) {
  const configDigest = await hashOperational(JSON.stringify(config))
  await db
    .prepare(
      'INSERT OR IGNORE INTO public_preformation_projections(receipt,received_at,config_digest) VALUES (?,?,?)',
    )
    .bind(receipt, new Date().toISOString(), configDigest)
    .run()
  return (await readPreformationProjection(db, receipt))!
}

/** Execute PR38's audited planner/checker with site-owned durable claims/states.
 * Only planning leases expire. A writing marker can ONLY be reconciled by reads,
 * never reclaimed for another write, even when the original process disappeared. */
export async function projectPreformation(input: {
  db: SubmissionDatabase
  token: string
  receipt: string
  config: PersonProjectionConfig
  answers: PreformationAnswers
}): Promise<PreformationProjection> {
  const { db, token, receipt, config, answers } = input
  const read = (path: string) => operationalRequest(token, `/${path}`)
  let row = (await readPreformationProjection(db, receipt))!
  if (row.state === 'complete' || row.state === 'review') return row
  const owner = crypto.randomUUID(),
    now = Date.now()
  const owned = await db
    .prepare(
      `UPDATE public_preformation_projections SET owner=?,lease_until=?,state=CASE WHEN state='writing' THEN state ELSE 'planning' END
    WHERE receipt=? AND (state IN ('queued','retryable') OR (state IN ('planning','writing') AND lease_until<?))`,
    )
    .bind(owner, now + 60000, receipt, now)
    .run()
  if (owned.meta.changes !== 1) return row
  row = (await readPreformationProjection(db, receipt))!
  let plan: PersonPlan | null = row.plan ? JSON.parse(row.plan) : null
  let writing = row.state === 'writing'
  const finish = async (state: string, code: string) => {
    const record = plan?.guard.find((g) => g.table === config.tables.records)
    await db
      .prepare(
        `UPDATE public_preformation_projections SET state=?,code=?,plan=?,adult_id=?,participation_id=?,date_pre=?,lease_until=0,updated_at=CURRENT_TIMESTAMP
      WHERE receipt=? AND owner=?`,
      )
      .bind(
        state,
        code,
        plan ? JSON.stringify(plan) : null,
        state === 'complete' ? plan!.id : null,
        state === 'complete' ? record!.id : null,
        state === 'complete' ? String(plan!.after.date_pre_recu) : null,
        receipt,
        owner,
      )
      .run()
    return (await readPreformationProjection(db, receipt))!
  }
  try {
    if (row.config_digest !== (await hashOperational(JSON.stringify(config))))
      return finish('review', 'projection_configuration_changed')
    if (!plan) {
      const outcome = await planGooglePerson(
        config,
        headers,
        [row.received_at, ...preformationQuestions.map((q) => answers[q.key])],
        row.received_at,
        read,
      )
      if (outcome.state === 'review') return finish('review', outcome.code)
      plan = outcome.plan
      // Belt and braces: this route may only record preformation receipt, with
      // missing-person creation allowed by an explicit audited private policy.
      if (
        plan.family !== 'preformation_a' ||
        plan.table !== config.tables.people ||
        plan.linkOnly ||
        !plan.guard.some((g) => g.table === config.tables.records) ||
        !plan.after.date_pre_recu
      )
        return finish('review', 'projection_plan_invalid')
      const saved = await db
        .prepare(
          "UPDATE public_preformation_projections SET plan=? WHERE receipt=? AND owner=? AND state='planning'",
        )
        .bind(JSON.stringify(plan), receipt, owner)
        .run()
      if (saved.meta.changes !== 1) return (await readPreformationProjection(db, receipt))!
    }
    const record = plan.guard.find((g) => g.table === config.tables.records)!
    // One identity key for both creation and update, across all distinct site
    // answers. An uncertain claimant keeps ownership until a human verifies it.
    const identityKey = await hashOperational(`${plan.table}:${record.id}:${answers.email}`)
    await db
      .prepare(
        'INSERT OR IGNORE INTO public_preformation_person_claims(identity_key,receipt) VALUES (?,?)',
      )
      .bind(identityKey, receipt)
      .run()
    const claim = await db
      .prepare('SELECT receipt FROM public_preformation_person_claims WHERE identity_key=?')
      .bind(identityKey)
      .first<{ receipt: string }>()
    const actual = await checkGooglePersonPlan(plan, read)
    if (actual === 'after') return finish('complete', 'adult_receipt_verified')
    if (writing) return finish('review', 'business_write_uncertain')
    if (claim?.receipt !== receipt) return finish('review', 'person_creation_already_claimed')
    if (actual !== 'before') return finish('review', 'existing_value_conflict')
    // Fencing token after all prechecks: an expired planning worker cannot write
    // once a new owner has resumed the receipt.
    const marked = await db
      .prepare(
        `UPDATE public_preformation_projections SET state='writing',code='business_write_pending',plan=?,lease_until=?
      WHERE receipt=? AND owner=? AND state='planning'`,
      )
      .bind(JSON.stringify(plan), Date.now() + 60000, receipt, owner)
      .run()
    if (marked.meta.changes !== 1) return (await readPreformationProjection(db, receipt))!
    writing = true
    try {
      await operationalRequest(
        token,
        `/tables/${plan.table}/records`,
        plan.create ? 'POST' : 'PATCH',
        [{ ...(plan.create ? {} : { Id: plan.id }), ...plan.after }],
      )
    } catch {
      /* Only readback may resolve an uncertain write. Never replay it. */
    }
    const after = await checkGooglePersonPlan(plan, read)
    return after === 'after'
      ? finish('complete', 'adult_receipt_verified')
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

const reasons: Record<string, string> = {
  identity_unresolved: 'Adulte non identifié ; création non autorisée par la configuration.',
  identity_conflict: 'Le nom et l’identité retrouvée ne concordent pas.',
  identity_not_unique: 'Plusieurs personnes possibles ou inventaire incomplet.',
  cohort_unresolved: 'Année scolaire non configurée.',
  establishment_unresolved: 'Établissement sans rattachement confirmé dans cette année.',
  cohort_conflict: 'Relation adulte, établissement ou cohorte à vérifier.',
  existing_value_conflict: 'Une valeur existante diffère ; elle a été conservée.',
  person_creation_already_claimed: 'Une autre réponse réserve déjà cette identité.',
  business_write_uncertain: 'Écriture incertaine ; vérifier la personne sans rejouer la création.',
  projection_configuration_changed:
    'Configuration modifiée depuis la réception ; vérifier le rattachement.',
  projection_read_unavailable: 'Lecture de la base indisponible ; réception métier à revérifier.',
  projection_pending: 'Réception métier en cours de vérification.',
  business_write_pending: 'Écriture en cours de vérification.',
}
export const preformationPendingReason = (code: string) =>
  reasons[code] ?? 'Réception métier à vérifier par l’équipe.'
