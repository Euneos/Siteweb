import type { SubmissionDatabase } from './candidature-store'
import { emailValide, urlHttpValide } from './forms'
import { isoDate } from './google-form-contact'
import { hashOperational, operationalRequest } from './operational-data'
import { OperationalLinkError } from './operational-links'
import { bilanQuestions, bilanTitle, bilanVersion } from './bilan-formateur-definition'
import type { BilanConfig } from './bilan-formateur-plan'
import { initializeBilanProjection, projectBilan } from './bilan-formateur-store'
export type BilanAnswers = Record<
  Exclude<(typeof bilanQuestions)[number]['key'], 'contractReturned'>,
  string
> & { contractReturned: string[] }
export function parseBilan(value: unknown): BilanAnswers {
  const invalid = () => new OperationalLinkError(400, 'champs', 'Vérifiez les champs du bilan.')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const fields = value as Record<string, unknown>,
    out = {} as BilanAnswers
  if (Object.keys(fields).some((k) => !bilanQuestions.some((q) => q.key === k))) throw invalid()
  for (const q of bilanQuestions) {
    const raw = fields[q.key]
    if (q.type === 'checkbox') {
      if (
        !Array.isArray(raw) ||
        !raw.length ||
        raw.some((v) => typeof v !== 'string' || !(q.choices as readonly string[]).includes(v)) ||
        new Set(raw).size !== raw.length
      )
        throw invalid()
      out.contractReturned = q.choices.filter((c) => raw.includes(c))
      continue
    }
    if (raw === undefined && !q.required) {
      out[q.key] = ''
      continue
    }
    if (typeof raw !== 'string' || raw.length > q.maxLength || /[\u0000-\u001f\u007f]/.test(raw))
      throw invalid()
    const text = raw.normalize('NFC').trim()
    if (q.required && !text) throw invalid()
    if (text && q.type === 'choice' && !(q.choices as readonly string[]).includes(text))
      throw invalid()
    if (text && q.type === 'date' && !isoDate(text)) throw invalid()
    if (text && q.type === 'url' && !urlHttpValide(text)) throw invalid()
    out[q.key] = text
  }
  out.email = out.email.toLowerCase()
  if (
    !emailValide(out.email) ||
    !/^20\d{2}-20\d{2}$/.test(out.year) ||
    Number(out.year.slice(5)) !== Number(out.year.slice(0, 4)) + 1 ||
    !/^(0|[1-9]\d{0,4})$/.test(out.adultCount) ||
    !/^\d{1,7}([.,]\d{1,2})?$/.test(out.invoiceAmount) ||
    out.end < out.start
  )
    throw invalid()
  return out
}
export async function receiveBilan(input: {
  db: SubmissionDatabase
  token: string
  table: string
  answers: BilanAnswers
  config: BilanConfig
}) {
  const { db, token, table, config } = input,
    answers = parseBilan(input.answers)
  const sourceAnswers = {
    schema: bilanVersion,
    kind: 'bilan_formateur',
    answers: bilanQuestions.map((q) => ({ key: q.key, label: q.label, value: answers[q.key] })),
  }
  const receipt = await hashOperational(JSON.stringify(sourceAnswers))
  const claimed = await db
    .prepare('INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash) VALUES (?,?,?)')
    .bind(receipt, 'bilan_formateur', receipt)
    .run()
  const registered = await initializeBilanProjection(
    db,
    receipt,
    config,
    JSON.stringify(sourceAnswers),
  )
  const fields = {
    cle_reponse: receipt,
    formulaire: bilanTitle,
    etablissement: answers.school,
    annee_scolaire: answers.year,
    referent_email: answers.email,
    reponses: JSON.stringify({ ...sourceAnswers, receivedAt: registered.received_at }),
    source_url: 'https://euneos.fr/suivi/bilan-formateur',
  }
  const lookup = (await operationalRequest(
    token,
    `/tables/${table}/records?${new URLSearchParams({ where: `(cle_reponse,eq,${receipt})`, limit: '2' })}`,
  )) as { list: Record<string, unknown>[] }
  if (!Array.isArray(lookup.list) || lookup.list.length > 1)
    throw new Error('Ambiguous source receipt')
  let source = lookup.list[0]
  if (!source) {
    const claimed = await db
      .prepare(
        'UPDATE public_form_receipts SET capture_started=1 WHERE receipt=? AND capture_started=0 AND noco_id IS NULL',
      )
      .bind(receipt)
      .run()
    if (claimed.meta.changes !== 1)
      return { state: 'processing', code: 'capture_pending', duplicate: true }
    const result = (await operationalRequest(token, `/tables/${table}/records`, 'POST', [
      {
        ...fields,
        detail_reprise:
          'Bilan conservé ; report de la mission à vérifier dans le registre du site.',
      },
    ])) as { Id: number } | { Id: number }[]
    const id = Array.isArray(result) ? result[0]?.Id : result.Id
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid source receipt')
    source = (await operationalRequest(token, `/tables/${table}/records/${id}`)) as Record<
      string,
      unknown
    >
  }
  if (
    !Number.isSafeInteger(source.Id) ||
    Number(source.Id) <= 0 ||
    Object.entries(fields).some(([k, v]) => source[k] !== v)
  )
    throw new Error('Source readback mismatch')
  await db
    .prepare('UPDATE public_form_receipts SET noco_id=? WHERE receipt=?')
    .bind(Number(source.Id), receipt)
    .run()
  const proof = await projectBilan({ db, token, receipt, config, answers })
  if (['complete', 'review'].includes(proof.state)) {
    await db
      .prepare('UPDATE public_form_receipts SET state=?,code=? WHERE receipt=?')
      .bind(proof.state, proof.code, receipt)
      .run()
    return { state: 'complete', code: 'received', duplicate: claimed.meta.changes !== 1 }
  }
  return {
    state: 'processing',
    code: 'verification_pending',
    duplicate: claimed.meta.changes !== 1,
  }
}
