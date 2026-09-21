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
  // Keep the school's existing keys unchanged. Defer the active-cohort lookup
  // for trainers: an existing application does not need a current intake.
  let cohort = school ? await cohorteActive(token) : null
  if (school && !cohort) throw new CandidatureError('indisponible', 'Exactly one active cohort is required')
  const scope = school ? cohort! : 0
  const key = await submissionKey(kind, identityParts, scope)
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
    if (!school) {
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
      ? [row.nom, row.cp, row.ville].map(normalise).every((v, i) => v === identityParts[i])
      : normalise(row.email) === identityParts[0])
    if (matches.length > 1) throw new CandidatureError('verification', 'Multiple matching identities')
    parentId = matches[0]?.Id ?? null
    if (parentId) {
      const rows = await lireToutes(token, childTable, `Id,${parentField},cohortes_id`)
      const paths = rows.filter(row => row[parentField] === parentId)
      const existing = school ? paths.filter(row => row.cohortes_id === cohort) : paths
      if (!school && existing.length > 1) throw new CandidatureError('verification', 'Multiple existing trainer applications')
      if (existing.length) {
        recordId = existing[0].Id
        await trace('existing', 'complete')
        return { duplicate: true }
      }
      // Historical imports include paths without a year. A public submission
      // cannot decide whether that is a previous year or the current dossier.
      if (school && paths.some(row => !row.cohortes_id)) throw new CandidatureError('verification', 'Existing path without cohort')
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
