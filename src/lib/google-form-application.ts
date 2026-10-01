import type { SheetHeader } from './google-form-sheet'
import type { PersonOutcome, PersonPlan } from './google-form-person'
import { isoDate } from './google-form-contact'

type Option = { source: string; value: string | true }
export type ApplicationField =
  | { field: string; type: 'text' | 'url'; header: SheetHeader }
  | { field: string; type: 'choice' | 'consent'; header: SheetHeader; options: Option[] }
  | {
      field: string
      type: 'multiChoice'
      header: SheetHeader
      options: Option[]
      separator: string
    }
  | { field: 'date_suivi_recu'; type: 'submissionDate' }
export type ApplicationFieldsConfig = { version: 1; fields: ApplicationField[] }
type Rule = {
  type: ApplicationField['type']
  max?: number
  values?: readonly (string | true)[]
  join?: string
}
const yesNoDiscussion = ['Oui', 'Non', 'En discussion']
const schoolType = [
  'École primaire',
  'Collège',
  'Lycée général et technologique',
  'Lycée professionnel',
  'Autre',
]
const free: Rule = { type: 'text', max: 5000 }
/** Application objects only, matching api/candidature-{etablissement,formateur}.
 * Identity fields, emails, workflow/statuses and candidature dates are excluded. */
export const APPLICATION_FIELD_RULES: Record<string, Readonly<Record<string, Rule>>> = {
  candidature_etablissement: {
    enjeux: {
      type: 'multiChoice',
      values: [
        'Attention / concentration des élèves',
        'Gestion du stress ou de la surcharge',
        'Usages numériques',
        'Climat scolaire / qualité des relations',
        'Besoin de renforcer les compétences psychosociales',
        "Besoin d'outils concrets pour les équipes",
        'Autre',
      ],
      join: ',',
    },
    besoin_partage: {
      type: 'choice',
      values: ['Oui, clairement', 'Oui, partiellement', 'Pas encore vraiment', 'Je ne sais pas'],
    },
    nb_professionnels: {
      type: 'choice',
      values: ['Moins de 10', '10 à 20', '21 à 40', 'Plus de 40', 'À préciser ultérieurement'],
    },
    faisabilite: {
      type: 'choice',
      values: [
        'Facilement envisageable',
        'Envisageable sous certaines conditions',
        'Encore incertaine',
        'Trop tôt pour le dire',
      ],
    },
    point_vigilance: {
      type: 'choice',
      values: [
        'Calendrier / disponibilité',
        'Mobilisation des équipes',
        'Arbitrage de direction',
        'Organisation interne',
        'Besoin de mieux comprendre le programme',
        'Autre',
      ],
    },
    accord_direction: { type: 'choice', values: yesNoDiscussion },
    document_lien: { type: 'url', max: 2000 },
    demarrage_souhaite: {
      type: 'choice',
      values: [
        'Dans les 1 à 2 prochains mois',
        'Dans le trimestre à venir',
        'Au prochain semestre',
        'À la prochaine rentrée',
        'À définir',
      ],
    },
    contrainte_calendrier: free,
    apporteur_nom: free,
    consentement: { type: 'consent', values: [true] },
  },
  candidature_formateur: {
    formation_instructeur: {
      type: 'choice',
      values: [
        'Oui, je suis instructeur·rice certifié·e MBSR',
        'Oui, je suis instructeur·rice certifié·e MBCT',
        'Oui, je suis instructeur·rice / formateur·rice PEACE',
        "Oui, j'ai suivi une autre formation professionnelle de formateur·rice en mindfulness",
        "Non, j'ai uniquement suivi un cycle en tant que participant·e",
      ],
    },
    experience_animation: {
      type: 'multiChoice',
      values: ["Oui, auprès d'adultes", "Oui, auprès d'enseignants", "Oui, auprès d'élèves", 'Non'],
      join: ' · ',
    },
    pratique_personnelle: free,
    annees_experience: free,
    interventions_animees: free,
    motivation: free,
    disponible_2026_27: { type: 'choice', values: ['Oui', 'Non', 'Partiellement'] },
    etab_pressenti: { type: 'choice', values: yesNoDiscussion },
    etab_pressenti_nom: free,
    etab_pressenti_adresse: free,
    etab_pressenti_ville: free,
    etab_pressenti_cp: free,
    etab_pressenti_academie: free,
    etab_pressenti_type: { type: 'choice', values: [...schoolType, 'Non défini à ce stade'] },
    direction_nom: free,
    accord_principe: { type: 'choice', values: yesNoDiscussion },
    contexte_complement: free,
    consentement: { type: 'consent', values: [true] },
  },
  suivi_j45: { date_suivi_recu: { type: 'submissionDate' } },
}
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v))
const invalid = (): never => {
  throw new Error('person_application_configuration_invalid')
}
const exactKeys = (value: object, keys: string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every((k) => keys.includes(k))
function validHeader(h: unknown) {
  return typeof h === 'string'
    ? !!h.trim() && h.length <= 5000
    : plain(h) &&
        Object.keys(h).every((k) => ['label', 'occurrence', 'column'].includes(k)) &&
        typeof h.label === 'string' &&
        !!h.label.trim() &&
        h.label.length <= 5000 &&
        Number.isSafeInteger(h.occurrence) &&
        Number(h.occurrence) > 0 &&
        (h.column === undefined || (Number.isSafeInteger(h.column) && Number(h.column) > 0))
}
export function validateApplicationFields(family: string, config?: ApplicationFieldsConfig) {
  if (config === undefined) return
  if (
    !plain(config) ||
    !exactKeys(config, ['version', 'fields']) ||
    config.version !== 1 ||
    !Array.isArray(config.fields) ||
    !config.fields.length ||
    config.fields.length > 32 ||
    !own(APPLICATION_FIELD_RULES, family)
  )
    invalid()
  const rules = APPLICATION_FIELD_RULES[family],
    seen = new Set<string>()
  for (const field of config.fields) {
    if (
      !plain(field) ||
      typeof field.field !== 'string' ||
      !own(rules, field.field) ||
      seen.has(field.field)
    )
      invalid()
    seen.add(field.field)
    const rule = rules[field.field]
    if (field.type !== rule.type) invalid()
    const keys =
      field.type === 'submissionDate'
        ? ['field', 'type']
        : [
            'field',
            'type',
            'header',
            ...(['choice', 'consent', 'multiChoice'].includes(field.type) ? ['options'] : []),
            ...(field.type === 'multiChoice' ? ['separator'] : []),
          ]
    if (!exactKeys(field, keys)) invalid()
    if (field.type === 'submissionDate') continue
    if (!validHeader(field.header)) invalid()
    if ('options' in field) {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 50)
        invalid()
      const sources = new Set<string>()
      for (const option of field.options) {
        if (
          !plain(option) ||
          !exactKeys(option, ['source', 'value']) ||
          typeof option.source !== 'string' ||
          !option.source.trim() ||
          option.source !== option.source.trim() ||
          option.source.length > 5000 ||
          sources.has(option.source) ||
          !rule.values?.includes(option.value as string | true)
        )
          invalid()
        sources.add(option.source)
      }
    }
    if (
      field.type === 'multiChoice' &&
      (typeof field.separator !== 'string' || ![', ', '; ', ' · ', '\n'].includes(field.separator))
    )
      invalid()
  }
}
/** Parse whole audited labels, not raw comma splitting: Google labels can themselves
 * contain commas. Multiple decompositions or duplicated answers require review. */
