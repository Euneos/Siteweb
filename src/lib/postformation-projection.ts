import type { SubmissionDatabase } from './candidature-store'
import { internalEnvironment } from './internal-context'
import { hashOperational, operationalRequest } from './operational-data'
import { OperationalLinkError } from './operational-links'
import {
  planGooglePerson,
  checkGooglePersonPlan,
  validatePersonConfig,
  type PersonProjectionConfig,
  type PersonPlan,
} from './google-form-person'
import type { PostformationDefinition } from './postformation-definition'
import type { PostformationAnswers } from './postformation'

const headers = ['receivedAt', 'name', 'email', 'school', 'year']
const mapping = {
  timestamp: 'receivedAt',
  name: 'name',
  email: 'email',
  establishment: 'school',
  cohort: 'year',
}

/** Private audited cohort/establishment aliases only. Never infer current year or
 * link an adult merely because their name resembles a respondent. */
export async function postformationProjectionConfig(
  locals: unknown,
  def: PostformationDefinition,
): Promise<PersonProjectionConfig> {
  try {
    const env = internalEnvironment(locals)
    const dedicated =
      env[
        def.family === 'postformation_b'
          ? 'POST_FORMATION_PERSON_PROJECTION'
          : 'SUIVI_J45_PERSON_PROJECTION'
      ]
    let source: PersonProjectionConfig
    if (dedicated !== undefined) source = JSON.parse(String(dedicated))
    else {
      const sources: { personProjection?: PersonProjectionConfig }[] = []
      let gap = false
      for (let i = 1; i <= 12; i++) {
        const part = env[i === 1 ? 'SOURCES' : `SOURCES_${i}`]
        if (part === undefined) {
          gap = true
          continue
        }
        if (gap || typeof part !== 'string') throw new Error('Invalid source parts')
        const value = JSON.parse(part)
        if (!Array.isArray(value)) throw new Error('Invalid source part')
        sources.push(...value)
      }
      const matches = sources.filter((s) => s?.personProjection?.family === def.family)
      if (matches.length !== 1) throw new Error('Ambiguous projection')
      source = matches[0].personProjection!
    }
    validatePersonConfig(source)
    if (source.family !== def.family || source.createMissingAdults !== undefined)
      throw new Error('Invalid family')
    // The shared planner is used for identity/relations only. This endpoint has
    // its own exclusive date allowlist, not the source's business-field mapping.
    return {
      family: def.family,
      tables: source.tables,
      cohorts: source.cohorts,
      headerDigest: await hashOperational(JSON.stringify(headers)),
      mapping,
      captureOnly: [],
    }
  } catch {
    throw new OperationalLinkError(
      503,
      'projection_configuration',
      'Ce formulaire est momentanément indisponible. Contactez l’équipe EUNEOS.',
    )
  }
}

export type PostformationProjection = {
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
  received_date: string | null
}
export const readPostformationProjection = (db: SubmissionDatabase, receipt: string) =>
  db
    .prepare('SELECT * FROM public_postformation_projections WHERE receipt=?')
    .bind(receipt)
    .first<PostformationProjection>()
export async function initializePostformationProjection(
  db: SubmissionDatabase,
  receipt: string,
  config: PersonProjectionConfig,
) {
  await db
    .prepare(
      'INSERT OR IGNORE INTO public_postformation_projections(receipt,received_at,config_digest) VALUES (?,?,?)',
    )
    .bind(receipt, new Date().toISOString(), await hashOperational(JSON.stringify(config)))
    .run()
  return (await readPostformationProjection(db, receipt))!
}

/** No adult creation, status change or questionnaire answer written to adults.
 * A write with uncertain outcome is reconciled only by reads, never repeated. */
