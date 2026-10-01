import { digest } from './google-form-sync'
import { isoDate } from './google-form-contact'
import type { SheetHeader } from './google-form-sheet'

type Fields = Record<string, unknown>
type Row = Fields & { Id: number }
type Selector =
  | 'timestamp'
  | 'email'
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'cohort'
  | 'establishment'
  | 'agreement'
  | 'agreementDate'
export const PERSON_FAMILIES = [
  'preformation_a',
  'accord_formateur',
  'candidature_etablissement',
  'candidature_formateur',
  'postformation_b',
  'suivi_j45',
  'evaluation_formation',
  'bilan_etablissement',
  'bilan_formateur',
  'activites_jeunes',
] as const
const entityKind = (family: string) =>
  ['preformation_a', 'postformation_b', 'suivi_j45', 'evaluation_formation'].includes(family)
    ? 'adult'
    : ['candidature_etablissement', 'bilan_etablissement', 'activites_jeunes'].includes(family)
      ? 'school'
      : 'trainer'
export type PersonProjectionConfig = {
  family: (typeof PERSON_FAMILIES)[number]
  headerDigest: string
  mapping: Partial<Record<Selector, SheetHeader>>
  captureOnly: SheetHeader[]
  tables: { people: string; records: string }
  /** Cohort values are exact published answers, never guessed school years. */
  cohorts: {
    id: number | null
    answer?: string
    answers?: string[]
    establishments?: { answer: string; participationId: number; schoolId: number }[]
  }[]
  /** Agreements without a year question need an explicitly audited source scope. */
  fixedCohort?: number | null
  createMissingAdults?: boolean
  agreementAnswer?: string
}
export type PersonPlan = {
  family: PersonProjectionConfig['family']
  table: string
  id: number
  before: Fields
  after: Fields
  guard: { table: string; id: number; fields: Fields }[]
  remaining: boolean
  linkOnly?: boolean
  create?: { key: string }
}
export type PersonOutcome =
  { state: 'review'; code: string } | { state: 'planned'; plan: PersonPlan }
export type PersonRead = (path: string) => Promise<unknown>
const id = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const name = (v: unknown) => text(v).normalize('NFC').toLocaleLowerCase('fr').replace(/\s+/g, ' ')
const email = (v: unknown) => text(v).toLowerCase()
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const pick = (row: Fields, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))
const empty = (v: unknown) => v === null || v === undefined || v === ''
const review = (code: string): PersonOutcome => ({ state: 'review', code })
const selectors = new Set([
  'timestamp',
  'email',
  'name',
  'firstName',
  'lastName',
  'cohort',
  'establishment',
  'agreement',
  'agreementDate',
])
const cohortAnswers = (c: PersonProjectionConfig['cohorts'][number]) =>
  [c.answer, ...(c.answers ?? [])]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
const cohortId = (n: unknown, family: string) =>
  id(n) || (n === null && entityKind(family) === 'trainer')
