import type { SubmissionDatabase } from './candidature-store'
import { NC } from './nocodb'
import {
  OperationalError,
  OPERATIONAL_ADULTS_TABLE,
  buildOperationalPatch,
  hashOperational,
  operationalFingerprint,
  operationalRequest,
  operationalReviewCodes,
  parseOperationalInput,
  planOperationalAdults,
  readOperationalAdults,
  readOperationalSnapshot,
  validateOperationalTarget,
  validId,
  type OperationalInput,
  type OperationalKind,
  type OperationalTarget,
  type OperationalRow,
} from './operational-data'
export type { SubmissionDatabase } from './candidature-store'
export type OperationalSubmissionState = 'complete' | 'review' | 'processing' | 'retryable'
type Journal = {
  link_hash: string
  payload_hash: string
  target_id: number
  school_id: number
  cohort_id: number
  kind: OperationalKind
  receipt: string
  state: OperationalSubmissionState
  code: string
  mutation_started: number
  adult_ids: string
  created_at: string
  updated_at: string
}
export type OperationalSubmission = {
  state: OperationalSubmissionState
  code: string
  receipt: string
  createdAdults: number
  participationId: number
  kind: OperationalKind
  createdAt: string
}
export type OperationalResult = {
  state: 'complete' | 'review' | 'processing' | 'retryable'
  duplicate: boolean
  receipt: string
  code: string
  createdAdults: number
}
const validHash = (hash: string) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)
function adultIds(row: Journal): number[] {
  const ids: unknown = JSON.parse(row.adult_ids)
  if (!Array.isArray(ids) || !ids.every(validId) || new Set(ids).size !== ids.length)
    throw new OperationalError('journal_invalid')
  return ids
}
const load = (db: SubmissionDatabase, hash: string) =>
  db
    .prepare('SELECT * FROM operational_submissions WHERE link_hash = ?')
    .bind(hash)
    .first<Journal>()
export async function readOperationalSubmission(
  db: SubmissionDatabase,
  linkHash: string,
): Promise<OperationalSubmission | null> {
  if (!validHash(linkHash)) throw new OperationalError('invalid_link_hash')
  const row = await load(db, linkHash)
  return row
    ? {
        state: row.state,
        code: row.code,
        receipt: row.receipt,
        createdAdults: adultIds(row).length,
        participationId: row.target_id,
        kind: row.kind,
        createdAt: row.created_at,
      }
    : null
}
export async function listOperationalSubmissions(db: SubmissionDatabase): Promise<
  {
    participationId: number
    kind: OperationalKind
    state: OperationalSubmissionState
    code: string
    createdAt: string
  }[]
> {
  const { results } = await db
    .prepare(
      'SELECT target_id, kind, state, code, created_at FROM operational_submissions ORDER BY created_at DESC, receipt DESC LIMIT 100',
    )
    .bind()
    .all<Journal>()
  return results.map((r) => ({
    participationId: r.target_id,
    kind: r.kind,
    state: r.state,
    code: r.code,
    createdAt: r.created_at,
  }))
}
const result = (row: Journal, duplicate: boolean, code = row.code): OperationalResult => ({
  state: row.state,
  code,
  duplicate,
  receipt: row.receipt,
  createdAdults: adultIds(row).length,
})
async function unlock(db: SubmissionDatabase, target: number, hash: string) {
  await db
    .prepare('DELETE FROM operational_submission_locks WHERE target_id = ? AND link_hash = ?')
    .bind(target, hash)
    .run()
}

/**
 * NocoDB has no multi-record transaction or conditional PATCH. We serialize site
 * writers in D1, reread the relevant snapshot before EVERY remote mutation and
 * verify every result. A concurrent manual edit during PATCH remains a platform
 * limitation. Once a request may have reached NocoDB, failures keep the lock;
 * neither a new link nor a retry repeats that mutation automatically.
 */
