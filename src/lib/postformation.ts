import { emailValide } from './forms'
import { hashOperational, operationalRequest } from './operational-data'
import { OperationalLinkError } from './operational-links'
import type { SubmissionDatabase } from './candidature-store'
import type { PersonProjectionConfig } from './google-form-person'
import { postformationDefinitions, type PostformationDefinition } from './postformation-definition'
import {
  initializePostformationProjection,
  projectPostformation,
  readPostformationProjection,
} from './postformation-projection'

export type PostformationAnswers = Record<string, string | string[]>
const invalid = () =>
  new OperationalLinkError(
    400,
    'champs',
    'Vérifiez les champs obligatoires et les choix du formulaire.',
  )
export function parsePostformation(
  def: PostformationDefinition,
  value: unknown,
): PostformationAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const fields = value as Record<string, unknown>,
    answers: PostformationAnswers = {}
  const allowed = def.questions.flatMap((q) => [q.key, ...(q.other ? [`${q.key}Other`] : [])])
  if (Object.keys(fields).some((k) => !allowed.includes(k))) throw invalid()
  for (const q of def.questions) {
    const raw = fields[q.key] ?? (q.type === 'checkbox' ? [] : '')
    if (q.type === 'checkbox') {
      if (
        !Array.isArray(raw) ||
        (q.required && !raw.length) ||
        raw.length > q.choices.length ||
        raw.some((v) => typeof v !== 'string' || !q.choices.includes(v)) ||
        new Set(raw).size !== raw.length
      )
        throw invalid()
      answers[q.key] = q.choices.filter((choice) => raw.includes(choice))
      continue
    }
    if (
      typeof raw !== 'string' ||
      raw.length > q.maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)
    )
      throw invalid()
    let text = raw.normalize('NFC').trim().replace(/\r\n?/g, '\n')
    if ((q.required && !text) || (q.type !== 'textarea' && /[\n\t]/.test(text))) throw invalid()
    if (q.type === 'radio' && text && !q.choices.includes(text)) throw invalid()
    if (q.key === 'email') {
      text = text.toLowerCase()
      if (!emailValide(text)) throw invalid()
    }
    if (q.key === 'year') {
      text = text.replace(/[–—]/g, '-')
      if (!/^20\d{2}-20\d{2}$/.test(text) || Number(text.slice(5)) !== Number(text.slice(0, 4)) + 1)
        throw invalid()
    }
    answers[q.key] = text
    if (q.other) {
      const other = fields[`${q.key}Other`] ?? ''
      if (typeof other !== 'string' || other.length > 5000 || /[\u0000-\u001f\u007f]/.test(other))
        throw invalid()
      const normalized = other.normalize('NFC').trim()
      if ((text === 'Autre :' && !normalized) || (text !== 'Autre :' && normalized)) throw invalid()
      answers[`${q.key}Other`] = normalized
    }
  }
  return answers
}

/** Source must be durably stored and read back before any business projection. */
export async function receivePostformation(input: {
  db: SubmissionDatabase
  token: string
  table: string
  definition: PostformationDefinition
  answers: PostformationAnswers
  personProjection: PersonProjectionConfig
}) {
  const { db, token, table, definition: def, personProjection } = input
  const answers = parsePostformation(def, input.answers)
  const source = {
    schema: def.version,
    kind: def.kind,
    answers: def.questions.flatMap((q) => [
      { key: q.key, label: q.label, value: answers[q.key] },
      ...(q.other
        ? [{ key: `${q.key}Other`, label: `${q.label} — Autre :`, value: answers[`${q.key}Other`] }]
        : []),
    ]),
  }
  const receipt = await hashOperational(JSON.stringify(source))
  const claim = await db
    .prepare('INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash) VALUES (?,?,?)')
    .bind(receipt, def.kind, receipt)
    .run()
  const registered = await initializePostformationProjection(db, receipt, personProjection)
  const fields = {
    cle_reponse: receipt,
    formulaire: def.title,
    etablissement: answers.school,
    annee_scolaire: answers.year,
    referent_email: answers.email,
    reponses: JSON.stringify({ ...source, receivedAt: registered.received_at }),
    source_url: `https://euneos.fr/suivi/${def.slug}`,
  }
  const lookup = (await operationalRequest(
    token,
    `/tables/${table}/records?${new URLSearchParams({ where: `(cle_reponse,eq,${receipt})`, limit: '2' })}`,
  )) as { list: Record<string, unknown>[] }
  if (!Array.isArray(lookup.list) || lookup.list.length > 1)
    throw new Error('Ambiguous questionnaire receipt')
  let record = lookup.list[0]
  if (!record) {
    const owned = await db
      .prepare(
        'UPDATE public_form_receipts SET capture_started=1 WHERE receipt=? AND capture_started=0 AND noco_id IS NULL',
      )
      .bind(receipt)
      .run()
    if (owned.meta.changes !== 1)
      return { state: 'processing', code: 'capture_pending', duplicate: true }
    const result = (await operationalRequest(token, `/tables/${table}/records`, 'POST', [
      { ...fields, statut_reprise: 'À rapprocher', detail_reprise: 'projection_pending' },
    ])) as { Id: number } | { Id: number }[]
    const id = Array.isArray(result) ? result[0]?.Id : result?.Id
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid receipt')
    record = (await operationalRequest(token, `/tables/${table}/records/${id}`)) as Record<
      string,
      unknown
    >
  }
  if (
    !Number.isSafeInteger(record.Id) ||
    Number(record.Id) <= 0 ||
    Object.entries(fields).some(([k, v]) => record[k] !== v)
  )
    throw new Error('Questionnaire readback mismatch')
  await db
    .prepare('UPDATE public_form_receipts SET noco_id=? WHERE receipt=?')
    .bind(Number(record.Id), receipt)
    .run()
  const projected = await projectPostformation({
    ...input,
    receipt,
    answers,
    config: personProjection,
  })
  if (projected.state === 'complete' || projected.state === 'review') {
    const verified = projected.state === 'complete'
    await db
      .prepare('UPDATE public_form_receipts SET state=?,code=?,target_id=? WHERE receipt=?')
      .bind(verified ? 'complete' : 'review', projected.code, projected.participation_id, receipt)
      .run()
    // Journal is append-only after capture. Do not overwrite notes/statuses
    // concurrently edited by the team or Google. D1 carries projection proof.
  }
  // Identical public result for a confirmed identity and a pending private case.
  return ['complete', 'review'].includes(projected.state)
    ? { state: 'complete', code: 'received', duplicate: claim.meta.changes !== 1 }
    : { state: 'processing', code: 'processing', duplicate: claim.meta.changes !== 1 }
}