export function validatePersonConfig(c: PersonProjectionConfig) {
  if (
    !c ||
    !PERSON_FAMILIES.includes(c.family) ||
    !/^[a-f0-9]{64}$/.test(c.headerDigest) ||
    !c.mapping ||
    !c.mapping.timestamp ||
    !c.mapping.email ||
    !(c.mapping.name || (c.mapping.firstName && c.mapping.lastName)) ||
    (c.mapping.name && (c.mapping.firstName || c.mapping.lastName)) ||
    Object.keys(c.mapping).some((k) => !selectors.has(k)) ||
    !c.tables ||
    Object.keys(c.tables).sort().join(',') !== 'people,records' ||
    !Object.values(c.tables).every((v) => /^[a-z0-9]{10,30}$/.test(v)) ||
    !Array.isArray(c.captureOnly) ||
    !Array.isArray(c.cohorts) ||
    !c.cohorts.length ||
    c.cohorts.some(
      (v) =>
        !cohortId(v.id, c.family) ||
        (v.answers !== undefined &&
          (!Array.isArray(v.answers) || v.answers.some((a) => typeof a !== 'string' || !a.trim()))),
    ) ||
    new Set(c.cohorts.map((v) => v.id)).size !== c.cohorts.length
  )
    throw new Error('person_configuration_invalid')
  if (
    c.createMissingAdults !== undefined &&
    (typeof c.createMissingAdults !== 'boolean' || c.family !== 'preformation_a')
  )
    throw new Error('person_configuration_invalid')
  if (
    entityKind(c.family) === 'adult' &&
    (!c.mapping.cohort ||
      !c.mapping.establishment ||
      c.fixedCohort !== undefined ||
      c.cohorts.some(
        (v) =>
          !cohortAnswers(v).length ||
          !v.establishments?.length ||
          v.establishments.some(
            (e) => !e.answer?.trim() || !id(e.participationId) || !id(e.schoolId),
          ) ||
          new Set(v.establishments.map((e) => e.answer.trim())).size !== v.establishments.length,
      ))
  )
    throw new Error('person_configuration_invalid')
  if (
    c.mapping.cohort &&
    (c.fixedCohort !== undefined ||
      c.cohorts.some((v) => !cohortAnswers(v).length) ||
      new Set(c.cohorts.flatMap(cohortAnswers)).size !== c.cohorts.flatMap(cohortAnswers).length)
  )
    throw new Error('person_configuration_invalid')
  if (
    !c.mapping.cohort &&
    (!cohortId(c.fixedCohort, c.family) ||
      c.cohorts.length !== 1 ||
      c.cohorts[0].id !== c.fixedCohort)
  )
    throw new Error('person_configuration_invalid')
  if (
    c.family === 'accord_formateur' &&
    (!c.mapping.agreement ||
      !c.mapping.agreementDate ||
      !c.agreementAnswer?.trim() ||
      (!c.mapping.cohort &&
        (!cohortId(c.fixedCohort, c.family) ||
          c.cohorts.length !== 1 ||
          c.cohorts[0].id !== c.fixedCohort)))
  )
    throw new Error('person_configuration_invalid')
}

/** Pure planning plus read-only, bounded exact NocoDB identity checks.
 * No person-name splitting, status derivation or mail. Unmapped headers fail closed. */
