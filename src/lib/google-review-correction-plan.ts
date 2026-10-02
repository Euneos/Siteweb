import { WorkspaceError } from './internal-workspace'
import { NC, reconcilierActifs } from './nocodb'
import { OPERATIONAL_ADULTS_TABLE } from './operational-data'
import { isoDate, isoTimestamp, readContact, writeContact } from './google-form-contact'
import { digest } from './google-form-sync'
import { planGooglePerson, type PersonPlan } from './google-form-person'
import { positiveId, reviewVersion, type GoogleRow, type ReviewTarget } from './google-review'
import type { SheetHeader } from './google-form-sheet'

export type CorrectionFamily =
  | 'contact'
  | 'organisation'
  | 'preformation'
  | 'postformation'
  | 'suivi_j45'
  | 'evaluation'
  | 'bilan_etablissement'
  | 'accord_formateur'
export type CorrectionSource = {
  label: string
  headerDigest?: string
  family: CorrectionFamily
  mapping: Partial<
    Record<
      | 'email'
      | 'name'
      | 'firstName'
      | 'lastName'
      | 'agreement'
      | 'agreementDate'
      | 'start'
      | 'end'
      | 'establishment'
      | 'cohort'
      | 'timestamp'
      | 'postcode'
      | 'contactName'
      | 'referenceEmail'
      | 'format'
      | 'trainer'
      | 'evaluationInterest'
      | 'evaluationLevel'
      | 'planning'
      | 'preformation',
      SheetHeader
    >
  >
  agreementAnswer?: string
}
export type CorrectionClient = (path: string, method?: string, body?: unknown) => Promise<any>
export const correctionFail = (message: string, status = 409): never => {
  throw new WorkspaceError(status, message)
}
const families: CorrectionFamily[] = [
  'contact',
  'organisation',
  'preformation',
  'postformation',
  'suivi_j45',
  'evaluation',
  'bilan_etablissement',
  'accord_formateur',
]
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const empty = (v: unknown) => v === null || v === undefined || v === ''
const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr')
const pick = (row: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))
export function correctionSources(value: unknown): CorrectionSource[] {
  if (value === undefined) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed) || parsed.length > 100) throw new Error()
    const aliases: Record<string, string> = {
      deploiement: 'organisation',
      preformation_a: 'preformation',
      postformation_b: 'postformation',
      evaluation_formation: 'evaluation',
    }
    const labels = new Set<string>()
    for (const s of parsed) {
      if (object(s) && typeof s.family === 'string' && Object.hasOwn(aliases, s.family))
        s.family = aliases[s.family]
      if (object(s) && s.agreementAnswer === null) delete s.agreementAnswer
      if (
        !object(s) ||
        Object.keys(s).some(
          (k) => !['label', 'family', 'mapping', 'agreementAnswer', 'headerDigest'].includes(k),
        ) ||
        typeof s.label !== 'string' ||
        !s.label ||
        labels.has(s.label) ||
        !families.includes(s.family as CorrectionFamily) ||
        !object(s.mapping)
      )
        throw new Error()
      labels.add(s.label)
      if (
        s.headerDigest !== undefined &&
        (typeof s.headerDigest !== 'string' || !/^[a-f0-9]{64}$/.test(s.headerDigest))
      )
        throw new Error()
      if (
        Object.keys(s.mapping).some(
          (k) =>
            ![
              'email',
              'name',
              'firstName',
              'lastName',
              'agreement',
              'agreementDate',
              'start',
              'end',
              'establishment',
              'cohort',
              'timestamp',
              'postcode',
              'contactName',
              'referenceEmail',
              'format',
              'trainer',
              'evaluationInterest',
              'evaluationLevel',
              'planning',
              'preformation',
            ].includes(k),
        )
      )
        throw new Error()
      for (const h of Object.values(s.mapping)) {
        if (typeof h === 'string' && h.trim()) continue
        if (
          !object(h) ||
          typeof h.label !== 'string' ||
          !h.label.trim() ||
          !positiveId(h.occurrence) ||
          (h.column !== undefined && !positiveId(h.column))
        )
          throw new Error()
      }
      if (
        !['contact', 'organisation'].includes(String(s.family)) &&
        (!s.mapping.email ||
          (!['evaluation', 'bilan_etablissement'].includes(String(s.family)) &&
            !(s.mapping.name || (s.mapping.firstName && s.mapping.lastName))))
      )
        throw new Error()
      if (
        ['evaluation', 'bilan_etablissement'].includes(String(s.family)) &&
        !s.mapping.establishment
      )
        throw new Error()
      if (
        s.family === 'accord_formateur' &&
        (!s.mapping.agreement ||
          !s.mapping.agreementDate ||
          typeof s.agreementAnswer !== 'string' ||
          !s.agreementAnswer)
      )
        throw new Error()
    }
    return parsed as CorrectionSource[]
  } catch {
    return correctionFail(
      'La correspondance des formulaires doit être vérifiée par l’équipe technique.',
      503,
    )
  }
}
export function correctionAnswers(row: GoogleRow) {
  try {
    const answers = JSON.parse(String(row.reponses)) as { question: string; answer: string }[]
    if (
      !Array.isArray(answers) ||
      !answers.length ||
      answers.length > 256 ||
      answers.some(
        (a) => !object(a) || typeof a.question !== 'string' || typeof a.answer !== 'string',
      )
    )
      throw new Error()
    return answers
  } catch {
    return correctionFail(
      'Le format de cette réponse ne permet pas une correction automatique. Le contenu original reste conservé.',
    )
  }
}
export function sourceAnswer(
  row: GoogleRow,
  source: CorrectionSource,
  key: keyof CorrectionSource['mapping'],
): string {
  const selector = source.mapping[key]
  if (!selector) return ''
  const answers = correctionAnswers(row),
    label = typeof selector === 'string' ? selector : selector.label
  const matches = answers.flatMap((a, i) =>
    a.question === label ? [{ value: a.answer, index: i }] : [],
  )
  const match =
    typeof selector === 'string'
      ? matches.length === 1
        ? matches[0]
        : null
      : matches[selector.occurrence - 1]
  if (
    !match ||
    (typeof selector !== 'string' &&
      ((matches.length > 1 && selector.column === undefined) ||
        (selector.column !== undefined && selector.column !== match.index + 1)))
  )
    return correctionFail(
      'Une question source est absente ou ambiguë ; aucune valeur ne sera devinée.',
    )
  return match.value.trim()
}
const dateAnswer = (value: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  return isoDate(m ? `${m[3]}-${m[2]}-${m[1]}` : value)
}
export function sourceDate(row: GoogleRow): string {
  const raw = String(row.horodatage_source ?? '')
  if (isoTimestamp(raw))
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(raw))
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw)
  if (m && Number(m[4] ?? 0) < 24 && Number(m[5] ?? 0) < 60 && Number(m[6] ?? 0) < 60) {
    const d = isoDate(`${m[3]}-${m[2]}-${m[1]}`)
    if (d) return d
  }
  const d = isoDate(raw)
  if (d) return d
  return correctionFail(
    'La date de réception Google est absente ou invalide ; elle ne peut pas être remplacée par la date du jour.',
  )
}
export function sourceFor(row: GoogleRow, sources: CorrectionSource[]) {
  return sources.find((s) => s.label === row.formulaire) ?? null
}
export function correctionOptions(row: GoogleRow, sources: CorrectionSource[]) {
  const source = sourceFor(row, sources)
  if (!source)
    return {
      kind: null,
      title: 'Correction indisponible',
      fields: [],
      targetKind: 'school',
      message:
        'Ce formulaire n’a pas encore de correspondance de correction vérifiée. Aucune modification ne sera faite.',
    }
  const contact = ['contact', 'organisation'].includes(source.family)
  const fields: {
    key: string
    label: string
    type: 'date' | 'checkbox'
    value?: string | boolean
    required?: boolean
  }[] = contact
    ? [
        {
          key: 'start',
          label: 'Date de début retenue',
          type: 'date',
          value: dateAnswer(sourceAnswer(row, source, 'start')) ?? '',
          required: false,
        },
        {
          key: 'end',
          label: 'Date de fin retenue',
          type: 'date',
          value: dateAnswer(sourceAnswer(row, source, 'end')) ?? '',
          required: false,
        },
        ...(source.family === 'contact'
          ? [
              {
                key: 'contactReceived',
                label: 'Confirmer la réception de la fiche contact',
                type: 'checkbox' as const,
                value: true,
              },
            ]
          : []),
      ]
    : []
  return {
    kind:
      contact || source.family === 'bilan_etablissement'
        ? 'school'
        : source.family === 'accord_formateur'
          ? 'trainer'
          : 'adult',
    title: contact ? 'Corriger les dates et la réception' : 'Reporter la réception vérifiée',
    targetKind: source.family === 'accord_formateur' ? 'trainer' : 'school',
    fields,
    message: contact
      ? 'Choisissez le dossier annuel, puis les dates à retenir. Aucun statut ne change.'
      : 'Le nom, l’e-mail et le dossier devront correspondre exactement. La date vient de la réponse originale, pas de la date du jour.',
  }
}
export const correctionFieldLabels: Record<string, string> = {
  date_debut_formation: 'Début de formation',
  date_fin_formation: 'Fin de formation',
  fiche_contact_recue: 'Fiche contact reçue',
  date_pre_recu: 'Réception préformation',
  date_post_recu: 'Réception postformation',
  date_suivi_recu: 'Réception suivi à 45 jours',
  date_bilan_etablissement_recu: 'Réception bilan établissement',
  date_evaluation_recu: 'Réception évaluation',
  accord_signe: 'Accord signé',
  date_accord: 'Date de l’accord',
  notes: 'Dates dans les informations de suivi',
}
export type CorrectionPlan = {
  version: 1
  journalId: number
  sourceKey: string
  sourceVersion: string
  sourceHash: string
  sourceRaw: string
  sourceConfig: CorrectionSource
  family: CorrectionFamily
  target: ReviewTarget
  actor: string
  reason: string
  at: string
  expiresAt: string
  plan: PersonPlan
  changes: { label: string; before: unknown; after: unknown }[]
  title: string
}
export async function readCorrectionRow(
  client: CorrectionClient,
  table: string,
  id: number,
): Promise<GoogleRow> {
  const r = await client(`/tables/${table}/records/${id}`)
  if (!r || r.Id !== id) return correctionFail('La fiche demandée ne peut pas être vérifiée.')
  return r
}
async function exactList(client: CorrectionClient, table: string, where: string) {
  const r = await client(`/tables/${table}/records?${new URLSearchParams({ where, limit: '2' })}`)
  if (
    !Array.isArray(r.list) ||
    r.pageInfo?.isLastPage !== true ||
    r.list.length !== 1 ||
    !positiveId(r.list[0].Id)
  )
    return correctionFail(
      'Aucune correspondance unique confirmée. Vérifiez les doublons ou l’identité avant de poursuivre.',
    )
  return r.list[0] as GoogleRow
}
/** Read the complete bounded group, including merge evidence, before choosing its one active dossier. */
export async function activeAnnualDossier(
  client: CorrectionClient,
  table: string,
  relation: string,
  personId: number,
  cohortId: number,
) {
  const rows: GoogleRow[] = [],
    ids = new Set<number>()
  for (;;) {
    const res = await client(
      `/tables/${table}/records?${new URLSearchParams({ where: `(${relation},eq,${personId})~and(cohortes_id,eq,${cohortId})`, limit: '200', offset: String(rows.length) })}`,
    )
    if (
      !Array.isArray(res.list) ||
      res.list.some(
        (r: any) =>
          !positiveId(r.Id) ||
          ids.has(r.Id) ||
          r[relation] !== personId ||
          r.cohortes_id !== cohortId,
      )
    )
      return correctionFail('L’inventaire des dossiers annuels est incomplet.')
    for (const r of res.list) {
      ids.add(r.Id)
      rows.push(r)
    }
    if (res.pageInfo?.isLastPage === true) break
    if (!res.list.length || rows.length >= 1000)
      return correctionFail('L’inventaire des dossiers annuels est incomplet.')
  }
  let active: GoogleRow[]
  try {
    active = reconcilierActifs(rows, [relation, 'cohortes_id'])
  } catch {
    return correctionFail('Les liens de fusion des dossiers doivent être vérifiés.')
  }
  if (active.length !== 1) return correctionFail('Le dossier annuel n’est pas unique.')
  return active[0]
}
export async function planCorrection(input: {
  row: GoogleRow
  source: CorrectionSource
  target: ReviewTarget
  values: Record<string, unknown>
  actor: string
  reason: string
  client: CorrectionClient
  now: string
}): Promise<CorrectionPlan> {
  const { row, source, target, values, actor, reason, client, now } = input
  const raw = correctionAnswers(row)
  if (
    source.headerDigest &&
    (await digest(JSON.stringify(raw.map((a) => a.question)))) !== source.headerDigest
  )
    return correctionFail('Les questions sources ont changé depuis la correspondance vérifiée.')
  const isTrainer = source.family === 'accord_formateur',
    isContact = ['contact', 'organisation'].includes(source.family)
  if (target.kind !== (isTrainer ? 'trainer' : 'school'))
    return correctionFail('Le type de dossier ne correspond pas au formulaire.')
  if (
    Object.keys(values).some(
      (k) =>
        !isContact ||
        !['start', 'end', ...(source.family === 'contact' ? ['contactReceived'] : [])].includes(k),
    )
  )
    return correctionFail('Un champ non autorisé a été demandé.', 400)
  const recordTable = isTrainer ? NC.tables.engagements : NC.tables.participations
  const record = await readCorrectionRow(client, recordTable, target.id)
  const relation = isTrainer ? 'formateurs_id' : 'etablissements_id'
  if (
    !empty(record.fusionne_vers) ||
    !positiveId(record[relation]) ||
    !positiveId(record.cohortes_id)
  )
    return correctionFail('Choisissez un dossier annuel actif avec une cohorte renseignée.')
  const cohort = await readCorrectionRow(client, NC.tables.cohortes, record.cohortes_id)
  const unique = await activeAnnualDossier(
    client,
    recordTable,
    relation,
    record[relation] as number,
    cohort.Id,
  )
  if (unique.Id !== record.Id) return correctionFail('Le dossier annuel n’est pas unique.')
  const personTable = isTrainer ? NC.tables.formateurs : NC.tables.etablissements
  const owner = await readCorrectionRow(client, personTable, record[relation] as number)
  if (!empty(owner.fusionne_vers))
    return correctionFail('Cette fiche a été fusionnée ; choisissez son dossier actif.')
  const declaredSchool = !isTrainer
    ? source.mapping.establishment
      ? sourceAnswer(row, source, 'establishment')
      : isContact && source.mapping.name
        ? sourceAnswer(row, source, 'name')
        : ''
    : ''
  if (declaredSchool && norm(declaredSchool) !== norm(owner.nom))
    return correctionFail(
      'L’établissement déclaré contredit le dossier choisi. Une correspondance explicite doit être vérifiée avant correction.',
    )
  const declaredYear = source.mapping.cohort ? sourceAnswer(row, source, 'cohort') : ''
  if (declaredYear) {
    const years = declaredYear.match(/\d{4}/g)
    if (
      !years ||
      years.length !== 2 ||
      Number(years[0]) !== Number(cohort.annee_debut) ||
      Number(years[1]) !== Number(cohort.annee_fin)
    )
      return correctionFail(
        'L’année déclarée ne correspond pas au dossier choisi. Le choix manuel ne remplace que les années absentes.',
      )
  }
  const guard: PersonPlan['guard'] = [
    {
      table: recordTable,
      id: record.Id,
      fields: pick(record, [relation, 'cohortes_id', 'fusionne_vers']),
    },
    {
      table: NC.tables.cohortes,
      id: cohort.Id,
      fields: pick(cohort, ['nom', 'annee_debut', 'annee_fin']),
    },
    {
      table: personTable,
      id: owner.Id,
      fields: pick(owner, ['nom', ...(isTrainer ? ['prenom', 'email'] : []), 'fusionne_vers']),
    },
  ]
  const before: Record<string, unknown> = {},
    after: Record<string, unknown> = {}
  const set = (key: string, v: unknown, r: Record<string, unknown> = record) => {
    before[key] = r[key] ?? null
    after[key] = v
  }
  let table = recordTable as string,
    targetId = record.Id
  if (isContact) {
    for (const key of ['start', 'end'] as const)
      if (values[key] !== undefined && values[key] !== '') {
        if (!isoDate(values[key])) return correctionFail('Une date retenue est invalide.', 400)
        const year = Number(String(values[key]).slice(0, 4))
        if (
          !Number.isInteger(cohort.annee_debut) ||
          !Number.isInteger(cohort.annee_fin) ||
          year < Number(cohort.annee_debut) ||
          year > Number(cohort.annee_fin)
        )
          return correctionFail('Les dates retenues sont hors de la cohorte choisie.')
        set(key === 'start' ? 'date_debut_formation' : 'date_fin_formation', values[key])
      }
    if (values.contactReceived !== undefined) {
      if (values.contactReceived !== true)
        return correctionFail(
          'Cette action confirme une réception ; elle ne permet pas de l’effacer.',
          400,
        )
      set('fiche_contact_recue', true)
    }
    const start = after.date_debut_formation ?? record.date_debut_formation,
      end = after.date_fin_formation ?? record.date_fin_formation
    if (start && end && String(start) > String(end))
      return correctionFail('La fin doit être postérieure ou égale au début.')
    // Preserve the full provenance block. The two representations of dates must agree.
    if (
      Object.hasOwn(after, 'date_debut_formation') ||
      Object.hasOwn(after, 'date_fin_formation')
    ) {
      if (record.notes != null && typeof record.notes !== 'string')
        return correctionFail(
          'Les informations historiques doivent être vérifiées avant correction.',
        )
      const notes = String(record.notes ?? '')
      let projection
      try {
        projection = readContact(notes)
      } catch {
        return correctionFail(
          'Le bloc de suivi historique est invalide ; aucune date ne sera écrasée.',
        )
      }
      if (projection) {
        if (Object.hasOwn(after, 'date_debut_formation'))
          projection.formation.start = String(after.date_debut_formation)
        if (Object.hasOwn(after, 'date_fin_formation'))
          projection.formation.end = String(after.date_fin_formation)
        // Other warnings and source declarations remain untouched, even after a date decision.
        set('notes', writeContact(notes, projection))
      }
    }
    guard.push({
      table: recordTable,
      id: record.Id,
      fields: pick(record, [
        'statut',
        'statut_formation',
        ...['date_debut_formation', 'date_fin_formation'].filter((k) => !Object.hasOwn(after, k)),
      ]),
    })
  } else {
    const noName = ['evaluation', 'bilan_etablissement'].includes(source.family)
    if (noName) {
      const schoolName = sourceAnswer(row, source, 'establishment')
      const schools = await client(`/tables/${NC.tables.etablissements}/records?limit=1000`)
      if (
        !Array.isArray(schools.list) ||
        schools.pageInfo?.isLastPage !== true ||
        schools.list.filter((s: any) => norm(s.nom) === norm(schoolName) && empty(s.fusionne_vers))
          .length !== 1 ||
        norm(owner.nom) !== norm(schoolName)
      )
        return correctionFail(
          'Le nom d’établissement déclaré ne correspond pas de manière unique au dossier choisi.',
        )
    }
    const submittedEmail = sourceAnswer(row, source, 'email').toLowerCase()
    const submittedName = source.mapping.name
      ? sourceAnswer(row, source, 'name')
      : `${sourceAnswer(row, source, 'firstName')} ${sourceAnswer(row, source, 'lastName')}`.trim()
    if (
      !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(submittedEmail) ||
      (!noName && !submittedName)
    )
      return correctionFail('L’e-mail et le nom complets de la réponse doivent être disponibles.')
    const received = sourceDate(row),
      isSchool = source.family === 'bilan_etablissement',
      emailFields = isSchool
        ? ['referent_email', 'email_direction', 'email_institutionnel', 'email_logistique']
        : isTrainer
          ? ['email']
          : ['email', 'email_2']
    const person = await exactList(
      client,
      isSchool
        ? NC.tables.etablissements
        : isTrainer
          ? NC.tables.formateurs
          : OPERATIONAL_ADULTS_TABLE,
      emailFields.map((k) => `(${k},eq,${submittedEmail})`).join('~or'),
    )
    if (
      !emailFields.some((k) => norm(person[k]) === submittedEmail) ||
      (!noName &&
        ![
          norm(`${person.prenom ?? ''} ${person.nom ?? ''}`),
          norm(`${person.nom ?? ''} ${person.prenom ?? ''}`),
        ].includes(norm(submittedName)))
    )
      return correctionFail(
        'Le nom et l’e-mail ne correspondent pas exactement. Aucune identité ne sera modifiée.',
      )
    if (isTrainer || isSchool ? person.Id !== owner.Id : person.participations_id !== record.Id)
      return correctionFail(
        'La personne ne relève pas du dossier annuel choisi. Aucun déplacement n’est autorisé.',
      )
    guard.push({
      table: isSchool
        ? NC.tables.etablissements
        : isTrainer
          ? NC.tables.formateurs
          : OPERATIONAL_ADULTS_TABLE,
      id: person.Id,
      fields: pick(person, [
        'nom',
        'prenom',
        ...emailFields,
        ...(isTrainer || isSchool ? [] : ['participations_id']),
      ]),
    })
    if (isSchool) {
      set('date_bilan_etablissement_recu', received)
    } else if (isTrainer) {
      if (sourceAnswer(row, source, 'agreement') !== source.agreementAnswer)
        return correctionFail('L’accord doit être explicitement affirmatif dans la réponse Google.')
      const signed = dateAnswer(sourceAnswer(row, source, 'agreementDate'))
      if (!signed || signed > received)
        return correctionFail('La date d’accord est absente ou postérieure à la réponse.')
      if (![null, undefined, false, true, 0, 1].includes(record.accord_signe as any))
        return correctionFail('La case accord existante doit être vérifiée.')
      set('accord_signe', true)
      set('date_accord', signed)
    } else {
      table = OPERATIONAL_ADULTS_TABLE
      targetId = person.Id
      const field = {
        preformation: 'date_pre_recu',
        postformation: 'date_post_recu',
        suivi_j45: 'date_suivi_recu',
        evaluation: 'date_evaluation_recu',
      }[source.family as 'preformation' | 'postformation' | 'suivi_j45' | 'evaluation']
      if (!field) return correctionFail('Famille de réception non prise en charge.')
      // Use the existing Google planner for preformation; the normalized adapter is
      // private and explicitly records human dossier selection without altering raw answers.
      if (
        source.family === 'preformation' &&
        (empty(person[field]) || person[field] === received)
      ) {
        const headers = ['timestamp', 'email', 'name', 'cohort', 'school']
        const planned = await planGooglePerson(
          {
            family: 'preformation_a',
            headerDigest: await digest(JSON.stringify(headers)),
            mapping: {
              timestamp: 'timestamp',
              email: 'email',
              name: 'name',
              cohort: 'cohort',
              establishment: 'school',
            },
            captureOnly: [],
            tables: { people: table, records: recordTable },
            cohorts: [
              {
                id: cohort.Id,
                answer: String(cohort.Id),
                establishments: [
                  { answer: String(owner.Id), participationId: record.Id, schoolId: owner.Id },
                ],
              },
            ],
            createMissingAdults: false,
          },
          headers,
          [received, submittedEmail, submittedName, String(cohort.Id), String(owner.Id)],
          `${received}T12:00:00+02:00`,
          (path) => client('/' + path),
        )
        if (planned.state !== 'planned' || planned.plan.create || planned.plan.id !== person.Id)
          return correctionFail(
            'La projection Google ne confirme pas cet adulte. Aucune création automatique depuis cette correction.',
          )
      }
      set(field, received, person)
    }
  }
  if (!Object.keys(after).length)
    return correctionFail('Choisissez au moins une correction à vérifier.', 400)
  // Gate the actual destination column types, particularly the new evaluation date.
  const meta = await client(`/meta/tables/${table}`)
  for (const key of Object.keys(after)) {
    const expected =
      key === 'notes'
        ? 'LongText'
        : key === 'fiche_contact_recue' || key === 'accord_signe'
          ? 'Checkbox'
          : 'Date'
    if (
      !Array.isArray(meta.columns) ||
      meta.columns.filter((c: any) => c.title === key && c.uidt === expected).length !== 1
    )
      return correctionFail(
        'Le schéma de réception n’est pas prêt ; aucune écriture autorisée.',
        503,
      )
  }
  const noteDates = (value: unknown) => {
    const c = readContact(String(value ?? ''))
    return c
      ? `Début : ${c.formation.start ?? 'non renseigné'} ; fin : ${c.formation.end ?? 'non renseignée'}. Autres informations conservées.`
      : 'Aucune date structurée'
  }
  const changes = Object.keys(after)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({
      label: correctionFieldLabels[k] ?? k,
      before: k === 'notes' ? noteDates(before[k]) : before[k],
      after: k === 'notes' ? noteDates(after[k]) : after[k],
    }))
  return {
    version: 1,
    journalId: row.Id,
    sourceKey: String(row.cle_reponse),
    sourceVersion: await reviewVersion(row),
    sourceHash: await digest(String(row.reponses)),
    sourceRaw: String(row.reponses),
    sourceConfig: source,
    family: source.family,
    target,
    actor,
    reason,
    at: now,
    expiresAt: new Date(Date.parse(now) + 15 * 60000).toISOString(),
    title: String(correctionOptions(row, [source]).title),
    plan: {
      family: isTrainer ? 'accord_formateur' : 'preformation_a',
      table,
      id: targetId,
      before,
      after,
      guard,
      remaining: true,
    },
    changes,
  }
}