export async function projectPostformation(input: {
  db: SubmissionDatabase
  token: string
  receipt: string
  config: PersonProjectionConfig
  definition: PostformationDefinition
  answers: PostformationAnswers
}): Promise<PostformationProjection> {
  const { db, token, receipt, config, definition: def, answers } = input
  const read = (path: string) => operationalRequest(token, `/${path}`)
  let row = (await readPostformationProjection(db, receipt))!
  if (row.state === 'complete' || row.state === 'review') return row
  const owner = crypto.randomUUID(),
    now = Date.now()
  const owned = await db
    .prepare(
      `UPDATE public_postformation_projections SET owner=?,lease_until=?,state=CASE WHEN state='writing' THEN state ELSE 'planning' END
    WHERE receipt=? AND (state IN ('queued','retryable') OR (state IN ('planning','writing') AND lease_until<?))`,
    )
    .bind(owner, now + 60000, receipt, now)
    .run()
  if (owned.meta.changes !== 1) return row
  row = (await readPostformationProjection(db, receipt))!
  let plan: PersonPlan | null = row.plan ? JSON.parse(row.plan) : null
  let writing = row.state === 'writing'
  const finish = async (state: string, code: string) => {
    const dossier = plan?.guard.find((g) => g.table === config.tables.records)
    await db
      .prepare(
        `UPDATE public_postformation_projections SET state=?,code=?,plan=?,adult_id=?,participation_id=?,received_date=?,lease_until=0 WHERE receipt=? AND owner=?`,
      )
      .bind(
        state,
        code,
        plan ? JSON.stringify(plan) : null,
        state === 'complete' ? plan!.id : null,
        state === 'complete' ? dossier!.id : null,
        state === 'complete' ? String(plan!.after[def.dateField]) : null,
        receipt,
        owner,
      )
      .run()
    return (await readPostformationProjection(db, receipt))!
  }
  try {
    if (row.config_digest !== (await hashOperational(JSON.stringify(config))))
      return finish('review', 'projection_configuration_changed')
    if (!plan) {
      const outcome = await planGooglePerson(
        config,
        headers,
        [row.received_at, ...['name', 'email', 'school', 'year'].map((k) => String(answers[k]))],
        row.received_at,
        read,
      )
      if (outcome.state === 'review') return finish('review', outcome.code)
      plan = outcome.plan
      if (
        plan.family !== def.family ||
        plan.table !== config.tables.people ||
        plan.create ||
        !plan.linkOnly ||
        !plan.guard.some((g) => g.table === config.tables.records) ||
        Object.keys(plan.after).length
      )
        return finish('review', 'projection_plan_invalid')
      const adult = (await read(`tables/${plan.table}/records/${plan.id}`)) as Record<
        string,
        unknown
      >
      // The field must actually exist in the private schema response. Missing
      // metadata/columns fail closed rather than inventing a field silently.
      if (adult.Id !== plan.id || !Object.hasOwn(adult, def.dateField))
        return finish('review', 'receipt_field_unavailable')
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(row.received_at))
      const previous = adult[def.dateField]
      if (previous !== null && previous !== '' && previous !== date)
        return finish('review', 'existing_value_conflict')
      plan.before = { [def.dateField]: previous }
      plan.after = { [def.dateField]: date }
      plan.linkOnly = false
      const saved = await db
        .prepare(
          "UPDATE public_postformation_projections SET plan=? WHERE receipt=? AND owner=? AND state='planning'",
        )
        .bind(JSON.stringify(plan), receipt, owner)
        .run()
      if (saved.meta.changes !== 1) return (await readPostformationProjection(db, receipt))!
    }
    // Revalidate the persisted plan as well as a freshly planned one.
    if (
      plan.create ||
      plan.family !== def.family ||
      plan.table !== config.tables.people ||
      Object.keys(plan.after).join() !== def.dateField ||
      Object.keys(plan.before).join() !== def.dateField ||
      !plan.guard.some((g) => g.table === config.tables.records)
    )
      return finish('review', 'projection_plan_invalid')
    const identityKey = await hashOperational(`${plan.table}:${plan.id}:${def.dateField}`)
    await db
      .prepare(
        'INSERT OR IGNORE INTO public_postformation_claims(identity_key,receipt) VALUES (?,?)',
      )
      .bind(identityKey, receipt)
      .run()
    const claim = await db
      .prepare('SELECT receipt FROM public_postformation_claims WHERE identity_key=?')
      .bind(identityKey)
      .first<{ receipt: string }>()
    const before = await checkGooglePersonPlan(plan, read)
    if (before === 'after') return finish('complete', 'adult_receipt_verified')
    if (writing) return finish('review', 'business_write_uncertain')
    if (claim?.receipt !== receipt) return finish('review', 'receipt_already_claimed')
    if (before !== 'before') return finish('review', 'existing_value_conflict')
    const marked = await db
      .prepare(
        "UPDATE public_postformation_projections SET state='writing',code='business_write_pending',lease_until=? WHERE receipt=? AND owner=? AND state='planning'",
      )
      .bind(Date.now() + 60000, receipt, owner)
      .run()
    if (marked.meta.changes !== 1) return (await readPostformationProjection(db, receipt))!
    writing = true
    try {
      await operationalRequest(token, `/tables/${plan.table}/records`, 'PATCH', [
        { Id: plan.id, ...plan.after },
      ])
    } catch {
      /* Only the following read can confirm a lost write response. */
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
