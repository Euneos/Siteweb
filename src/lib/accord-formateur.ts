import type { SubmissionDatabase } from './candidature-store'
import type { PersonProjectionConfig } from './google-form-person'
import { emailValide } from './forms'
import { isoDate } from './google-form-contact'
import { hashOperational, operationalRequest } from './operational-data'
import { OperationalLinkError } from './operational-links'
import {
  accordQuestions,
  accordTerms,
  accordTermsTitle,
  accordTitle,
  accordVersion,
} from './accord-formateur-definition'
import { initializeAccordProjection, projectAccord } from './accord-formateur-projection'

export type AccordAnswers = Record<(typeof accordQuestions)[number]['key'], string>
export function parseAccord(value: unknown): AccordAnswers {
  const invalid = () =>
    new OperationalLinkError(400, 'champs', 'Vérifiez les champs du formulaire.')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const fields = value as Record<string, unknown>,
    answers = {} as AccordAnswers
  if (Object.keys(fields).some((k) => !accordQuestions.some((q) => q.key === k))) throw invalid()
  for (const q of accordQuestions) {
    const raw = fields[q.key]
    if (
      typeof raw !== 'string' ||
      raw.length > q.maxLength ||
      /[\u0000-\u001f\u007f]/.test(raw) ||
      !raw.trim()
    )
      throw invalid()
    answers[q.key] = raw.normalize('NFC').trim()
  }
  answers.email = answers.email.toLowerCase()
  if (
    !emailValide(answers.email) ||
    !['Oui', 'Non'].includes(answers.agreement) ||
    !isoDate(answers.agreementDate)
  )
    throw invalid()
  return answers
}
export function accordSignatureMatches(answers: AccordAnswers) {
  const canonical = (s: string) =>
    s.normalize('NFC').toLocaleLowerCase('fr').replace(/\s+/g, ' ').trim()
  return [
    answers.firstName + ' ' + answers.lastName,
    answers.lastName + ' ' + answers.firstName,
  ].some((n) => canonical(n) === canonical(answers.signature))
}

/** Immutable full contract + respondent's own answers before any business write.
 * A receipt is not proof of agreement: only the private projection readback is. */
export async function receiveAccord(input: {
  db: SubmissionDatabase
  token: string
  table: string
  answers: AccordAnswers
  personProjection: PersonProjectionConfig
}) {
  const { db, token, table } = input,
    answers = parseAccord(input.answers)
  const sourceAnswers = {
    schema: accordVersion,
    kind: 'accord_formateur',
    contract: { title: accordTitle, termsTitle: accordTermsTitle, sections: accordTerms },
    answers: accordQuestions.map((q) => ({ key: q.key, label: q.label, value: answers[q.key] })),
  }
  const receipt = await hashOperational(JSON.stringify(sourceAnswers))
  const claimed = await db
    .prepare('INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash) VALUES (?,?,?)')
    .bind(receipt, 'accord_formateur', receipt)
    .run()
  const registered = await initializeAccordProjection(
    db,
    receipt,
    input.personProjection,
    JSON.stringify(sourceAnswers),
  )
  const payload = JSON.stringify({ ...sourceAnswers, receivedAt: registered.received_at })
  const fields = {
    cle_reponse: receipt,
    formulaire: accordTitle,
    referent_email: answers.email,
    reponses: payload,
    source_url: 'https://euneos.fr/suivi/accord-formateur',
  }
  const lookup = (await operationalRequest(
    token,
    `/tables/${table}/records?${new URLSearchParams({ where: `(cle_reponse,eq,${receipt})`, limit: '2' })}`,
  )) as { list: Record<string, unknown>[] }
  if (!Array.isArray(lookup.list) || lookup.list.length > 1)
    throw new Error('Ambiguous agreement receipt')
  let source = lookup.list[0]
  if (!source) {
    const owned = await db
      .prepare(
        'UPDATE public_form_receipts SET capture_started=1 WHERE receipt=? AND capture_started=0 AND noco_id IS NULL',
      )
      .bind(receipt)
      .run()
    if (owned.meta.changes !== 1)
      return { state: 'processing', code: 'capture_pending', duplicate: true }
    const saved = (await operationalRequest(token, `/tables/${table}/records`, 'POST', [
      {
        ...fields,
        detail_reprise:
          'Réponse accord formateur conservée. Report métier à vérifier dans le registre des accords du site.',
      },
    ])) as { Id: number } | { Id: number }[]
    const id = Array.isArray(saved) ? saved[0]?.Id : saved?.Id
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid source receipt')
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
    throw new Error('Agreement source mismatch')
  await db
    .prepare('UPDATE public_form_receipts SET noco_id=? WHERE receipt=?')
    .bind(Number(source.Id), receipt)
    .run()
  const projection = await projectAccord({
    db,
    token,
    receipt,
    config: input.personProjection,
    answers,
  })
  // The Noco journal is append-only here: never replace another importer's detail.
  if (projection.state === 'complete' || projection.state === 'review') {
    await db
      .prepare('UPDATE public_form_receipts SET state=?,code=? WHERE receipt=?')
      .bind(projection.state, projection.code, receipt)
      .run()
    return { state: 'complete', code: 'received', duplicate: claimed.meta.changes !== 1 }
  }
  return {
    state: 'processing',
    code: 'verification_pending',
    duplicate: claimed.meta.changes !== 1,
  }
}
