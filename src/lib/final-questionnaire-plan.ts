import { internalEnvironment } from './internal-context'
import { OperationalLinkError } from './operational-links'
import { operationalRequest } from './operational-data'
import type { PersonPlan, PersonRead } from './google-form-person'
import type { FinalQuestionnaireAnswers } from './final-questionnaire'
import type { FinalQuestionnaireDefinition } from './final-questionnaire-definition'

export const finalReceiptFields = {
  evaluation_formation: 'date_evaluation_recu',
  bilan_etablissement: 'date_bilan_etablissement_recu',
} as const
export type FinalConfig = {
  version: 1
  family: keyof typeof finalReceiptFields
  tables: { people: string; records: string; schools: string }
  cohorts: {
    id: number
    answer?: string
    answers?: string[]
    establishments: { answer: string; participationId: number; schoolId: number }[]
  }[]
  receipt: { field: string; type: 'Date' }
  scoreNps?: boolean
}
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const empty = (v: unknown) => v === null || v === undefined || v === ''
const email = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const pick = (row: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.map((k) => [k, row[k] ?? null]))
export const finalCohortAnswers = (co: FinalConfig['cohorts'][number]) =>
  [co.answer, ...(co.answers ?? [])]
    .filter((a): a is string => typeof a === 'string')
    .map((a) => a.trim())
