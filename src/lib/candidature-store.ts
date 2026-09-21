import { cohorteActive, creer, lireEnregistrement, lireToutes, relier } from './nocodb'

type FormType = 'etablissement' | 'formateur'
// D1's native binding; the narrow shape also lets tests execute the real SQL.
export interface SubmissionDatabase {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      run(): Promise<{ meta: { changes: number } }>
      first<T>(): Promise<T | null>
      all<T>(): Promise<{ results: T[] }>
    }
  }
}

export function submissionDatabase(locals: unknown): SubmissionDatabase | null {
  return (locals as { runtime?: { env?: { FORM_SUBMISSIONS?: SubmissionDatabase } } })?.runtime?.env?.FORM_SUBMISSIONS ?? null
}

export class CandidatureError extends Error {
  constructor(public readonly code: 'en_cours' | 'verification' | 'indisponible', message: string) {
    super(message)
  }
}

const normalise = (value: unknown) => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr')

// Keep the legacy normalise/hash algorithm available for historical receipts.
// New school reservations and record matching must use the same canonical parts.
const schoolText = (value: unknown) => normalise(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const schoolPostcode = (value: unknown) => {
  const text = normalise(value)
  // Imports stored integer postcodes as decimals and sometimes lost leading
  // zeroes. Compare digits without guessing a country or padding a Tunisian CP.
  // Keep non-numeric codes intact; never round fractions or parse exponents.
  const digits = /^(\d+)(?:\.0+)?$/.exec(text)?.[1]
  return digits === undefined ? text : digits.replace(/^0+(?=\d)/, '')
}
const schoolParts = (identity: Record<string, unknown>) =>
  [schoolText(identity.nom), schoolPostcode(identity.cp), schoolText(identity.ville)]
const sameSchool = (left: Record<string, unknown>, right: Record<string, unknown>) =>
  schoolParts(left).every((part, index) => part === schoolParts(right)[index])
const SCHOOL_RECEIPT_PREFIX = 'school:v2:'
type Receipt = { submission_key: string; state: string; parent_id: number | null; record_id: number | null }

async function submissionKey(kind: FormType, identity: string[], cohort: number) {
  const bytes = new TextEncoder().encode(JSON.stringify([kind, identity, cohort]))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}

/** One public trainer application per email, across cohorts. Schools retain
 * one application per identity and active cohort. Training resumptions and
 * session assignment belong to the team's workflow, not a duplicate POST.
 * D1's unique INSERT arbitrates across Workers; no process-local lock or expiry
 * can silently repeat an ambiguous NocoDB write. */
export async function enregistrerCandidature(input: {
  db: SubmissionDatabase
  token: string
  kind: FormType
  identity: Record<string, unknown>
  application: Record<string, unknown>
}): Promise<{ duplicate: boolean }> {
  const { db, token, kind, identity, application } = input
  const school = kind === 'etablissement'
  const parentTable = school ? 'etablissements' : 'formateurs'
  const childTable = school ? 'participations' : 'engagements'
  const parentField = school ? 'etablissements_id' : 'formateurs_id'
  const parentLink = school ? 'participations.etablissement' : 'engagements.formateur'
  const cohortLink = school ? 'participations.cohorte' : 'engagements.cohorte'
  const identityParts = school
    ? [normalise(identity.nom), normalise(identity.cp), normalise(identity.ville)]
    : [normalise(identity.email)]
  // Zero is the lifetime scope of a trainer receipt, never a NocoDB cohort ID.
  // Defer the active-cohort lookup for trainers: an existing application does
  // not need a current intake. School claims still have an annual scope.
  let cohort = school ? await cohorteActive(token) : null
  if (school && !cohort) throw new CandidatureError('indisponible', 'Exactly one active cohort is required')
  const scope = school ? cohort! : 0
  const legacyKey = await submissionKey(kind, identityParts, scope)
  // One atomic reservation for ALL equivalent spellings, including before a
  // parent exists. Prefixing distinguishes new claims from irreversible legacy
  // hashes without a D1 migration or storing names/addresses in the ledger.
  const key = school
    ? SCHOOL_RECEIPT_PREFIX + await submissionKey(kind, schoolParts(identity), scope)
    : legacyKey
  // Without the Sessions API, D1 reads and writes go to the primary database.
  const claimed = await db.prepare(`INSERT INTO form_submissions
    (submission_key, form_type, cohort_id, state, phase) VALUES (?, ?, ?, 'processing', 'checking')
    ON CONFLICT(submission_key) DO NOTHING`).bind(key, kind, scope).run()
  if (claimed.meta.changes !== 1) {
    const receipt = await db.prepare('SELECT state FROM form_submissions WHERE submission_key = ?').bind(key).first<{ state: string }>()
    if (receipt?.state === 'complete') return { duplicate: true }
    throw new CandidatureError(receipt?.state === 'processing' ? 'en_cours' : 'verification', 'Application already claimed')
  }

  let mutationStarted = false
  let parentId: number | null = null
  let recordId: number | null = null
  async function trace(phase: string, state = 'processing') {
    const changed = await db.prepare(`UPDATE form_submissions SET phase = ?, state = ?, parent_id = ?, record_id = ?, updated_at = CURRENT_TIMESTAMP WHERE submission_key = ?`)
      .bind(phase, state, parentId, recordId, key).run()
    if (changed.meta.changes !== 1) throw new Error('Missing application receipt')
  }

  try {
    let schoolReceipts: Receipt[] = []
    if (school) {
      const legacy = await db.prepare(`SELECT submission_key, state, parent_id, record_id
        FROM form_submissions WHERE form_type = 'etablissement' AND cohort_id = ?
        AND submission_key NOT LIKE ?`).bind(scope, `${SCHOOL_RECEIPT_PREFIX}%`).all<Receipt>()
      schoolReceipts = legacy.results
      const exact = schoolReceipts.find(receipt => receipt.submission_key === legacyKey)
      if (exact) {
        if (exact.state !== 'complete') {
          throw new CandidatureError(exact.state === 'processing' ? 'en_cours' : 'verification', 'Legacy school receipt needs reconciliation')
        }
        parentId = exact.parent_id
        recordId = exact.record_id
        await trace('existing_receipt', 'complete')
        return { duplicate: true }
      }
      // A legacy hash cannot reveal which spelling or school it belonged to.
      // Without either remote ID, no school in this cohort can safely exclude
      // a lost write. Reconciliation is required; never discard these receipts.
      if (schoolReceipts.some(receipt => receipt.state !== 'complete' && receipt.parent_id === null && receipt.record_id === null)) {
        throw new CandidatureError('verification', 'Uncorrelated legacy school receipt blocks this cohort until reconciliation')
      }
    } else {
      // The old code claimed a different key for each cohort. Do not bypass
      // a timed-out write (even with no known parent ID) when changing scope.
      // Read cohort IDs from D1 itself so deleted/inactive cohorts are covered.
      const legacy = await db.prepare(`SELECT submission_key, cohort_id, state, parent_id, record_id
        FROM form_submissions WHERE form_type = 'formateur' AND cohort_id != 0`).bind().all<{
          submission_key: string; cohort_id: number; state: string; parent_id: number | null; record_id: number | null
        }>()
      const keys = new Map<number, string>()
      for (const receipt of legacy.results) {
        if (!keys.has(receipt.cohort_id)) keys.set(receipt.cohort_id, await submissionKey(kind, identityParts, receipt.cohort_id))
      }
      const previous = legacy.results.filter(r => r.submission_key === keys.get(r.cohort_id))
      if (previous.some(r => r.state !== 'complete')) {
        throw new CandidatureError('verification', 'Previous cohort receipt needs reconciliation')
      }
      if (previous.length) {
        parentId = previous[0].parent_id
        recordId = previous[0].record_id
        await trace('existing_receipt', 'complete')
        return { duplicate: true }
      }
    }
    // Read all pages: NocoDB may clamp limit, and input is never interpolated
    // into its filter grammar. Do not select one of several ambiguous matches.
    const parents = await lireToutes(token, parentTable, school ? 'Id,nom,cp,ville' : 'Id,email')
    const matches = parents.filter(row => school
      ? sameSchool(row, identity)
      : normalise(row.email) === identityParts[0])
    if (matches.length > 1) throw new CandidatureError('verification', 'Multiple matching identities')
    parentId = matches[0]?.Id ?? null
    // A receipt with only a record ID can be correlated through its surviving
    // canonical dossier. Missing/archived/orphan references remain fail-closed.
    const needsRecords = parentId || schoolReceipts.some(receipt => receipt.parent_id === null && receipt.record_id !== null)
    const rows = needsRecords ? await lireToutes(token, childTable, `Id,${parentField},cohortes_id`) : []
    let previousSchool: Receipt | undefined
    if (school) {
      const parentsById = new Map(parents.map(parent => [parent.Id, parent]))
      const recordsById = new Map(rows.map(row => [row.Id, row]))
      for (const receipt of schoolReceipts) {
        const relatedId = receipt.parent_id ?? recordsById.get(receipt.record_id!)?.[parentField]
        const related = typeof relatedId === 'number' ? parentsById.get(relatedId) : undefined
        const correlatable = related && schoolParts(related).every(Boolean)
        if (receipt.state !== 'complete') {
          if (!correlatable) throw new CandidatureError('verification', 'Uncorrelated legacy school receipt blocks this cohort until reconciliation')
          if (sameSchool(related, identity)) throw new CandidatureError('verification', 'Matching legacy school receipt needs reconciliation')
        } else if (correlatable && sameSchool(related, identity)) {
          previousSchool = receipt
        }
      }
    }
    if (parentId) {
      const paths = rows.filter(row => row[parentField] === parentId)
      const existing = school ? paths.filter(row => row.cohortes_id === cohort) : paths
      if (existing.length > 1) throw new CandidatureError('verification', 'Multiple existing applications')
      // An unscoped path is ambiguous even alongside a current-year dossier.
      // A public submission cannot decide which year that path belongs to.
      if (school && paths.some(row => !row.cohortes_id)) throw new CandidatureError('verification', 'Existing path without cohort')
      if (existing.length) {
        recordId = existing[0].Id
        await trace('existing', 'complete')
        return { duplicate: true }
      }
    }
    if (previousSchool) {
      recordId = previousSchool.record_id
      await trace('existing_receipt', 'complete')
      return { duplicate: true }
    }
    if (!school) cohort = await cohorteActive(token)
    if (!cohort) throw new CandidatureError('indisponible', 'Exactly one active cohort is required')
    if (!parentId) {
      await trace('creating_identity')
      mutationStarted = true
      parentId = await creer(token, parentTable, identity)
      await trace('identity_created')
    }
    await trace('creating_application')
    mutationStarted = true
    recordId = await creer(token, childTable, application)
    await trace('linking_identity')
    await relier(token, parentLink, childTable, recordId, parentId)
    await trace('linking_cohort')
    await relier(token, cohortLink, childTable, recordId, cohort)
    await trace('verifying')
    const saved = await lireEnregistrement(token, childTable, recordId)
    if (saved.Id !== recordId || saved[parentField] !== parentId || saved.cohortes_id !== cohort) {
      throw new Error('Application links were not persisted')
    }
    await trace('saved', 'complete')
    return { duplicate: false }
  } catch (error) {
    if (mutationStarted) {
      // A timed-out POST may have succeeded. Retain the receipt and any rows
      // for inspection; never delete a parent whose links may already exist.
      try {
        await db.prepare("UPDATE form_submissions SET state = 'review', parent_id = ?, record_id = ?, updated_at = CURRENT_TIMESTAMP WHERE submission_key = ?")
          .bind(parentId, recordId, key).run()
      } catch { /* The last persisted phase remains actionable. */ }
      console.error('[candidature-reconcile]', { key, parentId, recordId })
      throw new CandidatureError('verification', 'Remote write needs reconciliation')
    }
    // Only read-only failures are safe to retry automatically.
    await db.prepare("DELETE FROM form_submissions WHERE submission_key = ? AND state = 'processing'").bind(key).run()
    throw error
  }
}
