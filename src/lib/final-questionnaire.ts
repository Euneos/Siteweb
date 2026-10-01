import { finalQuestionnaireDefinitions } from './final-questionnaire-definition'
import type { FinalConfig } from './final-questionnaire-plan'
import type { SubmissionDatabase } from './candidature-store'
import { hashOperational, operationalRequest } from './operational-data'
import {
  initializeFinalProjection,
  projectFinal,
  readFinalProjection,
} from './final-questionnaire-store'
import { emailValide } from './forms'
import { OperationalLinkError } from './operational-links'
import type { FinalQuestionnaireDefinition } from './final-questionnaire-definition'

export type FinalQuestionnaireAnswers = Record<string, string | string[]>
const invalid = () =>
  new OperationalLinkError(
    400,
    'champs',
    'Vérifiez les champs obligatoires et les choix du formulaire.',
  )
export function parseFinalQuestionnaire(
  def: FinalQuestionnaireDefinition,
  value: unknown,
): FinalQuestionnaireAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const fields = value as Record<string, unknown>,
    answers: FinalQuestionnaireAnswers = {}
  const allowed = def.questions.map((q) => q.key)
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
    if (['radio', 'select', 'scale'].includes(q.type) && text && !q.choices.includes(text))
      throw invalid()
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
  }
  return answers
}

/** Source must be durably stored and read back before any business projection. */
export async function receiveFinalQuestionnaire(input: {
  db: SubmissionDatabase
  token: string
  table: string
  definition: FinalQuestionnaireDefinition
  answers: FinalQuestionnaireAnswers
  personProjection: FinalConfig
}) {
  const { db, token, table, definition: def, personProjection } = input
  const answers = parseFinalQuestionnaire(def, input.answers)
  const source = {
    schema: def.version,
    kind: def.kind,
    answers: def.questions.map((q) => ({ key: q.key, label: q.label, value: answers[q.key] })),
  }
  const receipt = await hashOperational(JSON.stringify(source))
  const claim = await db
    .prepare('INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash) VALUES (?,?,?)')
    .bind(receipt, def.kind, receipt)
    .run()
  const registered = await initializeFinalProjection(
    db,
    receipt,
    personProjection,
    JSON.stringify(source),
  )
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
  const projected = await projectFinal({
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
  identity_unresolved: 'Aucune identité confirmée avec cette adresse.',
  identity_conflict: 'L’adresse et le rattachement déclaré ne concordent pas.',
  identity_not_unique: 'Plusieurs personnes sont possibles ou la recherche est incomplète.',
  cohort_unresolved: 'L’année scolaire doit être rapprochée par l’équipe.',
  establishment_unresolved:
    'Le rattachement de cet établissement pour cette année reste à confirmer.',
  cohort_conflict:
    'La relation entre la personne, l’établissement et l’année scolaire est à vérifier.',
  existing_value_conflict: 'Une information existante diffère et a été conservée.',
  receipt_already_claimed:
    'Une autre réponse est déjà en cours de vérification pour cette réception.',
  business_write_uncertain:
    'Le résultat de la mise à jour doit être vérifié avant toute nouvelle modification.',
  projection_configuration_changed: 'Les règles de rattachement ont changé depuis la réception.',
  receipt_field_unavailable: 'La date de réception n’est pas disponible sur la fiche cible.',
  dossier_not_unique: 'Plusieurs dossiers sont possibles ou la recherche est incomplète.',
  identity_or_value_changed:
    'L’identité, le dossier ou une valeur a changé pendant la vérification.',
  projection_read_unavailable:
    'La lecture de la base est temporairement indisponible ; vérification à reprendre.',
}
export async function finalQuestionnairePublicEntry(
  db: SubmissionDatabase,
  row: Record<string, unknown>,
  source: unknown,
) {
  if (!source || typeof source !== 'object') return null
  const value = source as { schema?: string; answers?: unknown }
  const def = finalQuestionnaireDefinitions.find((d) => d.version === value.schema)
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
  const projection = await readFinalProjection(db, String(row.cle_reponse))
  const verified = projection?.state === 'complete'
  const details: string[][] = value.answers.map((a) => [
    a.label,
    Array.isArray(a.value) ? a.value.join('\n') : a.value,
  ])
  details.push([
    'Réception métier',
    verified
      ? `Dossier #${projection.participation_id} · réception du ${String(JSON.parse(projection.fields_json ?? '{}')[def.kind === 'evaluation_fin_formation' ? 'date_evaluation_recu' : 'date_bilan_etablissement_recu'] ?? '')} vérifiée. ${projection.code === 'receipt_verified_partial' ? 'Le score NPS existant a été conservé ; avis complet au journal.' : 'Le statut de formation est inchangé.'}`
      : `${pendingReasons[projection?.code ?? ''] ?? 'La réception est en cours de vérification par l’équipe.'} Aucune réception métier confirmée.`,
  ])
  return {
    school: String(row.etablissement),
    city: String(row.ville ?? ''),
    year: String(row.annee_scolaire),
    form: def.title,
    state: verified ? 'Réception métier vérifiée' : 'Réception métier en attente — à vérifier',
    details,
    participationId: verified ? projection.participation_id : null,
  }
}