/** Call only after internal authentication. Catalogue integration is a parent hook. */
const pendingReasons: Record<string, string> = {
  identity_unresolved: 'L’adulte n’a pas été retrouvé avec cette adresse.',
  identity_conflict: 'Le nom et l’identité retrouvée ne concordent pas.',
  identity_not_unique: 'Plusieurs personnes sont possibles ou la recherche est incomplète.',
  cohort_unresolved: 'L’année scolaire doit être rapprochée par l’équipe.',
  establishment_unresolved:
    'Le rattachement de cet établissement pour cette année reste à confirmer.',
  cohort_conflict:
    'La relation entre l’adulte, l’établissement et l’année scolaire est à vérifier.',
  existing_value_conflict: 'Une information existante diffère et a été conservée.',
  receipt_already_claimed:
    'Une autre réponse est déjà en cours de vérification pour cette réception.',
  business_write_uncertain:
    'Le résultat de la mise à jour doit être vérifié avant toute nouvelle modification.',
  projection_configuration_changed: 'Les règles de rattachement ont changé depuis la réception.',
  receipt_field_unavailable: 'La date de réception n’est pas disponible dans la fiche adulte.',
  projection_read_unavailable:
    'La lecture de la base est temporairement indisponible ; vérification à reprendre.',
}
export async function postformationPublicEntry(
  db: SubmissionDatabase,
  row: Record<string, unknown>,
  source: unknown,
) {
  if (!source || typeof source !== 'object') return null
  const value = source as { schema?: string; answers?: unknown }
  const def = postformationDefinitions.find((d) => d.version === value.schema)
  if (!def) return null
  if (
    !Array.isArray(value.answers) ||
    value.answers.some(
      (a) =>
        !a ||
        typeof a.label !== 'string' ||
        !(
          typeof a.value === 'string' ||
          (Array.isArray(a.value) && a.value.every((v: unknown) => typeof v === 'string'))
        ),
    )
  )
    throw new Error('Invalid private questionnaire')
  const projection = await readPostformationProjection(db, String(row.cle_reponse))
  const verified = projection?.state === 'complete'
  const details: string[][] = value.answers.map((a) => [
    a.label,
    Array.isArray(a.value) ? a.value.join('\n') : a.value,
  ])
  details.push([
    'Réception métier',
    verified
      ? `Adulte #${projection.adult_id} · réception du ${projection.received_date} vérifiée. Le statut de formation est inchangé.`
      : `${pendingReasons[projection?.code ?? ''] ?? 'La réception est en cours de vérification par l’équipe.'} Aucune réception adulte confirmée.`,
  ])
  return {
    school: String(row.etablissement),
    city: String(row.ville ?? ''),
    year: String(row.annee_scolaire),
    form: def.title,
    state: verified ? 'Réception vérifiée sur l’adulte' : 'Réponse reçue — à rapprocher',
    details,
    participationId: verified ? projection.participation_id : null,
  }
}
