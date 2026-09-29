import { type SubmissionDatabase } from './candidature-store'
import { lireToutes, lireEnregistrement, NC } from './nocodb'
import {
  isoDate,
  isoTimestamp,
  normalise,
  readContact,
  writeContact,
  type ContactProjection,
} from './google-form-contact'

export interface GoogleFormEvent {
  version: 1
  kind: 'contact' | 'deploiement'
  cohortId: 2
  source: {
    spreadsheetId: string
    sheetId: number
    row: number
    revision: number
    submittedAt: string
    readAt: string
  }
  identity: { name: string; city: string; postcode: string; referenceEmail: string }
  contact: { name: string; email: string; phone: string }
  formation: { start: string; end: string; format: string; planning: string }
  declaredTrainer: string
  participants: string
}
export interface IdentityMapping {
  submitted: GoogleFormEvent['identity']
  schoolId: number
  expected: { name: string; city: string; postcode: string }
}
export interface GoogleFormSource {
  spreadsheetId: string
  sheetId: number
  kind: GoogleFormEvent['kind']
  cohortId: 2
  firstRow: number
  identityMappings?: IdentityMapping[]
}
export type SyncResult = {
  state: 'complete' | 'review' | 'processing' | 'retryable'
  code: string
  receipt: string
}
type Row = Record<string, unknown> & { Id: number }
const pick = (row: Record<string, unknown>) =>
  Object.fromEntries(
    [
      'Id',
      'etablissements_id',
      'cohortes_id',
      'fusionne_vers',
      'notes',
      'fiche_contact_recue',
      'date_debut_formation',
      'date_fin_formation',
      'statut_formation',
      'UpdatedAt',
    ].map((k) => [k, row[k] ?? null]),
  )
const compact = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
export const digest = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('')

/** Parse the narrow v1 projection. The complete JSON is captured separately. */
export function parseGoogleFormEvent(value: unknown): GoogleFormEvent {
  const v = value as GoogleFormEvent
  const str = (x: unknown, max = 2000): string => {
    if (
      typeof x !== 'string' ||
      x.length > max ||
      x.includes('[EUNEOS_CONTACT_V1]') ||
      x.includes('[/EUNEOS_CONTACT_V1]')
    )
      throw new Error('payload_invalid')
    return x.trim()
  }
  const timestamp = (x: unknown) => {
    const s = str(x, 40)
    if (!isoTimestamp(s)) throw new Error('payload_invalid')
    return new Date(s).toISOString()
  }
  if (
    !v ||
    v.version !== 1 ||
    v.cohortId !== 2 ||
    !['contact', 'deploiement'].includes(v.kind) ||
    !v.source ||
    !Number.isSafeInteger(v.source.sheetId) ||
    v.source.sheetId < 0 ||
    !Number.isSafeInteger(v.source.row) ||
    v.source.row < 2 ||
    !Number.isSafeInteger(v.source.revision) ||
    v.source.revision < 1 ||
    !v.identity ||
    !v.contact ||
    !v.formation
  )
    throw new Error('payload_invalid')
  const result: GoogleFormEvent = {
    version: 1,
    kind: v.kind,
    cohortId: 2,
    source: {
      spreadsheetId: str(v.source.spreadsheetId, 128),
      sheetId: v.source.sheetId,
      row: v.source.row,
      revision: v.source.revision,
      submittedAt: timestamp(v.source.submittedAt),
      readAt: timestamp(v.source.readAt),
    },
    identity: {
      name: str(v.identity.name, 300),
      city: str(v.identity.city, 150),
      postcode: str(v.identity.postcode, 30),
      referenceEmail: str(v.identity.referenceEmail, 254).toLowerCase(),
    },
    contact: {
      name: str(v.contact.name, 300),
      email: str(v.contact.email, 254),
      phone: str(v.contact.phone, 100),
    },
    formation: {
      start: str(v.formation.start, 100),
      end: str(v.formation.end, 100),
      format: str(v.formation.format),
      planning: str(v.formation.planning),
    },
    declaredTrainer: str(v.declaredTrainer),
    participants: str(v.participants, 8000),
  }
  if (
    !/^[\w-]{10,128}$/.test(result.source.spreadsheetId) ||
    !result.identity.name ||
    Date.parse(result.source.submittedAt) > Date.now() + 300_000 ||
    Date.parse(result.source.readAt) > Date.now() + 300_000
  )
    throw new Error('payload_invalid')
  return result
}
export function parseGoogleFormSources(value: string): GoogleFormSource[] {
  const a = JSON.parse(value) as GoogleFormSource[]
  if (
    !Array.isArray(a) ||
    !a.length ||
    a.length > 32 ||
    a.some(
      (x) =>
        !x ||
        !/^[\w-]{10,128}$/.test(x.spreadsheetId) ||
        !Number.isSafeInteger(x.sheetId) ||
        x.sheetId < 0 ||
        !Number.isSafeInteger(x.firstRow) ||
        x.firstRow < 2 ||
        x.cohortId !== 2 ||
        !['contact', 'deploiement'].includes(x.kind),
    ) ||
    new Set(a.map((x) => `${x.spreadsheetId}:${x.sheetId}`)).size !== a.length
  )
    throw new Error('sources_invalid')
  for (const s of a) {
    if (
      s.identityMappings !== undefined &&
      (!Array.isArray(s.identityMappings) ||
        s.identityMappings.length > 100 ||
        s.identityMappings.some(
          (m) =>
            !m ||
            !Number.isSafeInteger(m.schoolId) ||
            m.schoolId < 1 ||
            !m.submitted ||
            !m.expected ||
            ['name', 'city', 'postcode', 'referenceEmail'].some(
              (k) => typeof (m.submitted as Record<string, unknown>)[k] !== 'string',
            ) ||
            !m.submitted.name ||
            ['name', 'city', 'postcode'].some(
              (k) =>
                typeof (m.expected as Record<string, unknown>)[k] !== 'string' ||
                !(m.expected as Record<string, unknown>)[k],
            ),
        ))
    )
      throw new Error('identity_mapping_invalid')
  }
  return a
}

