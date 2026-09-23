import { NC } from './nocodb'
import {
  CONTACT_OPEN,
  CONTACT_CLOSE,
  isoDate,
  readContact,
  writeContact,
  type ContactProjection,
} from './google-form-contact'

export type OperationalKind = 'contact' | 'deploiement' | 'participants'
export type OperationalTarget = { participationId: number; schoolId: number; cohortId: number }
export type OperationalParticipant = {
  firstName: string
  lastName: string
  email: string
  role: string
}
export type OperationalInput = {
  referrer: { name: string; email: string; phone: string; role: string }
  directionEmail: string
  schoolDetails: { academy: string; address: string; postalCode: string; type: string }
  formation: {
    start: string
    end: string
    format: string
    planning: string
    sessions: number | null
  } | null
  declaredTrainers: { name: string; email: string }[]
  participants: OperationalParticipant[]
  operations: { groupedSchools: boolean | null; associatedSchools: string }
  confirmed: true
  organizationConfirmed: boolean
  changesAcknowledged: boolean
}
const publicMessages: Record<string, string> = {
  invalid_fields: 'Le formulaire contient des champs inconnus ou incomplets.',
  invalid_text:
    'Un texte obligatoire est absent, trop long ou contient des caractères non pris en charge.',
  invalid_email: 'Vérifiez le format des adresses e-mail.',
  invalid_number: 'Les effectifs et nombres de séances doivent être des nombres positifs valides.',
  date_pair_required:
    'Renseignez les deux dates de formation, ou laissez-les toutes les deux vides.',
  invalid_format: 'Choisissez Présentiel ou Hybride.',
  invalid_school_type: 'Choisissez un type d’établissement proposé.',
  sessions_required: 'Indiquez au moins une session prévue.',
  trainer_required: 'Indiquez le nom et l’e-mail du formateur déclaré.',
  grouping_required: 'Précisez si d’autres établissements participent à cette formation.',
  invalid_date: 'Renseignez des dates valides au format AAAA-MM-JJ.',
  date_order: 'La date de fin doit être postérieure ou égale à la date de début.',
  participants_required: 'Ajoutez au moins un participant avec son prénom et son nom.',
  participants_ambiguous:
    'Des participants ont des identités ou adresses e-mail contradictoires. Une vérification par l’équipe est nécessaire.',
  confirmation_required: 'Confirmez les informations et les engagements demandés.',
  input_too_large: 'Le formulaire contient trop de texte ou de participants.',
  read_failed: 'Le service est momentanément indisponible. Conservez votre saisie.',
  write_uncertain:
    'La réception nécessite une vérification par l’équipe. Ne renvoyez pas le formulaire.',
}
export class OperationalDataError extends Error {
  constructor(
    public code: string,
    public status = 400,
    message = publicMessages[code] ??
      'Les informations du formulaire sont invalides ou incomplètes.',
  ) {
    super(message)
    this.name = 'OperationalDataError'
  }
}
export const OperationalError = OperationalDataError
function fail(code: string): never {
  throw new OperationalError(code, code === 'read_failed' || code === 'write_uncertain' ? 503 : 400)
}
export const validId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const object = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v))
function shape(v: unknown, keys: string[], optional = false): Record<string, unknown> {
  if (v === undefined && optional) return {}
  if (!object(v) || Object.keys(v).some((k) => !keys.includes(k))) fail('invalid_fields')
  return v
}
function text(v: unknown, max = 500, required = false): string {
  if (v === undefined || v === null) v = ''
  if (typeof v !== 'string') fail('invalid_text')
  const s = v.normalize('NFC').trim()
  if (
    (required && !s) ||
    s.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ||
    s.includes(CONTACT_OPEN) ||
    s.includes(CONTACT_CLOSE)
  )
    fail('invalid_text')
  return s
}
function email(v: unknown, required = false) {
  const s = text(v, 254, required).toLowerCase()
  if (s && !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s)) fail('invalid_email')
  return s
}
function count(v: unknown, max = 100000, integer = true): number | null {
  if (v === '' || v === undefined || v === null) return null
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v < 0 ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    fail('invalid_number')
  return v
}
function date(v: unknown, required = false) {
  const s = text(v, 10, required)
  if (s && !isoDate(s)) fail('invalid_date')
  return s
}
function array(v: unknown, max: number): unknown[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > max) fail('invalid_list')
  return v
}
// Identity matching deliberately keeps accents and punctuation: never fuzzy.
export const identityText = (s: unknown) =>
  String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr')
