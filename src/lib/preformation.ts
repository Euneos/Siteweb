import { emailValide } from './forms'
import { hashOperational, operationalRequest } from './operational-data'
import { OperationalLinkError } from './operational-links'
import type { SubmissionDatabase } from './candidature-store'
import type { PersonProjectionConfig } from './google-form-person'
import { initializePreformationProjection, projectPreformation } from './preformation-projection'
import {
  preformationQuestions,
  preformationTitle,
  preformationVersion,
} from './preformation-definition'

export type PreformationAnswers = Record<(typeof preformationQuestions)[number]['key'], string>
export function parsePreformation(value: unknown): PreformationAnswers {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OperationalLinkError(400, 'champs', 'Vérifiez les champs du formulaire.')
  const fields = value as Record<string, unknown>
  if (Object.keys(fields).some((key) => !preformationQuestions.some((q) => q.key === key)))
    throw new OperationalLinkError(400, 'champs', 'Vérifiez les champs du formulaire.')
  const answers = {} as PreformationAnswers
  for (const q of preformationQuestions) {
    const raw = fields[q.key]
    if (
      typeof raw !== 'string' ||
      raw.length > q.maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)
    )
      throw new OperationalLinkError(400, 'champs', `Vérifiez le champ « ${q.label.trim()} ».`)
    let text = raw.normalize('NFC').trim().replace(/\r\n?/g, '\n')
    if ((q.required && !text) || (q.type !== 'textarea' && /[\n\t]/.test(text)))
      throw new OperationalLinkError(400, 'champs', `Vérifiez le champ « ${q.label.trim()} ».`)
    if (q.type === 'choice' && !(q.choices as readonly string[]).includes(text))
      throw new OperationalLinkError(400, 'choix', `Vérifiez le choix « ${q.label.trim()} ».`)
    if (q.key === 'email') {
      text = text.toLowerCase()
      if (!emailValide(text))
        throw new OperationalLinkError(400, 'email', 'Vérifiez votre email professionnel.')
    }
    if (q.key === 'year') {
      text = text.replace(/[–—]/g, '-')
      if (!/^20\d{2}-20\d{2}$/.test(text) || Number(text.slice(5)) !== Number(text.slice(0, 4)) + 1)
        throw new OperationalLinkError(
          400,
          'annee',
          'Indiquez l’année scolaire au format 2026-2027.',
        )
    }
    answers[q.key] = text
  }
  return answers
}

/** Preserve and verify the source before PR38's private, guarded person projection.
 * Pedagogical answers stay in the journal. No email or training-status change. */
export async function receivePreformation(input: {
  db: SubmissionDatabase
  token: string
  table: string
  answers: PreformationAnswers
  personProjection: PersonProjectionConfig
}) {
  const { db, token, table } = input,
    answers = parsePreformation(input.answers)
  const sourceAnswers = {
    schema: preformationVersion,
    kind: 'pre_formation_adultes',
    answers: preformationQuestions.map((q) => ({
      key: q.key,
      label: q.label,
      value: answers[q.key],
    })),
  }
  const receipt = await hashOperational(JSON.stringify(sourceAnswers))
  const claim = await db
    .prepare('INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash) VALUES (?,?,?)')
    .bind(receipt, 'pre_formation_adultes', receipt)
    .run()
  const registered = await initializePreformationProjection(db, receipt, input.personProjection)
  const payload = JSON.stringify({ ...sourceAnswers, receivedAt: registered.received_at })
  const fields = {
    cle_reponse: receipt,
    formulaire: preformationTitle,
    etablissement: answers.school,
    annee_scolaire: answers.year,
    referent_email: answers.email,
    reponses: payload,
    source_url: 'https://euneos.fr/suivi/pre-formation',
  }
  // Read before a retry, including after a lost POST response. Never replay an
  // uncertain write. The SQL claim serializes concurrent identical submissions.
  const lookup = (await operationalRequest(
    token,
    `/tables/${table}/records?${new URLSearchParams({ where: `(cle_reponse,eq,${receipt})`, limit: '2' })}`,
  )) as { list: Record<string, unknown>[] }
  if (!Array.isArray(lookup.list) || lookup.list.length > 1)
    throw new Error('Ambiguous questionnaire receipt')
  let source = lookup.list[0]
  if (!source) {
    const ownership = await db
      .prepare(
        'UPDATE public_form_receipts SET capture_started=1 WHERE receipt=? AND capture_started=0 AND noco_id IS NULL',
      )
      .bind(receipt)
      .run()
    if (ownership.meta.changes !== 1)
      return { state: 'processing', code: 'capture_pending', duplicate: true }
    const result = (await operationalRequest(token, `/tables/${table}/records`, 'POST', [
      {
        ...fields,
        statut_reprise: 'À rapprocher',
        detail_reprise: 'projection_pending',
      },
    ])) as { Id: number } | { Id: number }[]
    const id = Array.isArray(result) ? result[0]?.Id : result?.Id
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid questionnaire receipt')
    source = (await operationalRequest(token, `/tables/${table}/records/${id}`)) as Record<
      string,
      unknown
    >
  }
  if (
    !Number.isSafeInteger(source.Id) ||
    Number(source.Id) <= 0 ||
    Object.entries(fields).some(([key, value]) => source[key] !== value)
  )
    throw new Error('Questionnaire readback mismatch')
  await db
    .prepare('UPDATE public_form_receipts SET noco_id=? WHERE receipt=?')
    .bind(Number(source.Id), receipt)
    .run()
  const projected = await projectPreformation({
    db,
    token,
    receipt,
    config: input.personProjection,
    answers,
  })
  // The durable projection row is authoritative. The source stays append-only:
  // a read/merge/PATCH of journal annotations could overwrite another writer.
  if (projected.state === 'complete' || projected.state === 'review') {
    const verified = projected.state === 'complete'
    await db
      .prepare('UPDATE public_form_receipts SET state=?,code=?,target_id=? WHERE receipt=?')
      .bind(verified ? 'complete' : 'review', projected.code, projected.participation_id, receipt)
      .run()
  }
  if (!['complete', 'review'].includes(projected.state))
    return { state: 'processing', code: 'processing', duplicate: claim.meta.changes !== 1 }
  // Uniform public receipt: never reveal whether an adult or dossier exists.
  return { state: 'complete', code: 'received', duplicate: claim.meta.changes !== 1 }
}

/** Read the stored labels, not a future questionnaire definition. Team-only caller. */
export function preformationDetails(source: unknown): string[][] | null {
  if (
    !source ||
    typeof source !== 'object' ||
    (source as { schema?: string }).schema !== preformationVersion
  )
    return null
  const answers = (source as { answers?: unknown }).answers
  if (
    !Array.isArray(answers) ||
    !answers.every((a) => a && typeof a.label === 'string' && typeof a.value === 'string')
  )
    throw new Error('Invalid questionnaire source')
  return answers.map((a) => [a.label, a.value])
}