const contactFields = [
  'referent_email',
  'email_direction',
  'email_institutionnel',
  'email_logistique',
]
export function validateFinalConfig(c: FinalConfig) {
  const invalid = () => {
    throw new Error('final_configuration_invalid')
  }
  if (
    !c ||
    c.version !== 1 ||
    !Object.hasOwn(finalReceiptFields, c.family) ||
    Object.keys(c).some(
      (k) => !['version', 'family', 'tables', 'cohorts', 'receipt', 'scoreNps'].includes(k),
    ) ||
    !c.tables ||
    Object.keys(c.tables).sort().join() !== 'people,records,schools' ||
    !Object.values(c.tables).every((t) => typeof t === 'string' && /^[a-z0-9]{10,30}$/.test(t)) ||
    !c.receipt ||
    Object.keys(c.receipt).sort().join() !== 'field,type' ||
    c.receipt.field !== finalReceiptFields[c.family] ||
    c.receipt.type !== 'Date' ||
    (c.scoreNps !== undefined &&
      (typeof c.scoreNps !== 'boolean' || c.family !== 'bilan_etablissement')) ||
    !Array.isArray(c.cohorts) ||
    !c.cohorts.length
  )
    invalid()
  if (
    c.tables.records === c.tables.schools ||
    c.tables.records === c.tables.people ||
    (c.family === 'evaluation_formation'
      ? c.tables.people === c.tables.schools
      : c.tables.people !== c.tables.schools)
  )
    invalid()
  const cohortIds = new Set<number>(),
    aliases = new Map<string, number>()
  for (const co of c.cohorts) {
    if (
      !id(co.id) ||
      cohortIds.has(co.id) ||
      (co.answer !== undefined && (typeof co.answer !== 'string' || !co.answer.trim())) ||
      (co.answers !== undefined &&
        (!Array.isArray(co.answers) ||
          co.answers.some((a) => typeof a !== 'string' || !a.trim()))) ||
      !finalCohortAnswers(co).length ||
      !Array.isArray(co.establishments) ||
      !co.establishments.length
    )
      invalid()
    cohortIds.add(co.id)
    for (const a of finalCohortAnswers(co)) {
      if (aliases.has(a) && aliases.get(a) !== co.id) invalid()
      aliases.set(a, co.id)
    }
    const schools = new Map<string, string>()
    for (const e of co.establishments) {
      if (
        typeof e.answer !== 'string' ||
        !e.answer.trim() ||
        !id(e.participationId) ||
        !id(e.schoolId)
      )
        invalid()
      const key = e.answer.trim(),
        target = `${e.schoolId}:${e.participationId}`
      if (schools.has(key)) invalid()
      schools.set(key, target)
    }
  }
}
export function finalProjectionConfig(
  locals: unknown,
  def: FinalQuestionnaireDefinition,
): FinalConfig {
  try {
    const key =
      def.kind === 'evaluation_fin_formation'
        ? 'EVALUATION_FORMATION_PROJECTION'
        : 'BILAN_ETABLISSEMENT_PROJECTION'
    const c = JSON.parse(String(internalEnvironment(locals)[key]))
    validateFinalConfig(c)
    if (
      c.family !==
      (def.kind === 'evaluation_fin_formation' ? 'evaluation_formation' : 'bilan_etablissement')
    )
      throw new Error('Wrong family')
    return c
  } catch {
    throw new OperationalLinkError(
      503,
      'projection_configuration',
      'Ce formulaire est momentanément indisponible. Contactez l’équipe EUNEOS.',
    )
  }
}
/** Gate collection on the real schema, not a declared secret alone. */
export async function requireFinalSchema(config: FinalConfig, token: string) {
  const table =
    config.family === 'evaluation_formation' ? config.tables.people : config.tables.records
  const meta = (await operationalRequest(token, `/meta/tables/${table}`)) as {
    columns?: { title: string; uidt: string }[]
  }
  const required = [
    { title: config.receipt.field, uidt: 'Date' },
    ...(config.scoreNps ? [{ title: 'score_nps', uidt: 'Number' }] : []),
  ]
  if (
    !Array.isArray(meta.columns) ||
    required.some(
      (r) => meta.columns!.filter((c) => c.title === r.title && c.uidt === r.uidt).length !== 1,
    )
  )
    throw new OperationalLinkError(
      503,
      'receipt_schema',
      'Ce formulaire est momentanément indisponible. Contactez l’équipe EUNEOS.',
    )
}
export type FinalPlan = PersonPlan & {
  participationId: number
  personId: number
  receivedDate: string
  reasons: string[]
}
export async function planFinalQuestionnaire(
  config: FinalConfig,
  answers: FinalQuestionnaireAnswers,
  receivedAt: string,
  read: PersonRead,
): Promise<{ state: 'review'; code: string } | { state: 'planned'; plan: FinalPlan }> {
  validateFinalConfig(config)
  const review = (code: string) => ({ state: 'review' as const, code })
  const cohort = config.cohorts.find((c) => finalCohortAnswers(c).includes(String(answers.year)))
  if (!cohort) return review('cohort_unresolved')
  const school = cohort.establishments.find((e) => e.answer.trim() === answers.school)
  if (!school) return review('establishment_unresolved')
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(receivedAt))
  const list = async (table: string, where: string) => {
    const result = (await read(
      `tables/${table}/records?${new URLSearchParams({ where, limit: '2' })}`,
    )) as { list?: Record<string, unknown>[]; pageInfo?: { isLastPage?: boolean } }
    if (
      !Array.isArray(result.list) ||
      result.pageInfo?.isLastPage !== true ||
      result.list.length !== 1 ||
      !id(result.list[0].Id)
    )
      return null
    return result.list[0]
  }
  // One declared email, one existing identity. No name fabricated from the database.
  const isAdult = config.family === 'evaluation_formation'
  const emails = isAdult ? ['email', 'email_2'] : contactFields
  const person = await list(
    config.tables.people,
    emails.map((k) => `(${k},eq,${answers.email})`).join('~or'),
  )
  if (!person) return review('identity_not_unique')
  if (
    !emails.some((k) => email(person[k]) === answers.email) ||
    (!isAdult && person.Id !== school.schoolId)
  )
    return review('identity_conflict')
  const dossier = await list(
    config.tables.records,
    `(etablissements_id,eq,${school.schoolId})~and(cohortes_id,eq,${cohort.id})`,
  )
  if (!dossier) return review('dossier_not_unique')
  if (
    dossier.Id !== school.participationId ||
    dossier.etablissements_id !== school.schoolId ||
    dossier.cohortes_id !== cohort.id ||
    !empty(dossier.fusionne_vers) ||
    (isAdult && person.participations_id !== dossier.Id)
  )
    return review('cohort_conflict')
  const establishment = isAdult
    ? ((await read(`tables/${config.tables.schools}/records/${school.schoolId}`)) as Record<
        string,
        unknown
      >)
    : person
  if (
    establishment.Id !== school.schoolId ||
    typeof establishment.nom !== 'string' ||
    !establishment.nom.trim()
  )
    return review('identity_conflict')
  const target = isAdult ? person : dossier,
    field = config.receipt.field
  if (!Object.hasOwn(target, field)) return review('receipt_field_unavailable')
  const previous = target[field]
  if (previous !== null && previous !== '' && previous !== date)
    return review('existing_value_conflict')
  const before: Record<string, unknown> = { [field]: previous },
    after: Record<string, unknown> = { [field]: date },
    reasons: string[] = []
  const guard: PersonPlan['guard'] = [
    {
      table: config.tables.people,
      id: Number(person.Id),
      fields: pick(person, ['nom', ...(isAdult ? ['prenom', 'participations_id'] : []), ...emails]),
    },
    {
      table: config.tables.records,
      id: Number(dossier.Id),
      fields: pick(dossier, ['cohortes_id', 'etablissements_id', 'fusionne_vers']),
    },
    ...(isAdult
      ? [
          {
            table: config.tables.schools,
            id: school.schoolId,
            fields: pick(establishment, ['nom']),
          },
        ]
      : []),
  ]
  if (config.scoreNps) {
    if (!Object.hasOwn(dossier, 'score_nps')) return review('receipt_field_unavailable')
    const score = Number(answers.q14),
      old = dossier.score_nps
    if (!Number.isInteger(score) || score < 0 || score > 10) return review('score_invalid')
    if (old === null || old === '' || old === score) {
      before.score_nps = old
      after.score_nps = score
    } else {
      reasons.push('score_nps_preserved')
      guard.push({
        table: config.tables.records,
        id: Number(dossier.Id),
        fields: { score_nps: old },
      })
    }
  }
  return {
    state: 'planned',
    plan: {
      family: config.family,
      table: isAdult ? config.tables.people : config.tables.records,
      id: Number(target.Id),
      before,
      after,
      guard,
      remaining: true,
      participationId: Number(dossier.Id),
      personId: Number(person.Id),
      receivedDate: date,
      reasons,
    },
  }
}
