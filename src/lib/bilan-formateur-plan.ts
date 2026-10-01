import { internalEnvironment } from './internal-context'
import { OperationalLinkError } from './operational-links'
import type { PersonPlan, PersonRead } from './google-form-person'
import type { BilanAnswers } from './bilan-formateur'

// Exact columns/types checked against mission metadata on 2026-10-01.
export const bilanFields = {
  start: { field: 'date_debut', type: 'Date' },
  end: { field: 'date_fin_reelle', type: 'Date' },
  adultCount: { field: 'nb_adultes_formes', type: 'Number' },
  datesRespected: { field: 'dates_respectees', type: 'SingleLineText' },
  difficulty: { field: 'difficulte', type: 'SingleLineText' },
} as const
export type BilanConfig = {
  version: 1
  family: 'bilan_formateur'
  tables: { people: string; records: string; missions: string }
  cohorts: {
    id: number
    answer: string
    establishments: { answer: string; participationId: number; schoolId: number }[]
  }[]
  receipt: { field: 'bilan_recu'; type: 'Checkbox'; value: true }
  fields: { source: keyof typeof bilanFields; field: string; type: string }[]
}
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const empty = (v: unknown) => v == null || v === ''
const canonical = (v: unknown) =>
  typeof v === 'string'
    ? v.normalize('NFC').trim().toLocaleLowerCase('fr').replace(/\s+/g, ' ')
    : ''