/** Requires independently identifying coordinates, never a name/email first-match. */
export function matchSchool(
  event: GoogleFormEvent,
  schools: Row[],
  dossiers: Row[],
  mappings: IdentityMapping[] = [],
): Row | null {
  const i = event.identity
  const postcode = (x: unknown) =>
    normalise(x)
      .replace(/\.0+$/, '')
      .replace(/^0+(?=\d)/, '')
  const explicit = mappings.filter((m) =>
    Object.keys(i).every(
      (k) => normalise(m.submitted[k as keyof typeof i]) === normalise(i[k as keyof typeof i]),
    ),
  )
  if (explicit.length > 1) return null
  if (explicit.length === 1) {
    const m = explicit[0]
    const school = schools.filter(
      (s) =>
        s.Id === m.schoolId &&
        normalise(s.nom) === normalise(m.expected.name) &&
        normalise(s.ville) === normalise(m.expected.city) &&
        postcode(s.cp) === postcode(m.expected.postcode),
    )
    if (school.length !== 1) return null
    const targets = dossiers.filter(
      (x) => x.etablissements_id === m.schoolId && x.cohortes_id === 2 && x.fusionne_vers == null,
    )
    return targets.length === 1 ? targets[0] : null
  }
  if (!(i.city && i.postcode) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.referenceEmail)) return null
  const matches = schools.filter(
    (s) =>
      normalise(s.nom) === normalise(i.name) &&
      (!i.city || normalise(s.ville) === normalise(i.city)) &&
      (!i.postcode || postcode(s.cp) === postcode(i.postcode)) &&
      (!i.referenceEmail || compact(s.referent_email).toLowerCase() === i.referenceEmail),
  )
  if (matches.length !== 1) return null
  const targets = dossiers.filter(
    (x) => x.etablissements_id === matches[0].Id && x.cohortes_id === 2 && x.fusionne_vers == null,
  )
  return targets.length === 1 ? targets[0] : null
}

/** Fill an empty operational projection only. Existing site/human/Google values
 * always require review, even if a later Google revision claims to supersede them. */