export async function planGooglePerson(
  config: PersonProjectionConfig,
  headers: string[],
  cells: string[],
  submittedAt: string,
  read: PersonRead,
): Promise<PersonOutcome> {
  validatePersonConfig(config)
  if (
    headers.length !== cells.length ||
    (await digest(JSON.stringify(headers))) !== config.headerDigest
  )
    return review('sheet_headers_changed')
  const used = new Set<number>()
  function column(selector: SheetHeader) {
    const label = typeof selector === 'string' ? selector : selector.label
    const indices = headers.flatMap((h, i) => (h.trim() === label.trim() ? [i] : []))
    if (indices.length === 0) throw new Error('person_mapping_missing')
    if (typeof selector === 'string' && indices.length !== 1)
      throw new Error('sheet_header_ambiguous')
    const index = typeof selector === 'string' ? indices[0] : indices[selector.occurrence - 1]
    if (
      index === undefined ||
      (typeof selector === 'object' &&
        ((indices.length > 1 && selector.column === undefined) ||
          (selector.column !== undefined && selector.column !== index + 1)))
    )
      throw new Error('sheet_header_position_invalid')
    if (used.has(index)) throw new Error('sheet_mapping_overlap')
    used.add(index)
    return text(cells[index])
  }
  const values = Object.fromEntries(
    Object.entries(config.mapping).map(([key, value]) => [key, column(value!)]),
  )
  let remaining = false
  for (const selector of config.captureOnly) if (column(selector)) remaining = true
  if (used.size !== headers.length) return review('unmapped_fields')
  const submittedName = config.mapping.name
    ? values.name
    : `${values.firstName ?? ''} ${values.lastName ?? ''}`
  const entity = entityKind(config.family)
  const linkOnly = !['preformation_a', 'accord_formateur'].includes(config.family)
  if (
    !values.timestamp ||
    !submittedName.trim() ||
    !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(values.email)
  )
    return review('identity_unresolved')
  const cohort = config.cohorts.find((c) =>
    config.mapping.cohort ? cohortAnswers(c).includes(values.cohort) : c.id === config.fixedCohort,
  )
  if (!cohort) return review('cohort_unresolved')
  const establishment =
    entity === 'adult'
      ? cohort.establishments!.find((e) => e.answer.trim() === values.establishment)
      : undefined
  if (entity === 'adult' && !establishment) return review('establishment_unresolved')
  const sourceDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(submittedAt))
  const canonicalEmail = email(values.email)
  const find = async (table: string, where: string, activeOnly = false): Promise<Row[]> => {
    const result = (await read(
      `tables/${table}/records?where=${encodeURIComponent(where)}&limit=${activeOnly ? 100 : 2}`,
    )) as { list?: Row[]; pageInfo?: { isLastPage?: boolean } }
    if (
      !Array.isArray(result?.list) ||
      result.list.length > (activeOnly ? 100 : 1) ||
      result.pageInfo?.isLastPage !== true
    )
      throw new Error('identity_not_unique')
    if (result.list.some((r) => !id(r.Id))) throw new Error('identity_invalid')
    const matches = activeOnly ? result.list.filter((r) => empty(r.fusionne_vers)) : result.list
    if (matches.length > 1) throw new Error('identity_not_unique')
    return matches
  }
  const emailFields =
    entity === 'school'
      ? ['referent_email', 'email_direction', 'email_institutionnel', 'email_logistique']
      : entity === 'adult'
        ? ['email', 'email_2']
        : ['email']
  const person = (
    await find(
      config.tables.people,
      emailFields.map((field) => `(${field},eq,${canonicalEmail})`).join('~or'),
    )
  )[0]
  if (!person && config.family === 'preformation_a' && config.createMissingAdults) {
    const dossier = (await read(
      `tables/${config.tables.records}/records/${establishment!.participationId}`,
    )) as Row
    if (
      dossier?.Id !== establishment!.participationId ||
      dossier.cohortes_id !== cohort.id ||
      dossier.etablissements_id !== establishment!.schoolId ||
      !empty(dossier.fusionne_vers)
    )
      return review('cohort_conflict')
    // An existing person without this email is not proof of a new person.
    // Refuse exact full-name collisions inside the confirmed dossier as well.
    const adults = (await read(
      `tables/${config.tables.people}/records?where=${encodeURIComponent(`(participations_id,eq,${establishment!.participationId})`)}&limit=200`,
    )) as { list?: Row[]; pageInfo?: { isLastPage?: boolean } }
    if (
      !Array.isArray(adults?.list) ||
      adults.pageInfo?.isLastPage !== true ||
      adults.list.length > 200
    )
      return review('person_cohort_inventory_incomplete')
    if (
      adults.list.some((a) => !id(a.Id) || a.participations_id !== establishment!.participationId)
    )
      return review('identity_invalid')
    if (
      adults.list.some((a) =>
        [
          name(`${text(a.prenom)} ${text(a.nom)}`),
          name(`${text(a.nom)} ${text(a.prenom)}`),
        ].includes(name(submittedName)),
      )
    )
      return review('identity_conflict')
    const key = await digest(`${establishment!.participationId}:${canonicalEmail}`)
    return {
      state: 'planned',
      plan: {
        family: config.family,
        table: config.tables.people,
        id: 0,
        before: {},
        after: {
          adulte_id: 'AD-G-' + key.slice(0, 12),
          nom: submittedName,
          prenom: '',
          email: canonicalEmail,
          participations_id: establishment!.participationId,
          date_pre_recu: sourceDate,
        },
        guard: [
          {
            table: config.tables.records,
            id: dossier.Id,
            fields: pick(dossier, ['cohortes_id', 'etablissements_id', 'fusionne_vers']),
          },
        ],
        remaining,
        create: { key },
      },
    }
  }
  if (!person || !emailFields.some((field) => email(person[field]) === canonicalEmail))
    return review('identity_unresolved')
  const names =
    entity === 'school'
      ? [name(person.nom)]
      : [
          name(`${text(person.prenom)} ${text(person.nom)}`),
          name(`${text(person.nom)} ${text(person.prenom)}`),
        ]
  if (!names.includes(name(submittedName))) return review('identity_conflict')
  const guard = [
    {
      table: config.tables.people,
      id: person.Id,
      fields: pick(person, [
        'nom',
        ...(entity === 'school' ? [] : ['prenom']),
        ...emailFields,
        ...(entity === 'adult' ? ['participations_id'] : []),
      ]),
    },
  ]
  if (entity === 'adult') {
    const dossier = (await read(
      `tables/${config.tables.records}/records/${establishment!.participationId}`,
    )) as Row
    if (
      person.participations_id !== establishment!.participationId ||
      dossier.Id !== establishment!.participationId ||
      dossier.cohortes_id !== cohort.id ||
      dossier.etablissements_id !== establishment!.schoolId ||
      !empty(dossier.fusionne_vers)
    )
      return review('cohort_conflict')
    guard.push({
      table: config.tables.records,
      id: dossier.Id,
      fields: pick(dossier, ['cohortes_id', 'etablissements_id', 'fusionne_vers']),
    })
    if (linkOnly)
      return {
        state: 'planned',
        plan: {
          family: config.family,
          table: config.tables.people,
          id: person.Id,
          before: {},
          after: {},
          guard,
          remaining: true,
          linkOnly: true,
        },
      }
    const received = sourceDate
    if (!isoDate(received)) return review('date_invalid')
    if (!empty(person.date_pre_recu) && person.date_pre_recu !== received)
      return review('existing_value_conflict')
    return {
      state: 'planned',
      plan: {
        family: config.family,
        table: config.tables.people,
        id: person.Id,
        before: pick(person, ['date_pre_recu']),
        after: { date_pre_recu: received },
        guard,
        remaining,
      },
    }
  }
  const record = (
    await find(
      config.tables.records,
      `(${entity === 'school' ? 'etablissements_id' : 'formateurs_id'},eq,${person.Id})` +
        (cohort.id === null ? '' : `~and(cohortes_id,eq,${cohort.id})`),
      true,
    )
  )[0]
  if (
    !record ||
    record[entity === 'school' ? 'etablissements_id' : 'formateurs_id'] !== person.Id ||
    (record.cohortes_id ?? null) !== cohort.id ||
    !empty(record.fusionne_vers)
  )
    return review('cohort_conflict')
  guard.push({
    table: config.tables.records,
    id: record.Id,
    fields: pick(record, [
      entity === 'school' ? 'etablissements_id' : 'formateurs_id',
      'cohortes_id',
      'fusionne_vers',
    ]),
  })
  if (linkOnly)
    return {
      state: 'planned',
      plan: {
        family: config.family,
        table: config.tables.records,
        id: record.Id,
        before: {},
        after: {},
        guard,
        remaining: true,
        linkOnly: true,
      },
    }
  if (values.agreement !== config.agreementAnswer!.trim()) return review('agreement_not_confirmed')
  const match = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(values.agreementDate)
  const signed = match ? `${match[3]}-${match[2]}-${match[1]}` : values.agreementDate
  if (!isoDate(signed) || signed > sourceDate) return review('date_invalid')
  if (
    (!empty(record.date_accord) && record.date_accord !== signed) ||
    ![null, undefined, false, true].includes(record.accord_signe as boolean | undefined)
  )
    return review('existing_value_conflict')
  return {
    state: 'planned',
    plan: {
      family: config.family,
      table: config.tables.records,
      id: record.Id,
      before: pick(record, ['accord_signe', 'date_accord']),
      after: { accord_signe: true, date_accord: signed },
      guard,
      remaining,
    },
  }
}