const pick = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k] ?? null]))
export function validateBilanConfig(c: BilanConfig) {
  if (
    !c ||
    c.version !== 1 ||
    c.family !== 'bilan_formateur' ||
    !c.receipt ||
    c.receipt.field !== 'bilan_recu' ||
    c.receipt.type !== 'Checkbox' ||
    c.receipt.value !== true ||
    Object.keys(c.receipt).sort().join(',') !== 'field,type,value' ||
    !c.tables ||
    Object.keys(c.tables).sort().join(',') !== 'missions,people,records' ||
    !Object.values(c.tables).every((v) => /^[a-z0-9]{10,30}$/.test(v)) ||
    new Set(Object.values(c.tables)).size !== 3 ||
    !Array.isArray(c.cohorts) ||
    !c.cohorts.length ||
    !Array.isArray(c.fields)
  )
    throw new Error('bilan_configuration_invalid')
  if (
    c.cohorts.some(
      (co) =>
        !id(co.id) ||
        !/^20\d{2}-20\d{2}$/.test(co.answer) ||
        Number(co.answer.slice(5)) !== Number(co.answer.slice(0, 4)) + 1 ||
        !Array.isArray(co.establishments) ||
        !co.establishments.length ||
        co.establishments.some(
          (e) => !e.answer?.trim() || !id(e.participationId) || !id(e.schoolId),
        ) ||
        new Set(co.establishments.map((e) => e.answer.trim())).size !== co.establishments.length,
    ) ||
    new Set(c.cohorts.map((co) => co.answer)).size !== c.cohorts.length ||
    new Set(c.cohorts.map((co) => co.id)).size !== c.cohorts.length
  )
    throw new Error('bilan_configuration_invalid')
  if (
    c.fields.some(
      (f) =>
        !bilanFields[f.source] ||
        f.field !== bilanFields[f.source].field ||
        f.type !== bilanFields[f.source].type ||
        Object.keys(f).sort().join(',') !== 'field,source,type',
    ) ||
    new Set(c.fields.map((f) => f.field)).size !== c.fields.length
  )
    throw new Error('bilan_configuration_invalid')
}
export function bilanConfig(locals: unknown): BilanConfig {
  try {
    const c = JSON.parse(String(internalEnvironment(locals).BILAN_FORMATEUR_PROJECTION))
    validateBilanConfig(c)
    return c
  } catch {
    throw new OperationalLinkError(
      503,
      'projection_configuration',
      'Ce formulaire est momentanément indisponible. Contactez l’équipe EUNEOS.',
    )
  }
}
export type BilanPlan = PersonPlan & {
  participationId: number
  trainerId: number
  reasons: string[]
}
export async function planBilan(
  config: BilanConfig,
  answers: BilanAnswers,
  read: PersonRead,
): Promise<{ state: 'review'; code: string } | { state: 'planned'; plan: BilanPlan }> {
  validateBilanConfig(config)
  const review = (code: string) => ({ state: 'review' as const, code })
  const cohort = config.cohorts.find((c) => c.answer === answers.year),
    establishment = cohort?.establishments.find((e) => e.answer.trim() === answers.school)
  if (!cohort || !establishment) return review('dossier_unresolved')
  const persons = (await read(
    `tables/${config.tables.people}/records?${new URLSearchParams({ where: `(email,eq,${answers.email})`, limit: '2' })}`,
  )) as any
  if (
    !Array.isArray(persons.list) ||
    persons.pageInfo?.isLastPage !== true ||
    persons.list.length !== 1
  )
    return review('identity_not_unique')
  const person = persons.list[0]
  if (
    !id(person.Id) ||
    canonical(person.email) !== answers.email ||
    ![
      `${person.prenom ?? ''} ${person.nom ?? ''}`,
      `${person.nom ?? ''} ${person.prenom ?? ''}`,
    ].some((n) => canonical(n) === canonical(answers.name))
  )
    return review('identity_conflict')
  const dossier = (await read(
    `tables/${config.tables.records}/records/${establishment.participationId}`,
  )) as any
  if (
    dossier.Id !== establishment.participationId ||
    dossier.cohortes_id !== cohort.id ||
    dossier.etablissements_id !== establishment.schoolId ||
    !empty(dossier.fusionne_vers)
  )
    return review('cohort_conflict')
  const missions = (await read(
    `tables/${config.tables.missions}/records?${new URLSearchParams({ where: `(participations_id,eq,${dossier.Id})~and(formateurs_id,eq,${person.Id})`, limit: '2' })}`,
  )) as any
  if (
    !Array.isArray(missions.list) ||
    missions.pageInfo?.isLastPage !== true ||
    missions.list.length !== 1
  )
    return review('mission_not_unique')
  const mission = missions.list[0]
  if (
    !id(mission.Id) ||
    mission.participations_id !== dossier.Id ||
    mission.formateurs_id !== person.Id
  )
    return review('mission_identity_conflict')
  const after: Record<string, unknown> = {},
    before: Record<string, unknown> = {},
    reasons: string[] = []
  // Explicitly authorized receipt mapping only: false is the normal pre-receipt state.
  // This says nothing about training completion, signed conventions or invoices.
  if (![null, undefined, false, true].includes(mission.bilan_recu))
    return review('receipt_value_invalid')
  before.bilan_recu = mission.bilan_recu ?? null
  after.bilan_recu = true
  // All remaining fields preserve nonempty values, including false and zero.
  for (const field of config.fields) {
    const submitted =
      field.source === 'adultCount' ? Number(answers.adultCount) : answers[field.source]
    const previous = mission[field.field]
    if (previous === submitted) {
      before[field.field] = previous
      after[field.field] = previous
      continue
    }
    if (!empty(previous)) {
      reasons.push('nonempty_conflict:' + field.field)
      continue
    }
    before[field.field] = previous ?? null
    after[field.field] = submitted
  }
  // Dates originate solely from the respondent; an out-of-year date is kept for review, never inferred.
  if (
    ![cohort.answer.slice(0, 4), cohort.answer.slice(5)].includes(answers.start.slice(0, 4)) ||
    ![cohort.answer.slice(0, 4), cohort.answer.slice(5)].includes(answers.end.slice(0, 4))
  )
    return review('date_cohort_conflict')
  return {
    state: 'planned',
    plan: {
      family: 'bilan_formateur',
      table: config.tables.missions,
      id: mission.Id,
      before,
      after,
      guard: [
        {
          table: config.tables.people,
          id: person.Id,
          fields: pick(person, ['prenom', 'nom', 'email']),
        },
        {
          table: config.tables.records,
          id: dossier.Id,
          fields: pick(dossier, ['cohortes_id', 'etablissements_id', 'fusionne_vers']),
        },
        {
          table: config.tables.missions,
          id: mission.Id,
          fields: pick(mission, ['participations_id', 'formateurs_id', 'statut']),
        },
      ],
      remaining: true,
      participationId: dossier.Id,
      trainerId: person.Id,
      reasons,
    },
  }
}