export async function enregistrerOperational(input: {
  db: SubmissionDatabase
  token: string
  linkHash: string
  target: OperationalTarget
  kind: OperationalKind
  data: OperationalInput
}): Promise<OperationalResult> {
  const { db, token, linkHash, target, kind } = input
  validateOperationalTarget(target)
  if (!validHash(linkHash)) throw new OperationalError('invalid_link_hash')
  // Revalidate at this boundary even when a route has already parsed the body.
  const data = parseOperationalInput(input.data, kind)
  const payloadHash = await hashOperational(
    JSON.stringify({
      target: [target.participationId, target.schoolId, target.cohortId],
      kind,
      data,
    }),
  )
  const now = new Date().toISOString(),
    receipt = await hashOperational(crypto.randomUUID())
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO operational_submissions
    (link_hash,payload_hash,target_id,school_id,cohort_id,kind,receipt,state,code,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'processing','preparing',?,?)`,
    )
    .bind(
      linkHash,
      payloadHash,
      target.participationId,
      target.schoolId,
      target.cohortId,
      kind,
      receipt,
      now,
      now,
    )
    .run()
  let journal = (await load(db, linkHash))!
  if (!journal) throw new OperationalError('journal_unavailable')
  if (
    journal.payload_hash !== payloadHash ||
    journal.target_id !== target.participationId ||
    journal.school_id !== target.schoolId ||
    journal.cohort_id !== target.cohortId ||
    journal.kind !== kind
  ) {
    // Never change the successful receipt just because somebody resubmits new data.
    return { ...result(journal, true), state: 'review', code: 'payload_changed' }
  }
  if (!inserted.meta.changes) {
    if (journal.state === 'review' && !journal.mutation_started)
      throw new OperationalError(journal.code, 409)
    if (journal.state !== 'retryable' || journal.mutation_started) return result(journal, true)
    const claim = await db
      .prepare(
        `UPDATE operational_submissions SET state='processing',code='preparing',updated_at=? WHERE link_hash=? AND state='retryable' AND mutation_started=0`,
      )
      .bind(now, linkHash)
      .run()
    if (!claim.meta.changes) return result((await load(db, linkHash))!, true)
    journal = (await load(db, linkHash))!
  }
  const locked = await db
    .prepare(
      'INSERT OR IGNORE INTO operational_submission_locks(target_id,link_hash,acquired_at) VALUES (?,?,?)',
    )
    .bind(target.participationId, linkHash, now)
    .run()
  if (!locked.meta.changes) {
    await db
      .prepare(
        "UPDATE operational_submissions SET state='retryable',code='target_busy',updated_at=? WHERE link_hash=?",
      )
      .bind(now, linkHash)
      .run()
    return result((await load(db, linkHash))!, false)
  }
  let mutationStarted = false
  const createdIds: number[] = []
  async function checkCurrentGrant() {
    const grant = await db
      .prepare(
        `SELECT l.token_hash,l.target_id,l.school_id,l.cohort_id,l.kind,l.expires_at
      FROM operational_link_slots s JOIN operational_links l ON l.token_hash=s.token_hash
      WHERE s.target_id=? AND s.kind=?`,
      )
      .bind(target.participationId, kind)
      .first<{
        token_hash: string
        target_id: number
        school_id: number
        cohort_id: number
        kind: string
        expires_at: number
      }>()
    if (!grant || grant.token_hash !== linkHash) throw new OperationalError('link_renewed')
    if (
      grant.target_id !== target.participationId ||
      grant.school_id !== target.schoolId ||
      grant.cohort_id !== target.cohortId ||
      grant.kind !== kind
    )
      throw new OperationalError('target_mismatch')
    if (!Number.isFinite(grant.expires_at) || grant.expires_at <= Date.now())
      throw new OperationalError('link_expired')
  }
  async function markMutation(code: string) {
    await checkCurrentGrant()
    const marked = await db
      .prepare(
        "UPDATE operational_submissions SET mutation_started=1,code=?,updated_at=? WHERE link_hash=? AND state='processing'",
      )
      .bind(code, new Date().toISOString(), linkHash)
      .run()
    if (marked.meta.changes !== 1) throw new OperationalError('journal_invalid')
    // Marked BEFORE fetch. An abort cannot prove that the server did not commit.
    mutationStarted = true
  }
  async function finish(state: OperationalSubmissionState, code: string) {
    await db
      .prepare(
        'UPDATE operational_submissions SET state=?,code=?,adult_ids=?,updated_at=? WHERE link_hash=?',
      )
      .bind(state, code, JSON.stringify(createdIds), new Date().toISOString(), linkHash)
      .run()
    return result((await load(db, linkHash))!, false)
  }
  try {
    await checkCurrentGrant()
    const snapshot = await readOperationalSnapshot(token, target)
    let adults = await readOperationalAdults(token, target.participationId)
    let fingerprint = operationalFingerprint(snapshot, adults)
    const reviewCodes = operationalReviewCodes(snapshot, data, kind)
    let plan: ReturnType<typeof planOperationalAdults> = { existingIds: [], create: [] }
    try {
      plan = planOperationalAdults(data.participants, adults)
    } catch (err) {
      if (err instanceof OperationalError && err.code === 'participants_ambiguous')
        reviewCodes.push(err.code)
      else throw err
    }
    // Preflight note parsing/capacity BEFORE any adult is created.
    buildOperationalPatch({
      snapshot,
      kind,
      data,
      receipt: journal.receipt,
      now,
      adultIds: [
        ...adults.map((a) => a.Id),
        ...Array(plan.create.length).fill(Number.MAX_SAFE_INTEGER),
      ],
      reviewCodes,
    })
    async function unchanged() {
      const fresh = await readOperationalSnapshot(token, target)
      const freshAdults = await readOperationalAdults(token, target.participationId)
      if (operationalFingerprint(fresh, freshAdults) !== fingerprint)
        throw new OperationalError('concurrent_change')
    }
    if (!reviewCodes.length && plan.create.length) {
      // NocoDB accepts a record array. One bounded batch avoids exhausting the
      // free Cloudflare subrequest budget on a normal class-sized list. This is
      // NOT a transaction: partial or missing replies still require review.
      const fields = await Promise.all(
        plan.create.map(async (person) => {
          const code =
            'AD-WEB-' +
            (
              await hashOperational(
                JSON.stringify([
                  target.participationId,
                  person.firstName.normalize('NFC').toLocaleLowerCase('fr'),
                  person.lastName.normalize('NFC').toLocaleLowerCase('fr'),
                ]),
              )
            ).slice(0, 32)
          if (adults.some((a) => a.adulte_id === code))
            throw new OperationalError('participants_ambiguous')
          return {
            adulte_id: code,
            nom: person.lastName,
            prenom: person.firstName,
            email: person.email || null,
            fonction: person.role || null,
            statut: 'Inscrit',
            participations_id: target.participationId,
          }
        }),
      )
      await unchanged()
      await markMutation('adult_pending')
      const response = await operationalRequest(
        token,
        `/tables/${OPERATIONAL_ADULTS_TABLE}/records`,
        'POST',
        fields,
      )
      const returned = Array.isArray(response) ? response : fields.length === 1 ? [response] : []
      const ids = returned.map((r) =>
        r && typeof r === 'object' ? (r as OperationalRow).Id : null,
      )
      // Persist every known new ID, even if the response is only a partial batch.
      createdIds.push(
        ...[...new Set(ids.filter(validId))].filter((id) => !adults.some((a) => a.Id === id)),
      )
      await db
        .prepare('UPDATE operational_submissions SET adult_ids=?,updated_at=? WHERE link_hash=?')
        .bind(JSON.stringify(createdIds), new Date().toISOString(), linkHash)
        .run()
      if (ids.length !== fields.length || createdIds.length !== fields.length)
        throw new OperationalError('write_uncertain')
      const verifiedSnapshot = await readOperationalSnapshot(token, target)
      const verifiedAdults = await readOperationalAdults(token, target.participationId)
      const newRows: OperationalRow[] = []
      for (const field of fields) {
        const matches = verifiedAdults.filter((a) => a.adulte_id === field.adulte_id)
        if (
          matches.length !== 1 ||
          !createdIds.includes(matches[0].Id) ||
          Object.entries(field).some(([key, value]) => (matches[0][key] ?? null) !== value)
        )
          throw new OperationalError('write_uncertain')
        newRows.push(matches[0])
      }
      adults = [...adults, ...newRows].sort((a, b) => a.Id - b.Id)
      fingerprint = operationalFingerprint(snapshot, adults)
      if (operationalFingerprint(verifiedSnapshot, verifiedAdults) !== fingerprint)
        throw new OperationalError('write_uncertain')
    }
    const patch = buildOperationalPatch({
      snapshot,
      kind,
      data,
      receipt: journal.receipt,
      now,
      adultIds: adults.map((a) => a.Id),
      reviewCodes,
    })
    await unchanged()
    await markMutation('participation_pending')
    await operationalRequest(token, `/tables/${NC.tables.participations}/records`, 'PATCH', [patch])
    const verified = await readOperationalSnapshot(token, target)
    const verifiedAdults = await readOperationalAdults(token, target.participationId)
    const expected = { ...snapshot, participation: { ...snapshot.participation, ...patch } }
    if (
      operationalFingerprint(verified, verifiedAdults) !== operationalFingerprint(expected, adults)
    )
      throw new OperationalError('write_uncertain')
    const completed = await finish(
      reviewCodes.length ? 'review' : 'complete',
      reviewCodes[0] ?? 'saved',
    )
    // Unlock only after durable completion. A crash here leaves a conservative lock.
    await unlock(db, target.participationId, linkHash)
    return completed
  } catch (err) {
    const known = err instanceof OperationalError ? err.code : 'read_failed'
    if (mutationStarted) {
      // D1 failure may itself prevent the final state update. The prewrite marker
      // and persistent lock still prevent another worker from repeating the write.
      return finish('review', 'write_uncertain')
    }
    const retryable = known === 'read_failed' || known === 'concurrent_change'
    const failed = await finish(retryable ? 'retryable' : 'review', known)
    await unlock(db, target.participationId, linkHash)
    if (retryable) return failed
    throw new OperationalError(
      known,
      known === 'read_failed' ? 503 : 409,
      known === 'read_failed'
        ? 'Le service est momentanément indisponible. Votre saisie n’a pas été enregistrée ; conservez-la.'
        : 'Le dossier ou le lien doit être vérifié par l’équipe EUNEOS. Votre saisie n’a pas été enregistrée ; conservez-la.',
    )
  }
}