/** Recheck both identity/relations and values immediately before PATCH; the
 * caller keeps a durable writing marker. Read-after-write alone certifies success. */
export async function checkGooglePersonPlan(
  plan: PersonPlan,
  read: PersonRead,
): Promise<'before' | 'after' | 'conflict'> {
  for (const item of plan.guard) {
    const actual = (await read(`tables/${item.table}/records/${item.id}`)) as Row
    if (actual?.Id !== item.id || Object.entries(item.fields).some(([k, v]) => !same(actual[k], v)))
      return 'conflict'
  }
  if (plan.create) {
    const result = (await read(
      `tables/${plan.table}/records?where=${encodeURIComponent(`(adulte_id,eq,${plan.after.adulte_id})~or(email,eq,${plan.after.email})~or(email_2,eq,${plan.after.email})`)}&limit=2`,
    )) as { list?: Row[]; pageInfo?: { isLastPage?: boolean } }
    if (
      !Array.isArray(result?.list) ||
      result.pageInfo?.isLastPage !== true ||
      result.list.length > 1
    )
      return 'conflict'
    if (!result.list.length) return plan.id === 0 ? 'before' : 'conflict'
    const record = result.list[0]
    if (
      !id(record.Id) ||
      (plan.id !== 0 && plan.id !== record.Id) ||
      Object.entries(plan.after).some(
        ([k, v]) => !(v === '' && empty(record[k])) && !same(record[k], v),
      )
    )
      return 'conflict'
    plan.id = record.Id
    return 'after'
  }
  const actual = (await read(`tables/${plan.table}/records/${plan.id}`)) as Row
  if (actual?.Id !== plan.id) return 'conflict'
  if (Object.entries(plan.after).every(([k, v]) => same(actual[k], v))) return 'after'
  return Object.entries(plan.before).every(([k, v]) => same(actual[k], v)) ? 'before' : 'conflict'
}