export function projectGoogleForm(event: GoogleFormEvent, target: Row) {
  if (target.notes != null && typeof target.notes !== 'string') throw new Error('notes_invalid')
  const notes = String(target.notes ?? '')
  if (notes.length > 160_000) throw new Error('notes_invalid')
  const previous = readContact(notes)
  const issues: string[] = []
  const start = isoDate(event.formation.start),
    end = isoDate(event.formation.end)
  if (
    !start ||
    !end ||
    start > end ||
    [start, end].some((d) => d && !['2026', '2027'].includes(d.slice(0, 4)))
  )
    issues.push('dates_invalid')
  // This includes site submissions appended to a legacy Google source block.
  // Never infer ownership merely from the top-level source or UpdatedAt.
  if (previous) issues.push('existing_projection')
  if (
    ['date_debut_formation', 'date_fin_formation', 'statut_formation'].some(
      (k) => target[k] != null && target[k] !== '',
    )
  )
    issues.push('existing_operational_data')
  if (
    ![null, undefined, false, 0].includes(
      target.fiche_contact_recue as null | undefined | boolean | number,
    )
  )
    issues.push('existing_operational_data')
  if (issues.length) return { patch: {} as Record<string, unknown>, issues: [...new Set(issues)] }
  const projection: ContactProjection = {
    version: 1,
    source: {
      spreadsheetId: event.source.spreadsheetId,
      rows: [event.source.row],
      readAt: event.source.readAt,
      sheetId: event.source.sheetId,
      revision: event.source.revision,
    },
    receivedAt: event.kind === 'contact' ? event.source.submittedAt : null,
    formation: {
      start,
      end,
      kind: event.kind === 'contact' ? 'previsionnelle' : 'deploiement',
      format: event.formation.format,
      planning: event.formation.planning,
      issues: [],
    },
    declaredTrainers: event.declaredTrainer ? [{ name: event.declaredTrainer }] : [],
    participants: {
      declared: event.participants,
      unresolved: event.participants ? [event.participants] : [],
      importedCount: 0,
    },
    // Contact is a declaration, never an update of the school's identity/contact.
    googleContact: event.contact,
  }
  return {
    patch: {
      ...(event.kind === 'contact' ? { fiche_contact_recue: true } : {}),
      date_debut_formation: start,
      date_fin_formation: end,
      statut_formation: event.kind === 'contact' ? 'Prévisionnelle' : 'Programmée',
      notes: writeContact(notes, projection),
    } as Record<string, unknown>,
    issues,
  }
}