function multiple(
  value: string,
  field: Extract<ApplicationField, { type: 'multiChoice' }>,
): string[] | null {
  const options = field.options,
    solutions: string[][] = []
  let visits = 0,
    exhausted = false
  const visit = (offset: number, selected: string[], used: Set<string>) => {
    if (++visits > 2000) {
      exhausted = true
      return
    }
    if (exhausted || solutions.length > 1 || selected.length > options.length) return
    for (const option of options) {
      if (
        typeof option.value !== 'string' ||
        used.has(option.value) ||
        !value.startsWith(option.source, offset)
      )
        continue
      const end = offset + option.source.length,
        next = [...selected, option.value]
      if (end === value.length) solutions.push(next)
      else if (value.startsWith(field.separator, end))
        visit(end + field.separator.length, next, new Set([...used, option.value]))
    }
  }
  visit(0, [], new Set())
  return !exhausted && solutions.length === 1 ? solutions[0] : null
}
function valueOf(
  field: ApplicationField,
  raw: string,
  sourceDate: string,
  rule: Rule,
): string | true | null {
  if (field.type === 'submissionDate') return isoDate(sourceDate) ? sourceDate : null
  if (raw.length > (rule.max ?? 5000) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw))
    return null
  if (field.type === 'text') return raw
  if (field.type === 'url') {
    try {
      const url = new URL(raw)
      return ['https:', 'http:'].includes(url.protocol) ? raw : null
    } catch {
      return null
    }
  }
  if (field.type === 'multiChoice') {
    const values = multiple(raw, field)
    return values ? values.join(rule.join!) : null
  }
  return 'options' in field ? (field.options.find((o) => o.source === raw)?.value ?? null) : null
}
/** Consume the audited columns once during parsing, then produce a single-table
 * compatible PersonPlan only after the caller verifies identity and cohort. */
export function prepareGoogleApplication(
  family: string,
  config: ApplicationFieldsConfig | undefined,
  column: (header: SheetHeader) => string,
) {
  validateApplicationFields(family, config)
  const entries = (config?.fields ?? []).map((field) => ({
    field,
    raw: field.type === 'submissionDate' ? '' : column(field.header),
  }))
  return (base: PersonPlan, row: Record<string, unknown>, sourceDate: string): PersonOutcome => {
    if (!config) return { state: 'planned', plan: base }
    const before: Record<string, unknown> = {},
      after: Record<string, unknown> = {},
      conflicts: Record<string, unknown> = {}
    let rejected = false
    for (const { field, raw } of entries) {
      if (field.type !== 'submissionDate' && raw === '') continue
      const desired = valueOf(field, raw, sourceDate, APPLICATION_FIELD_RULES[family][field.field])
      const previous = row[field.field] ?? null
      if (desired === null) {
        rejected = true
        continue
      }
      // false, 0 and whitespace are existing values, never treated as empty.
      if (previous !== null && previous !== '' && previous !== desired) {
        conflicts[field.field] = previous
        continue
      }
      before[field.field] = previous
      after[field.field] = desired
    }
    if (!Object.keys(after).length && (rejected || Object.keys(conflicts).length))
      return {
        state: 'review',
        code: rejected ? 'application_value_invalid' : 'existing_value_conflict',
      }
    const guard = [...base.guard]
    if (Object.keys(conflicts).length)
      guard.push({ table: base.table, id: base.id, fields: conflicts })
    return {
      state: 'planned',
      plan: {
        ...base,
        before,
        after,
        guard,
        linkOnly: false,
        remaining: base.remaining || rejected || Object.keys(conflicts).length > 0,
      },
    }
  }
}