export const statusText = (s: unknown) =>
  identityText(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
export function parseOperationalInput(raw: unknown, kind: OperationalKind): OperationalInput {
  if (!['contact', 'deploiement', 'participants'].includes(kind)) fail('invalid_kind')
  const r = shape(raw, [
    'referrer',
    'directionEmail',
    'schoolDetails',
    'formation',
    'declaredTrainers',
    'participants',
    'operations',
    'confirmed',
    'organizationConfirmed',
    'changesAcknowledged',
  ])
  if (JSON.stringify(r).length > 65000) fail('input_too_large')
  const ref = shape(r.referrer, ['name', 'email', 'phone', 'role'])
  const school = shape(r.schoolDetails, ['academy', 'address', 'postalCode', 'type'], true)
  const op = shape(r.operations, ['groupedSchools', 'associatedSchools'], true)
  let formation: OperationalInput['formation'] = null
  if (kind !== 'participants') {
    const f = shape(r.formation, ['start', 'end', 'format', 'planning', 'sessions'])
    formation = {
      start: date(f.start, kind === 'contact'),
      end: date(f.end, kind === 'contact'),
      format: text(f.format, 500, true),
      planning: text(f.planning, 10000, kind === 'deploiement'),
      sessions: count(f.sessions, 1000),
    }
    if (!!formation.start !== !!formation.end) fail('date_pair_required')
    if (formation.start && formation.end < formation.start) fail('date_order')
    if (!['Présentiel', 'Hybride'].includes(formation.format)) fail('invalid_format')
    if (kind === 'deploiement' && (!formation.sessions || formation.sessions < 1))
      fail('sessions_required')
  } else if (r.formation !== undefined && r.formation !== null) fail('unexpected_formation')
  const participants = array(r.participants, 200).map((p) => {
    const a = shape(p, ['firstName', 'lastName', 'email', 'role'])
    return {
      firstName: text(a.firstName, 150, true),
      lastName: text(a.lastName, 150, true),
      email: email(a.email),
      role: text(a.role, 250),
    }
  })
  if (kind === 'participants' && !participants.length) fail('participants_required')
  const names = new Set<string>(),
    emails = new Set<string>()
  for (const p of participants) {
    const name = `${identityText(p.firstName)}\0${identityText(p.lastName)}`
    if (names.has(name) || (p.email && emails.has(p.email))) fail('participants_ambiguous')
    names.add(name)
    if (p.email) emails.add(p.email)
  }
  participants.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const declaredTrainers = array(r.declaredTrainers, 20)
    .map((t) => {
      const trainer = shape(t, ['name', 'email'])
      return {
        name: text(trainer.name, 300, true),
        email: email(trainer.email, kind === 'deploiement'),
      }
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (kind === 'deploiement' && !declaredTrainers.length) fail('trainer_required')
  if (
    r.confirmed !== true ||
    (kind === 'deploiement' && (r.organizationConfirmed !== true || r.changesAcknowledged !== true))
  )
    fail('confirmation_required')
  if (
    (r.organizationConfirmed !== undefined && typeof r.organizationConfirmed !== 'boolean') ||
    (r.changesAcknowledged !== undefined && typeof r.changesAcknowledged !== 'boolean')
  )
    fail('invalid_confirmation')
  if (
    op.groupedSchools !== undefined &&
    op.groupedSchools !== null &&
    typeof op.groupedSchools !== 'boolean'
  )
    fail('invalid_grouping')
  if (kind === 'contact' && typeof op.groupedSchools !== 'boolean') fail('grouping_required')
  const operations: OperationalInput['operations'] = {
    groupedSchools: op.groupedSchools === true ? true : op.groupedSchools === false ? false : null,
    associatedSchools: text(op.associatedSchools, 3000),
  }
  const schoolDetails = {
    academy: text(school.academy, 500, kind === 'contact'),
    address: text(school.address, 1000, kind === 'contact'),
    postalCode: text(school.postalCode, 30, kind === 'contact'),
    type: text(school.type, 500, kind === 'contact'),
  }
  if (
    kind === 'contact' &&
    ![
      'École primaire',
      'Collège',
      'Lycée général et technologique',
      'Lycée professionnel',
      'Autre',
    ].includes(schoolDetails.type)
  )
    fail('invalid_school_type')
  return {
    referrer: {
      name: text(ref.name, 300, true),
      email: email(ref.email, true),
      phone: text(ref.phone, 60),
      role: text(ref.role, 250),
    },
    directionEmail: email(r.directionEmail, kind === 'contact'),
    schoolDetails,
    formation,
    declaredTrainers,
    participants,
    operations,
    confirmed: true,
    organizationConfirmed: r.organizationConfirmed === true,
    changesAcknowledged: r.changesAcknowledged === true,
  }
}

export const OPERATIONAL_ADULTS_TABLE = 'mzbpzuikti6h3pz'
const API = 'https://app.nocodb.com/api/v2'
export type OperationalRow = Record<string, unknown> & { Id: number }
export async function operationalRequest(
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<unknown> {
  try {
    const response = await fetch(API + path, {
      method,
      headers: { 'xc-token': token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) fail(method === 'GET' ? 'read_failed' : 'write_uncertain')
    return await response.json()
  } catch {
    return fail(method === 'GET' ? 'read_failed' : 'write_uncertain')
  }
}
async function row(token: string, table: string, id: number) {
  const value = await operationalRequest(token, `/tables/${table}/records/${id}`)
  if (!object(value) || value.Id !== id) fail('target_invalid')
  return value as OperationalRow
}
export function validateOperationalTarget(target: OperationalTarget) {
  if (
    !target ||
    !validId(target.participationId) ||
    !validId(target.schoolId) ||
    !validId(target.cohortId)
  )
    fail('target_invalid')
}
export type OperationalSnapshot = {
  participation: OperationalRow
  school: OperationalRow
  cohort: OperationalRow
}
export async function readOperationalSnapshot(
  token: string,
  target: OperationalTarget,
): Promise<OperationalSnapshot> {
  validateOperationalTarget(target)
  const [participation, school, cohort] = await Promise.all([
    row(token, NC.tables.participations, target.participationId),
    row(token, NC.tables.etablissements, target.schoolId),
    row(token, NC.tables.cohortes, target.cohortId),
  ])
  if (
    participation.fusionne_vers != null ||
    school.fusionne_vers != null ||
    cohort.fusionne_vers != null
  )
    fail('target_archived')
  if (
    participation.etablissements_id !== target.schoolId ||
    participation.cohortes_id !== target.cohortId
  )
    fail('target_mismatch')
  if (
    [
      'abandonne',
      'abandonnee',
      'annule',
      'annulee',
      'refuse',
      'refusee',
      'archive',
      'archivee',
    ].includes(statusText(participation.statut))
  )
    fail('target_inactive')
  if (cohort.active !== true && cohort.active !== 1) fail('cohort_inactive')
  if (typeof school.nom !== 'string' || !school.nom.trim()) fail('target_invalid')
  for (const key of ['annee_debut', 'annee_fin']) {
    const value = cohort[key]
    if (!/^[0-9]{4}(?:\.0)?$/.test(String(value)) || !Number.isInteger(Number(value)))
      fail('cohort_invalid')
    cohort[key] = Number(value)
  }
  if (Number(cohort.annee_fin) < Number(cohort.annee_debut)) fail('cohort_invalid')
  if (participation.notes != null && typeof participation.notes !== 'string') fail('notes_invalid')
  if (typeof participation.notes === 'string' && participation.notes.length > 190000)
    fail('notes_capacity')
  return { participation, school, cohort }
}
export async function readOperationalContext(
  token: string,
  target: OperationalTarget,
): Promise<{ schoolName: string; city: string; cohortLabel: string }> {
  const { school, cohort } = await readOperationalSnapshot(token, target)
  return {
    schoolName: String(school.nom),
    city: String(school.ville ?? ''),
    cohortLabel:
      typeof cohort.nom === 'string' && cohort.nom.trim()
        ? cohort.nom
        : `${cohort.annee_debut}–${cohort.annee_fin}`,
  }
}
export async function readOperationalAdults(
  token: string,
  targetId: number,
): Promise<OperationalRow[]> {
  const results: OperationalRow[] = [],
    seen = new Set<number>()
  const fields = 'Id,adulte_id,nom,prenom,email,fonction,statut,participations_id'
  for (;;) {
    const page = await operationalRequest(
      token,
      `/tables/${OPERATIONAL_ADULTS_TABLE}/records?limit=200&offset=${results.length}&fields=${fields}&where=${encodeURIComponent(`(participations_id,eq,${targetId})`)}`,
    )
    if (!object(page) || !Array.isArray(page.list)) fail('read_failed')
    for (const item of page.list) {
      if (
        !object(item) ||
        !validId(item.Id) ||
        seen.has(item.Id) ||
        item.participations_id !== targetId
      )
        fail('adults_scope_invalid')
      seen.add(item.Id)
      results.push(item as OperationalRow)
    }
    if (object(page.pageInfo) && page.pageInfo.isLastPage === true) break
    if (!page.list.length) {
      if (object(page.pageInfo) && page.pageInfo.isLastPage === false) fail('read_failed')
      break
    }
    if (results.length >= 10000) fail('adults_limit')
  }
  return results.sort((a, b) => a.Id - b.Id)
}
export function planOperationalAdults(
  participants: OperationalParticipant[],
  adults: OperationalRow[],
) {
  const existingIds: number[] = [],
    create: OperationalParticipant[] = []
  for (const p of participants) {
    const name = (a: OperationalRow) =>
      identityText(a.prenom) === identityText(p.firstName) &&
      identityText(a.nom) === identityText(p.lastName)
    const candidates = adults.filter(
      (a) => name(a) || (p.email && identityText(a.email) === p.email),
    )
    if (
      candidates.length > 1 ||
      (candidates.length === 1 &&
        (!name(candidates[0]) ||
          (p.email && candidates[0].email && identityText(candidates[0].email) !== p.email)))
    )
      fail('participants_ambiguous')
    if (candidates.length) existingIds.push(candidates[0].Id)
    else create.push(p)
  }
  return { existingIds, create }
}
export function operationalFingerprint(
  snapshot: OperationalSnapshot,
  adults: OperationalRow[],
): string {
  const p = snapshot.participation
  return JSON.stringify({
    fields: [
      p.Id,
      p.etablissements_id,
      p.cohortes_id,
      p.fusionne_vers ?? null,
      p.statut ?? null,
      p.fiche_contact_recue ?? null,
      p.date_debut_formation ?? null,
      p.date_fin_formation ?? null,
      p.statut_formation ?? null,
      p.notes ?? '',
    ],
    cohort: [snapshot.cohort.active, snapshot.cohort.annee_debut, snapshot.cohort.annee_fin],
    adults: adults.map((a) => [
      a.Id,
      a.adulte_id,
      a.prenom,
      a.nom,
      a.email,
      a.fonction,
      a.statut,
      a.participations_id,
    ]),
  })
}
function readOperationalContact(notes: string): ContactProjection | null {
  try {
    return readContact(notes)
  } catch {
    return fail('notes_invalid')
  }
}
export function operationalReviewCodes(
  snapshot: OperationalSnapshot,
  data: OperationalInput,
  kind: OperationalKind,
): string[] {
  const p = snapshot.participation,
    notes = readOperationalContact(String(p.notes ?? '')),
    codes: string[] = []
  if (notes?.formation.issues.length) codes.push('historical_issues')
  if (Array.isArray(notes?.operationalReview) && notes.operationalReview.length)
    codes.push('pending_team_review')
  if (data.formation) {
    const { start, end } = data.formation
    if (
      [start, end]
        .filter(Boolean)
        .some(
          (d) =>
            Number(d.slice(0, 4)) < Number(snapshot.cohort.annee_debut) ||
            Number(d.slice(0, 4)) > Number(snapshot.cohort.annee_fin),
        )
    )
      codes.push('dates_outside_cohort')
    if (
      (start && p.date_debut_formation && p.date_debut_formation !== start) ||
      (end && p.date_fin_formation && p.date_fin_formation !== end)
    )
      codes.push('dates_conflict')
    if (
      notes &&
      ((start && notes.formation.start && notes.formation.start !== start) ||
        (end && notes.formation.end && notes.formation.end !== end))
    )
      codes.push('source_dates_conflict')
    const status = statusText(p.statut_formation)
    if (status && !['previsionnelle', 'programmee', 'a preciser'].includes(status))
      codes.push('formation_status_review')
    if (kind === 'contact' && notes?.formation.kind === 'deploiement' && status !== 'programmee')
      codes.push('deployment_already_declared')
  }
  return [...new Set(codes)]
}
export function buildOperationalPatch(input: {
  snapshot: OperationalSnapshot
  kind: OperationalKind
  data: OperationalInput
  receipt: string
  now: string
  adultIds: number[]
  reviewCodes: string[]
}): Record<string, unknown> {
  const { snapshot, kind, data, receipt, now, adultIds, reviewCodes } = input,
    p = snapshot.participation
  const original = String(p.notes ?? ''),
    previous = readOperationalContact(original)
  // The shared reader accepts the site source union; legacy provenance remains intact.
  const projection: ContactProjection = previous
    ? structuredClone(previous)
    : {
        version: 1,
        source: { kind: 'site', receipt, readAt: now },
        receivedAt: null,
        formation: {
          start: null,
          end: null,
          kind: 'previsionnelle',
          format: '',
          planning: '',
          issues: [],
        },
        declaredTrainers: [],
        participants: { declared: '', unresolved: [], importedCount: 0 },
      }
  const history = projection.operationalSubmissions
  if (history !== undefined && (!Array.isArray(history) || history.length >= 50))
    fail('notes_capacity')
  projection.operationalSubmissions = [
    ...(Array.isArray(history) ? history : []),
    { receipt, receivedAt: now, kind, data, reviewCodes, adultIds },
  ]
  const patch: Record<string, unknown> = { Id: p.Id }
  if (kind === 'contact') {
    projection.receivedAt ??= now
    patch.fiche_contact_recue = true
  }
  if (reviewCodes.length) {
    projection.formation.issues = [
      ...new Set([
        ...projection.formation.issues,
        'Une réponse du site nécessite une validation de l’équipe EUNEOS avant application.',
      ]),
    ]
  }
  if (!reviewCodes.length) {
    if (kind !== 'participants') {
      const f = data.formation!
      const preserveDeployment =
        kind === 'contact' &&
        (projection.formation.kind === 'deploiement' ||
          statusText(p.statut_formation) === 'programmee')
      if (!preserveDeployment)
        projection.formation = {
          ...projection.formation,
          start: f.start || projection.formation.start,
          end: f.end || projection.formation.end,
          format: f.format,
          planning: f.planning,
          kind: kind === 'deploiement' ? 'deploiement' : 'previsionnelle',
        }
      projection.declaredTrainers = [...projection.declaredTrainers]
      for (const trainer of data.declaredTrainers)
        if (
          !projection.declaredTrainers.some(
            (t) => t.name === trainer.name && (t.email ?? '') === trainer.email,
          )
        )
          projection.declaredTrainers.push(trainer)
      if (f.start && f.end) {
        patch.date_debut_formation = f.start
        patch.date_fin_formation = f.end
        patch.statut_formation =
          statusText(p.statut_formation) === 'programmee' || kind === 'deploiement'
            ? 'Programmée'
            : 'Prévisionnelle'
      } else if (!p.statut_formation) patch.statut_formation = 'À préciser'
    }
    // Retain legacy free-text qualifications/unresolved entries until team review.
    projection.participants.importedCount = Math.max(
      projection.participants.importedCount,
      adultIds.length,
    )
    const structured = projection.participants.structured
    if (structured !== undefined && !Array.isArray(structured)) fail('notes_invalid')
    const combined = [...(Array.isArray(structured) ? structured : [])]
    for (const person of data.participants)
      if (
        !combined.some(
          (p) =>
            object(p) &&
            identityText(p.firstName) === identityText(person.firstName) &&
            identityText(p.lastName) === identityText(person.lastName),
        )
      )
        combined.push(person)
    projection.participants.structured = combined
  }
  projection.lastOperationalReceipt = receipt
  projection.operationalReview = reviewCodes
  patch.notes = writeContact(original, projection)
  if (String(patch.notes).length > 190000) fail('notes_capacity')
  return patch
}
export async function hashOperational(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
