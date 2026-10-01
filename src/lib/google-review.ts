import { WorkspaceError } from './internal-workspace'

export const RECONCILIATION_OPEN = '[EUNEOS_GOOGLE_RECONCILIATION_V1]'
export const RECONCILIATION_CLOSE = '[/EUNEOS_GOOGLE_RECONCILIATION_V1]'
export const REVIEW_OPEN = '[EUNEOS_GOOGLE_REVIEW_V1]'
export const REVIEW_CLOSE = '[/EUNEOS_GOOGLE_REVIEW_V1]'
export type GoogleRow = Record<string, unknown> & { Id: number }
export type Reconciliation = {
  version: 1
  sourceKey: string
  targets: { table: string; id: number; fields: string[] }[]
  state: 'integrated' | 'partial' | 'pending'
  reasons: string[]
  at: string
}
export type ReviewTarget = { kind: 'school' | 'trainer'; id: number; label: string }
export type ManualReview = {
  version: 1
  sourceKey: string
  target: ReviewTarget
  actor: string
  at: string
  reason: string
  action: 'attachment-only'
  id: string
}
export const positiveId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0
const string = (v: unknown): string => (typeof v === 'string' ? v : '')
function blocks(text: string, open: string, close: string): unknown[] {
  const values: unknown[] = []
  let start = 0
  while ((start = text.indexOf(open, start)) !== -1) {
    const end = text.indexOf(close, start + open.length)
    if (end === -1) break
    try {
      values.push(JSON.parse(text.slice(start + open.length, end)))
    } catch {
      /* raw text remains visible */
    }
    start = end + close.length
  }
  return values
}
export function reconciliation(row: GoogleRow): Reconciliation | null {
  const values = blocks(string(row.detail_reprise), RECONCILIATION_OPEN, RECONCILIATION_CLOSE)
  // Latest receipt wins only when its complete structure and source binding are valid.
  for (const value of values.reverse()) {
    const v = value as Reconciliation
    if (
      v?.version === 1 &&
      v.sourceKey === row.cle_reponse &&
      ['integrated', 'partial', 'pending'].includes(v.state) &&
      Array.isArray(v.targets) &&
      v.targets.every(
        (t) =>
          t &&
          typeof t.table === 'string' &&
          positiveId(t.id) &&
          Array.isArray(t.fields) &&
          t.fields.every((f) => typeof f === 'string'),
      ) &&
      Array.isArray(v.reasons) &&
      v.reasons.every((r) => typeof r === 'string') &&
      typeof v.at === 'string' &&
      Number.isFinite(Date.parse(v.at))
    )
      return v
  }
  return null
}
export function manualReview(row: GoogleRow): ManualReview | null {
  const values = blocks(string(row.detail_reprise), REVIEW_OPEN, REVIEW_CLOSE)
  for (const value of values.reverse()) {
    const audit = validatedManualReview(value, row.cle_reponse)
    if (audit) return audit
  }
  return null
}
export function validatedManualReview(value: unknown, sourceKey: unknown): ManualReview | null {
  const v = value as ManualReview
  if (
    v?.version === 1 &&
    typeof sourceKey === 'string' &&
    sourceKey.length > 0 &&
    v.sourceKey === sourceKey &&
    v.action === 'attachment-only' &&
    ['school', 'trainer'].includes(v.target?.kind) &&
    positiveId(v.target?.id) &&
    typeof v.target.label === 'string' &&
    typeof v.actor === 'string' &&
    typeof v.reason === 'string' &&
    typeof v.id === 'string' &&
    typeof v.at === 'string' &&
    Number.isFinite(Date.parse(v.at))
  )
    return v
  return null
}
export async function reviewVersion(row: GoogleRow): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      row.Id,
      row.cle_reponse,
      row.reponses,
      row.detail_reprise,
      row.statut_reprise,
      row.UpdatedAt,
    ]),
  )
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
}
export async function reviewView(row: GoogleRow) {
  let answers: { question: string; answer: string }[] = []
  try {
    const value = JSON.parse(string(row.reponses))
    if (Array.isArray(value))
      answers = value
        .filter((a) => a && typeof a.question === 'string' && typeof a.answer === 'string')
        .map((a) => ({ question: a.question, answer: a.answer }))
  } catch {
    /* expose original as text when the format is unknown */
  }
  const receipt = reconciliation(row),
    attachment = manualReview(row)
  return {
    id: row.Id,
    sourceKey: string(row.cle_reponse),
    form: string(row.formulaire),
    submittedAt: string(row.horodatage_source),
    status: string(row.statut_reprise),
    detail: string(row.detail_reprise),
    answers,
    rawAnswers: answers.length ? '' : string(row.reponses),
    receipt,
    attachment,
    state: receipt?.state ?? ('unknown' as const),
    version: await reviewVersion(row),
  }
}
export function parseReviewCommand(body: Record<string, unknown>) {
  if (
    Object.keys(body).some(
      (k) => !['id', 'version', 'targetKind', 'targetId', 'reason', 'confirmed'].includes(k),
    ) ||
    !positiveId(body.id) ||
    !positiveId(body.targetId) ||
    !['school', 'trainer'].includes(String(body.targetKind)) ||
    typeof body.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.version) ||
    body.confirmed !== true ||
    typeof body.reason !== 'string' ||
    !body.reason.trim() ||
    body.reason.length > 2000 ||
    /[\u0000-\u001f]/.test(body.reason) ||
    [REVIEW_OPEN, REVIEW_CLOSE, RECONCILIATION_OPEN, RECONCILIATION_CLOSE].some((marker) =>
      (body.reason as string).includes(marker),
    )
  )
    throw new WorkspaceError(
      400,
      'Choisissez un dossier exact, précisez la justification et confirmez le rattachement.',
    )
  return {
    id: body.id,
    version: body.version,
    targetKind: body.targetKind as ReviewTarget['kind'],
    targetId: body.targetId,
    reason: body.reason.trim(),
  }
}

/** Match explicit table/id references only. Never infer a participant's dossier
 * from a name. Parent imports may use table IDs or these stable business names. */
export function resolveReconciliationTargets(
  receipt: Reconciliation | null,
  dossiers: ReviewTarget[],
  adults: GoogleRow[],
  tables: { participations: string; engagements: string; adults: string },
) {
  return (receipt?.targets ?? []).map((target) => {
    const school = [tables.participations, 'participations'].includes(target.table)
    const trainer = [tables.engagements, 'engagements', 'parcours_formateur'].includes(target.table)
    const adult = [tables.adults, 'adultes', 'adults'].includes(target.table)
    let label: string
    if (school || trainer) {
      const dossier = dossiers.find(
        (d) => d.id === target.id && d.kind === (school ? 'school' : 'trainer'),
      )
      label =
        dossier?.label ??
        `Dossier ${school ? 'établissement' : 'formateur'} #${target.id} — nom non résolu (dossier absent ou archivé)`
    } else if (adult) {
      const person = adults.find((a) => a.Id === target.id)
      const name = person ? `${string(person.prenom)} ${string(person.nom)}`.trim() : ''
      const dossier = person
        ? dossiers.find((d) => d.kind === 'school' && d.id === person.participations_id)
        : undefined
      label = `Participant adulte ${name || `#${target.id}`}${dossier ? ` — ${dossier.label}` : ' — dossier non résolu'}`
    } else label = `Référence ${target.table} #${target.id} — nom non résolu`
    return { ...target, label }
  })
}