/** Stable object order, including unmapped fields; array order remains meaningful. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 64) throw new Error('payload_too_deep')
  if (Array.isArray(value))
    return '[' + value.map((item) => canonical(item, depth + 1)).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k], depth + 1),
        )
        .join(',') +
      '}'
    )
  return JSON.stringify(value)
}

export interface GoogleFormInput {
  event: GoogleFormEvent
  rawPayload?: string
  sourceConfig?: GoogleFormSource
}
export function validateGoogleFormPayload(input: GoogleFormInput) {
  const raw = input.rawPayload ?? JSON.stringify(input.event)
  if (new TextEncoder().encode(raw).length > 32_768) throw new Error('payload_too_large')
  const parsed = JSON.parse(raw)
  const event = parseGoogleFormEvent(parsed)
  if (canonical(event) !== canonical(parseGoogleFormEvent(input.event)))
    throw new Error('payload_mismatch')
  const { readAt: _readAt, ...source } = event.source
  // readAt changes on every poll; all other raw fields (including unknown ones)
  // participate in revision conflict detection. Preserve original raw JSON in D1.
  const comparable = { ...parsed, source: { ...parsed.source } }
  delete comparable.source.readAt
  const known = JSON.parse(JSON.stringify(event))
  let sheetUnmapped = false
  if (Object.hasOwn(parsed, 'sheetSnapshot')) {
    const snapshot = parsed.sheetSnapshot
    // Narrow optional evidence envelope. No business mapping is inferred here.
    if (
      !snapshot ||
      !Array.isArray(snapshot.headers) ||
      !Array.isArray(snapshot.values) ||
      snapshot.headers.length > 256 ||
      snapshot.headers.length !== snapshot.values.length ||
      !snapshot.headers.every((h: unknown) => typeof h === 'string') ||
      !snapshot.values.every(
        (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
      ) ||
      !Array.isArray(snapshot.unmappedColumns) ||
      !snapshot.unmappedColumns.every(
        (c: unknown) =>
          typeof c === 'number' &&
          Number.isSafeInteger(c) &&
          c >= 1 &&
          c <= snapshot.headers.length,
      ) ||
      !Array.isArray(snapshot.missingFields) ||
      !snapshot.missingFields.every((f: unknown) => typeof f === 'string')
    )
      throw new Error('sheet_snapshot_invalid')
    sheetUnmapped =
      !!snapshot.unmappedColumns.length ||
      !!snapshot.missingFields.length ||
      Object.keys(snapshot).some(
        (k) => !['headers', 'values', 'unmappedColumns', 'missingFields'].includes(k),
      )
    known.sheetSnapshot = snapshot
  }
  const extra = (o: Record<string, unknown>, reference: Record<string, unknown>): boolean =>
    Object.keys(o).some(
      (k) =>
        !Object.hasOwn(reference, k) ||
        (reference[k] !== null &&
          typeof reference[k] === 'object' &&
          !Array.isArray(reference[k]) &&
          extra(o[k] as Record<string, unknown>, reference[k] as Record<string, unknown>)),
    )
  return {
    raw,
    event,
    source,
    hashInput: canonical(comparable),
    unmapped: sheetUnmapped || extra(parsed, known),
  }
}

async function resolve(token: string, event: GoogleFormEvent, sourceConfig?: GoogleFormSource) {
  const cohorts = await lireToutes(token, 'cohortes', 'Id')
  if (!cohorts.some((x) => x.Id === 2)) return { target: null, code: 'cohort_missing' }
  const schools = await lireToutes(token, 'etablissements', 'Id,nom,ville,cp,referent_email')
  const dossiers = await lireToutes(
    token,
    'participations',
    'Id,etablissements_id,cohortes_id,fusionne_vers',
  )
  const target = matchSchool(event, schools, dossiers, sourceConfig?.identityMappings)
  return { target, code: target ? 'ready' : 'identity_unresolved' }
}
const sameTarget = (row: Record<string, unknown>, target: Row) =>
  row.Id === target.Id &&
  row.etablissements_id === target.etablissements_id &&
  row.cohortes_id === 2 &&
  row.fusionne_vers == null

/** Authenticated read-only preview; no capture, receipt, lock or remote mutation. */
export async function planGoogleForm(input: GoogleFormInput & { token: string }) {
  const { event, unmapped } = validateGoogleFormPayload(input)
  if (unmapped) return { state: 'plan', code: 'unmapped_fields' }
  const { target, code } = await resolve(input.token, event, input.sourceConfig)
  if (!target) return { state: 'plan', code }
  const before = (await lireEnregistrement(input.token, 'participations', target.Id)) as Row
  if (!sameTarget(before, target)) return { state: 'plan', code: 'target_changed' }
  try {
    const { patch, issues } = projectGoogleForm(event, before)
    return {
      state: 'plan',
      code: issues[0] ?? 'ready',
      targetId: target.Id,
      before: pick(before),
      patch,
      issues,
    }
  } catch {
    return { state: 'plan', code: 'notes_invalid' }
  }
}