export function googleReconciliationDetail(
  sourceKey: string,
  outcome: { state: string; code: string },
  at: string,
  plan?: PersonPlan,
) {
  const integrated = outcome.state === 'complete'
  return (
    '[EUNEOS_GOOGLE_RECONCILIATION_V1]' +
    JSON.stringify({
      version: 1,
      sourceKey,
      targets:
        integrated && plan
          ? [
              { table: plan.table, id: plan.id, fields: Object.keys(plan.after) },
              ...plan.guard
                .filter((g) => g.table !== plan.table || g.id !== plan.id)
                .map((g) => ({ table: g.table, id: g.id, fields: [] })),
            ]
          : [],
      state: integrated
        ? plan?.remaining || outcome.code !== 'saved'
          ? 'partial'
          : 'integrated'
        : 'pending',
      reasons: integrated && !plan?.remaining && outcome.code === 'saved' ? [] : [outcome.code],
      at,
    }) +
    '[/EUNEOS_GOOGLE_RECONCILIATION_V1]'
  )
}

/** Keep human notes and earlier target/field evidence. Only replace our own
 * initial placeholder. Unknown/malformed annotations remain byte-for-byte text. */
export function mergeGoogleReconciliationDetail(existing: unknown, incoming: string) {
  const previous = typeof existing === 'string' ? existing : ''
  if (!previous.trim()) return incoming
  if (previous.includes(incoming)) return previous
  const re = /\[EUNEOS_GOOGLE_RECONCILIATION_V1\]([\s\S]*?)\[\/EUNEOS_GOOGLE_RECONCILIATION_V1\]/g
  const nextMatch = [...incoming.matchAll(re)][0]
  if (!nextMatch) return previous + '\n' + incoming
  const next = JSON.parse(nextMatch[1])
  let merged = false
  const result = previous.replace(re, (block, payload) => {
    if (merged) return block
    try {
      const old = JSON.parse(payload)
      if (
        old.version !== 1 ||
        old.sourceKey !== next.sourceKey ||
        !Array.isArray(old.targets) ||
        !Array.isArray(old.reasons)
      )
        return block
      const targets = [...old.targets]
      for (const target of next.targets) {
        const index = targets.findIndex((t) => t.table === target.table && t.id === target.id)
        if (index < 0) targets.push(target)
        else if (Array.isArray(targets[index].fields) && Array.isArray(target.fields))
          targets[index] = {
            ...targets[index],
            fields: [...new Set([...targets[index].fields, ...target.fields])],
          }
        else targets.push(target)
      }
      const reasons = [
        ...new Set([
          ...old.reasons.filter(
            (r: string) => !['projection_pending', 'mapping_not_configured'].includes(r),
          ),
          ...next.reasons,
        ]),
      ]
      const state = next.state === 'integrated' && reasons.length ? 'partial' : next.state
      merged = true
      return (
        '[EUNEOS_GOOGLE_RECONCILIATION_V1]' +
        JSON.stringify({ ...old, ...next, targets, reasons, state }) +
        '[/EUNEOS_GOOGLE_RECONCILIATION_V1]'
      )
    } catch {
      return block
    }
  })
  return merged ? result : previous + '\n' + incoming
}

export function hasPendingGoogleReconciliation(detail: string) {
  const blocks = [
    ...detail.matchAll(
      /\[EUNEOS_GOOGLE_RECONCILIATION_V1\]([\s\S]*?)\[\/EUNEOS_GOOGLE_RECONCILIATION_V1\]/g,
    ),
  ]
  return blocks.some(([, payload]) => {
    try {
      return JSON.parse(payload).state !== 'integrated'
    } catch {
      return true
    }
  })
}