export async function syncGoogleForm(
  input: GoogleFormInput & {
    db: SubmissionDatabase
    token?: string
    mode?: 'capture' | 'apply'
  },
): Promise<SyncResult> {
  const { db } = input
  const { event, raw, source, hashInput, unmapped } = validateGoogleFormPayload(input)
  const sourceKey = await digest(JSON.stringify([source.spreadsheetId, source.sheetId, source.row]))
  // Separate receipts from the retired implementation: no legacy success can
  // acknowledge a transition event without storing its complete source.
  const key = await digest(JSON.stringify(['transition-v1', sourceKey, source.revision]))
  const payloadHash = await digest(hashInput)
  const captureKey = await digest(JSON.stringify([key, payloadHash]))
  const result = (state: SyncResult['state'], code: string): SyncResult => ({
    state,
    code,
    receipt: key,
  })
  await db
    .prepare(
      `INSERT INTO google_form_transition_captures(capture_key,event_key,payload_hash,payload,code)
    VALUES (?,?,?,?,'captured') ON CONFLICT(capture_key) DO NOTHING`,
    )
    .bind(captureKey, key, payloadHash, raw)
    .run()
  const captureCode = async (code: string) => {
    const updated = await db
      .prepare('UPDATE google_form_transition_captures SET code=? WHERE capture_key=?')
      .bind(code, captureKey)
      .run()
    if (updated.meta.changes !== 1) throw new Error('capture_missing')
  }
  const changed = await db
    .prepare(
      `INSERT INTO google_form_events
    (event_key,source_key,source_revision,payload_hash,source_at,kind,cohort_id,state,code,payload) VALUES (?,?,?,?,?,?,2,'processing','checking',?)
    ON CONFLICT(event_key) DO UPDATE SET state='processing',code='checking',updated_at=CURRENT_TIMESTAMP
    WHERE google_form_events.payload_hash=excluded.payload_hash AND (google_form_events.state='retryable'
      OR (google_form_events.state='review' AND google_form_events.code IN ('captured','identity_unresolved','notes_invalid')))`,
    )
    .bind(key, sourceKey, source.revision, payloadHash, source.submittedAt, event.kind, raw)
    .run()
  if (!changed.meta.changes) {
    const r = await db
      .prepare('SELECT state,code,payload_hash FROM google_form_events WHERE event_key=?')
      .bind(key)
      .first<SyncResult & { payload_hash: string }>()
    if (!r) throw new Error('receipt_missing')
    if (r.payload_hash !== payloadHash) {
      await captureCode('revision_conflict')
      return result('review', 'revision_conflict')
    }
    const newer = await db
      .prepare(
        'SELECT event_key FROM google_form_events WHERE source_key=? AND source_revision>? LIMIT 1',
      )
      .bind(sourceKey, source.revision)
      .first()
    if (newer) return result('review', 'stale_source')
    if (
      await db
        .prepare(
          'SELECT capture_key FROM google_form_transition_captures WHERE event_key=? AND payload_hash<>? LIMIT 1',
        )
        .bind(key, payloadHash)
        .first()
    )
      return result('review', 'revision_conflict')
    return result(r.state, r.code)
  }
  let target: Row | null = null,
    locked = false,
    writing = false
  const lockOwner = 'google-transition:' + key
  const finish = async (state: SyncResult['state'], code: string) => {
    await captureCode(code)
    const r = await db
      .prepare(
        'UPDATE google_form_events SET state=?,code=?,target_id=?,updated_at=CURRENT_TIMESTAMP WHERE event_key=?',
      )
      .bind(state, code, target?.Id ?? null, key)
      .run()
    if (r.meta.changes !== 1) throw new Error('receipt_missing')
    if (locked) {
      await db
        .prepare('DELETE FROM operational_submission_locks WHERE target_id=? AND link_hash=?')
        .bind(target!.Id, lockOwner)
        .run()
      locked = false
    }
    return result(state, code)
  }
  try {
    // Any observed newer version makes an older one ineligible, including a
    // captured/unresolved/processing revision, not only completed writes.
    const newer = await db
      .prepare(
        'SELECT event_key FROM google_form_events WHERE source_key=? AND source_revision>? LIMIT 1',
      )
      .bind(sourceKey, source.revision)
      .first()
    if (newer) return await finish('review', 'stale_source')
    const conflicts = await db
      .prepare(
        'SELECT capture_key FROM google_form_transition_captures WHERE event_key=? AND payload_hash<>? LIMIT 1',
      )
      .bind(key, payloadHash)
      .first()
    if (conflicts) return await finish('review', 'revision_conflict')
    if (unmapped) return await finish('review', 'unmapped_fields')
    if (input.mode !== 'apply') return await finish('review', 'captured')
    if (!input.token) throw new Error('configuration_missing')
    const resolved = await resolve(input.token, event, input.sourceConfig)
    target = resolved.target
    if (!target) return await finish('review', resolved.code)
    const previous = await db
      .prepare(
        'SELECT payload,target_id,kind FROM google_form_events WHERE source_key=? AND source_revision<?',
      )
      .bind(sourceKey, source.revision)
      .all<{ payload: string; target_id: number | null; kind: string }>()
    if (
      previous.results.some(
        (r) =>
          r.kind !== event.kind ||
          (r.target_id != null && r.target_id !== target!.Id) ||
          canonical(parseGoogleFormEvent(JSON.parse(r.payload)).identity) !==
            canonical(event.identity),
      )
    )
      return await finish('review', 'source_identity_changed')
    const claim = await db
      .prepare(
        'INSERT INTO operational_submission_locks(target_id,link_hash) VALUES (?,?) ON CONFLICT(target_id) DO NOTHING',
      )
      .bind(target.Id, lockOwner)
      .run()
    if (!claim.meta.changes) return await finish('retryable', 'target_busy')
    locked = true
    // Historical uncertain writes must be reconciled, not bypassed by new locks.
    if (
      await db
        .prepare('SELECT event_key FROM google_form_locks WHERE target_id=?')
        .bind(target.Id)
        .first()
    )
      return await finish('review', 'legacy_lock')
    if (
      await db
        .prepare(
          'SELECT event_key FROM google_form_events WHERE source_key=? AND source_revision>? LIMIT 1',
        )
        .bind(sourceKey, source.revision)
        .first()
    )
      return await finish('review', 'stale_source')
    const before = (await lireEnregistrement(input.token, 'participations', target.Id)) as Row
    if (!sameTarget(before, target)) return await finish('review', 'target_changed')
    let plan: ReturnType<typeof projectGoogleForm>
    try {
      plan = projectGoogleForm(event, before)
    } catch {
      return await finish('review', 'notes_invalid')
    }
    const prepared = await db
      .prepare(
        'UPDATE google_form_events SET before_json=?,patch_json=?,target_id=?,code=? WHERE event_key=?',
      )
      .bind(JSON.stringify(pick(before)), JSON.stringify(plan.patch), target.Id, 'prepared', key)
      .run()
    if (prepared.meta.changes !== 1) throw new Error('receipt_missing')
    if (plan.issues.length) return await finish('review', plan.issues[0])
    const latest = await lireEnregistrement(input.token, 'participations', target.Id)
    if (canonical(pick(latest)) !== canonical(pick(before)))
      return await finish('review', 'concurrent_change')
    // Recheck atomically with the durable prewrite marker: another revision or
    // conflicting body may have arrived while NocoDB was being read.
    const marked = await db
      .prepare(
        `UPDATE google_form_events SET code='writing' WHERE event_key=? AND state='processing'
        AND NOT EXISTS (SELECT 1 FROM google_form_events WHERE source_key=? AND source_revision>?)
        AND NOT EXISTS (SELECT 1 FROM google_form_transition_captures WHERE event_key=? AND payload_hash<>?)`,
      )
      .bind(key, sourceKey, source.revision, key, payloadHash)
      .run()
    if (marked.meta.changes !== 1) return await finish('review', 'source_changed')
    writing = true
    const response = await fetch(
      `https://app.nocodb.com/api/v2/tables/${NC.tables.participations}/records`,
      {
        method: 'PATCH',
        headers: { 'xc-token': input.token, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ Id: target.Id, ...plan.patch }]),
        signal: AbortSignal.timeout(12_000),
      },
    )
    if (!response.ok) throw new Error('remote_write')
    const saved = await lireEnregistrement(input.token, 'participations', target.Id)
    if (
      !sameTarget(saved, target) ||
      Object.entries(plan.patch).some(([k, v]) =>
        k === 'fiche_contact_recue' ? saved[k] !== true && saved[k] !== 1 : saved[k] !== v,
      )
    )
      throw new Error('readback_failed')
    return await finish('complete', 'saved')
  } catch {
    if (writing) {
      // Never retry/expire an uncertain write; site submissions share this lock.
      try {
        await captureCode('write_uncertain')
        await db
          .prepare(
            "UPDATE google_form_events SET state='review',code='write_uncertain',target_id=?,updated_at=CURRENT_TIMESTAMP WHERE event_key=?",
          )
          .bind(target?.Id ?? null, key)
          .run()
      } catch {
        /* durable prewrite marker + lock remain */
      }
      return result('review', 'write_uncertain')
    }
    return finish('retryable', 'read_failed')
  }
}
