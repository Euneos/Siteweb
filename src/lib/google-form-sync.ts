import { type SubmissionDatabase } from './candidature-store';
import { lireToutes, lireEnregistrement, NC } from './nocodb';
import { isoDate, isoTimestamp, normalise, readContact, writeContact, type ContactProjection } from './google-form-contact';

export interface GoogleFormEvent {
  version: 1
  kind: 'contact' | 'deploiement'
  cohortId: 2
  source: { spreadsheetId: string; sheetId: number; row: number; revision: number; submittedAt: string; readAt: string }
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
export interface GoogleFormSource { spreadsheetId: string; sheetId: number; kind: GoogleFormEvent['kind']; cohortId: 2; firstRow: number; identityMappings?: IdentityMapping[] }
export type SyncResult = { state: 'complete' | 'review' | 'processing' | 'retryable'; code: string; receipt: string };
type Row = Record<string, unknown> & { Id: number };
const pick = (row: Record<string, unknown>) => Object.fromEntries([
  'Id', 'etablissements_id', 'cohortes_id', 'fusionne_vers', 'notes', 'fiche_contact_recue',
  'date_debut_formation', 'date_fin_formation', 'statut_formation', 'UpdatedAt',
].map(k => [k, row[k] ?? null]));
const compact = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');

/** Canonicalize once: unknown payload keys cannot change the idempotency key. */
export function parseGoogleFormEvent(value: unknown): GoogleFormEvent {
  const v = value as GoogleFormEvent;
  const str = (x: unknown, max = 2000): string => {
    if (typeof x !== 'string' || x.length > max || x.includes('[EUNEOS_CONTACT_V1]') || x.includes('[/EUNEOS_CONTACT_V1]')) throw new Error('payload_invalid');
    return x.trim();
  };
  const timestamp = (x: unknown) => {
    const s = str(x, 40);
    if (!isoTimestamp(s)) throw new Error('payload_invalid');
    return new Date(s).toISOString();
  };
  if (!v || v.version !== 1 || v.cohortId !== 2 || !['contact', 'deploiement'].includes(v.kind) ||
    !v.source || !Number.isSafeInteger(v.source.sheetId) || v.source.sheetId < 0 || !Number.isSafeInteger(v.source.row) || v.source.row < 2 || !Number.isSafeInteger(v.source.revision) || v.source.revision < 1 ||
    !v.identity || !v.contact || !v.formation) throw new Error('payload_invalid');
  const result: GoogleFormEvent = {
    version: 1, kind: v.kind, cohortId: 2,
    source: { spreadsheetId: str(v.source.spreadsheetId, 128), sheetId: v.source.sheetId, row: v.source.row, revision: v.source.revision, submittedAt: timestamp(v.source.submittedAt), readAt: timestamp(v.source.readAt) },
    identity: { name: str(v.identity.name, 300), city: str(v.identity.city, 150), postcode: str(v.identity.postcode, 30), referenceEmail: str(v.identity.referenceEmail, 254).toLowerCase() },
    contact: { name: str(v.contact.name, 300), email: str(v.contact.email, 254), phone: str(v.contact.phone, 100) },
    formation: { start: str(v.formation.start, 100), end: str(v.formation.end, 100), format: str(v.formation.format), planning: str(v.formation.planning) },
    declaredTrainer: str(v.declaredTrainer), participants: str(v.participants, 8000),
  };
  if (!/^[\w-]{10,128}$/.test(result.source.spreadsheetId) || !result.identity.name ||
    Date.parse(result.source.submittedAt) > Date.now() + 300_000 || Date.parse(result.source.readAt) > Date.now() + 300_000) throw new Error('payload_invalid');
  return result;
}
export function parseGoogleFormSources(value: string): GoogleFormSource[] {
  const a = JSON.parse(value) as GoogleFormSource[];
  if (!Array.isArray(a) || !a.length || a.length > 4 || a.some(x => !x || !/^[\w-]{10,128}$/.test(x.spreadsheetId) ||
    !Number.isSafeInteger(x.sheetId) || x.sheetId < 0 || !Number.isSafeInteger(x.firstRow) || x.firstRow < 2 || x.cohortId !== 2 || !['contact', 'deploiement'].includes(x.kind)) ||
    new Set(a.map(x => `${x.spreadsheetId}:${x.sheetId}`)).size !== a.length) throw new Error('sources_invalid');
  for (const s of a) {
    if (s.identityMappings !== undefined && (!Array.isArray(s.identityMappings) || s.identityMappings.length > 100 || s.identityMappings.some(m =>
      !m || !Number.isSafeInteger(m.schoolId) || m.schoolId < 1 || !m.submitted || !m.expected ||
      ['name', 'city', 'postcode', 'referenceEmail'].some(k => typeof (m.submitted as Record<string, unknown>)[k] !== 'string') ||
      !m.submitted.name || ['name','city','postcode'].some(k => typeof (m.expected as Record<string, unknown>)[k] !== 'string' || !(m.expected as Record<string, unknown>)[k])))) throw new Error('identity_mapping_invalid');
  }
  return a;
}

/** Requires independently identifying coordinates, never a name/email first-match. */
export function matchSchool(event: GoogleFormEvent, schools: Row[], dossiers: Row[], mappings: IdentityMapping[] = []): Row | null {
  const i = event.identity;
  const postcode = (x: unknown) => normalise(x).replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
  const explicit = mappings.filter(m => Object.keys(i).every(k => normalise(m.submitted[k as keyof typeof i]) === normalise(i[k as keyof typeof i])));
  if (explicit.length > 1) return null;
  if (explicit.length === 1) {
    const m = explicit[0];
    const school = schools.filter(s => s.Id === m.schoolId && normalise(s.nom) === normalise(m.expected.name) &&
      normalise(s.ville) === normalise(m.expected.city) && postcode(s.cp) === postcode(m.expected.postcode));
    if (school.length !== 1) return null;
    const targets = dossiers.filter(x => x.etablissements_id === m.schoolId && x.cohortes_id === 2 && x.fusionne_vers == null);
    return targets.length === 1 ? targets[0] : null;
  }
  if (!(i.city && i.postcode) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.referenceEmail)) return null;
  const matches = schools.filter(s => normalise(s.nom) === normalise(i.name) &&
    (!i.city || normalise(s.ville) === normalise(i.city)) && (!i.postcode || postcode(s.cp) === postcode(i.postcode)) &&
    (!i.referenceEmail || compact(s.referent_email).toLowerCase() === i.referenceEmail));
  if (matches.length !== 1) return null;
  const targets = dossiers.filter(x => x.etablissements_id === matches[0].Id && x.cohortes_id === 2 && x.fusionne_vers == null);
  return targets.length === 1 ? targets[0] : null;
}

/** Only operational fields + one provenance block, no identity/status/relations. */
export function projectGoogleForm(event: GoogleFormEvent, target: Row) {
  const notes = typeof target.notes === 'string' ? target.notes : '', previous = readContact(notes);
  const f = event.formation;
  const start = isoDate(f.start), end = isoDate(f.end);
  const singleRow = previous?.source.spreadsheetId === event.source.spreadsheetId && previous.source.rows.length === 1 && previous.source.rows[0] === event.source.row;
  const generated = previous?.formation.syncIssues as { spreadsheetId?: unknown; sheetId?: unknown; row?: unknown; revision?: unknown; technical?: unknown } | undefined;
  const canRecalculate = singleRow && generated?.spreadsheetId === event.source.spreadsheetId && generated.sheetId === event.source.sheetId &&
    generated.row === event.source.row && typeof generated.revision === 'number' && event.source.revision > generated.revision &&
    Array.isArray(generated.technical) && generated.technical.every(x => typeof x === 'string');
  // Only technical issues owned by this exact source revision may be recalculated.
  // Parent/human/multi-row contradictions have no such ownership and stay sticky.
  const issues: string[] = event.kind === 'contact' ? (previous?.formation.issues ?? []).filter(x =>
    !canRecalculate || !(generated!.technical as string[]).includes(x)) : [];
  const technical: string[] = [];
  if (f.start && !start) technical.push('Date de début invalide ; à confirmer.');
  if (f.end && !end) technical.push('Date de fin invalide ; à confirmer.');
  if (!start || !end) technical.push('Paire de dates incomplète ; à préciser.');
  if (start && end && start > end) technical.push('Fin antérieure au début ; à confirmer.');
  if ([start, end].some(x => x && !['2026','2027'].includes(x.slice(0,4)))) technical.push('Date hors des années 2026–2027 de la campagne configurée ; à confirmer.');
  issues.push(...technical);
  const oldStart = compact(target.date_debut_formation), oldEnd = compact(target.date_fin_formation);
  const status = compact(target.statut_formation);
  const protectedStatus = !['', 'Prévisionnelle', 'À préciser', 'Programmée'].includes(status);
  const sameRow = singleRow;
  const deploymentWins = event.kind === 'contact' && (previous?.formation.kind === 'deploiement' || compact(target.statut_formation) === 'Programmée');
  const changed = (oldStart && oldStart !== start) || (oldEnd && oldEnd !== end);
  const canSupersede = previous && (sameRow || (event.kind === 'deploiement' && previous.formation.kind === 'previsionnelle'));
  if (changed && !canSupersede && !deploymentWins) issues.push('Dates différentes du dossier ou d’une autre réponse ; arbitrage requis.');
  if (changed && protectedStatus) issues.push('Formation déjà avancée ; modification des dates à valider.');
  const reliable = !issues.length;
  const projection: ContactProjection = {
    ...previous,
    version: 1,
    source: { ...previous?.source, spreadsheetId: event.source.spreadsheetId,
      rows: previous?.source.spreadsheetId === event.source.spreadsheetId ? [...new Set([...previous.source.rows, event.source.row])].sort((a, b) => a - b) : [event.source.row],
      readAt: event.source.readAt },
    receivedAt: event.kind === 'contact' ? previous?.receivedAt ?? event.source.submittedAt : previous?.receivedAt ?? null,
    formation: { ...previous?.formation, start, end, kind: event.kind === 'contact' ? 'previsionnelle' : 'deploiement', format: f.format, planning: f.planning, issues: [...new Set(issues)],
      syncIssues: { spreadsheetId: event.source.spreadsheetId, sheetId: event.source.sheetId, row: event.source.row, revision: event.source.revision, technical } },
    declaredTrainers: event.declaredTrainer ? [declaredTrainer(event.declaredTrainer)] : previous?.declaredTrainers ?? [],
    participants: event.participants && event.participants !== previous?.participants.declared ? { ...previous?.participants, declared: event.participants, unresolved: [event.participants], importedCount: previous?.participants.importedCount ?? 0 }
      : previous?.participants ?? { declared: '', unresolved: [], importedCount: 0 },
  };
  const patch: Record<string, unknown> = {};
  if (event.kind === 'contact') patch.fiche_contact_recue = true;
  if (deploymentWins) {
    // Keep attribution of confirmed dates intact. New contact remains in D1 history.
    if (previous) return { patch: { ...patch, notes: writeContact(notes, {
      ...previous, receivedAt: previous.receivedAt ?? event.source.submittedAt.slice(0, 10),
    }) }, issues: ['contact_after_deployment'] };
    // A status alone is not proof of a Google deployment response. Keep this
    // source labelled as a forecast and leave the existing base dates untouched.
    projection.formation.issues.push('Dossier déjà programmé ; prévisions non appliquées, provenance du déploiement à compléter.');
  } else {
    if (reliable) { patch.date_debut_formation = start; patch.date_fin_formation = end; }
    if (['', 'Prévisionnelle', 'À préciser', 'Programmée'].includes(compact(target.statut_formation))) {
      patch.statut_formation = reliable ? event.kind === 'contact' ? 'Prévisionnelle' : 'Programmée' : 'À préciser';
    }
  }
  patch.notes = writeContact(notes, projection);
  return { patch, issues: projection.formation.issues };
}

function declaredTrainer(text: string): { name: string; email?: string } {
  const emails = text.match(/[^\s<>(),;]+@[^\s<>(),;]+\.[^\s<>(),;]+/g) ?? [];
  const name = emails.reduce((s, email) => s.replace(email, ''), text).replace(/[<>]/g, '').trim();
  return { name: name || 'Nom à préciser', ...(emails.length === 1 ? { email: emails[0] } : {}) };
}

/** Authenticated preflight of a source row. No D1 receipt and no remote writes. */
export async function planGoogleForm(input: { token: string; event: GoogleFormEvent; sourceConfig?: GoogleFormSource }) {
  const { token, event } = input;
  const cohorts = await lireToutes(token, 'cohortes', 'Id');
  if (!cohorts.some(x => x.Id === 2)) return { state: 'plan', code: 'cohort_missing' };
  const schools = await lireToutes(token, 'etablissements', 'Id,nom,ville,cp,referent_email');
  const dossiers = await lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers');
  const target = matchSchool(event, schools, dossiers, input.sourceConfig?.identityMappings);
  if (!target) return { state: 'plan', code: 'identity_unresolved' };
  const before = await lireEnregistrement(token, 'participations', target.Id) as Row;
  if (before.Id !== target.Id || before.etablissements_id !== target.etablissements_id || before.cohortes_id !== 2 || before.fusionne_vers != null)
    return { state: 'plan', code: 'target_changed' };
  try {
    const { patch, issues } = projectGoogleForm(event, before);
    return { state: 'plan', code: 'ready', targetId: target.Id, before: pick(before), patch, issues };
  } catch { return { state: 'plan', code: 'notes_invalid' }; }
}

export async function syncGoogleForm(input: { db: SubmissionDatabase; token: string; event: GoogleFormEvent; sourceConfig?: GoogleFormSource }): Promise<SyncResult> {
  const { db, token, event } = input;
  const { readAt: _readAt, ...source } = event.source;
  const sourceKey = await digest(JSON.stringify([source.spreadsheetId, source.sheetId, source.row]));
  const key = await digest(JSON.stringify([sourceKey, source.revision]));
  const payloadHash = await digest(JSON.stringify({ ...event, source }));
  const result = (state: SyncResult['state'], code: string): SyncResult => ({ state, code, receipt: key });
  const changed = await db.prepare(`INSERT INTO google_form_events
    (event_key,source_key,source_revision,payload_hash,source_at,kind,cohort_id,state,code,payload) VALUES (?,?,?,?,?,?,2,'processing','checking',?)
    ON CONFLICT(event_key) DO UPDATE SET state='processing',code='checking',updated_at=CURRENT_TIMESTAMP
    WHERE google_form_events.payload_hash=excluded.payload_hash AND (google_form_events.state='retryable'
      OR (google_form_events.state='review' AND google_form_events.code IN ('identity_unresolved','notes_invalid')))`).bind(key, sourceKey, source.revision, payloadHash, source.submittedAt, event.kind, JSON.stringify(event)).run();
  if (!changed.meta.changes) {
    const r = await db.prepare('SELECT state,code,payload_hash FROM google_form_events WHERE event_key=?').bind(key).first<SyncResult & { payload_hash: string }>();
    if (!r) throw new Error('receipt_missing');
    if (r.payload_hash !== payloadHash) return result('review', 'revision_conflict');
    if (r.state === 'complete') {
      const superseded = await db.prepare('SELECT event_key FROM google_form_events WHERE source_key=? AND source_revision>? LIMIT 1')
        .bind(sourceKey, source.revision).first();
      if (superseded) return result('review', 'stale_source');
    }
    return result(r.state, r.code);
  }
  let target: Row | null = null, locked = false, writing = false;
  const finish = async (state: SyncResult['state'], code: string) => {
    const r = await db.prepare('UPDATE google_form_events SET state=?,code=?,target_id=?,updated_at=CURRENT_TIMESTAMP WHERE event_key=?')
      .bind(state, code, target?.Id ?? null, key).run();
    if (r.meta.changes !== 1) throw new Error('receipt_missing');
    // The receipt must be durable BEFORE releasing its target lock.
    if (locked && state !== 'processing') {
      await db.prepare('DELETE FROM google_form_locks WHERE target_id=? AND event_key=?').bind(target!.Id, key).run();
      locked = false;
    }
    return result(state, code);
  };
  try {
    const cohorts = await lireToutes(token, 'cohortes', 'Id');
    if (!cohorts.some(x => x.Id === 2)) return await finish('review', 'cohort_missing');
    const schools = await lireToutes(token, 'etablissements', 'Id,nom,ville,cp,referent_email');
    // lireToutes also injects fusionne_vers and reconciles archives; keep it explicit.
    const dossiers = await lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers');
    target = matchSchool(event, schools, dossiers, input.sourceConfig?.identityMappings);
    if (!target) return await finish('review', 'identity_unresolved');
    const claim = await db.prepare('INSERT INTO google_form_locks(target_id,event_key) VALUES (?,?) ON CONFLICT(target_id) DO NOTHING').bind(target.Id, key).run();
    if (!claim.meta.changes) return await finish('retryable', 'target_busy');
    locked = true;
    const newer = await db.prepare("SELECT event_key FROM google_form_events WHERE source_key=? AND source_revision>? AND state IN ('complete','review') LIMIT 1")
      .bind(sourceKey, source.revision).first();
    if (newer) return await finish('review', 'stale_source');
    const before = await lireEnregistrement(token, 'participations', target.Id) as Row;
    if (before.Id !== target.Id || before.etablissements_id !== target.etablissements_id || before.cohortes_id !== 2 || before.fusionne_vers != null)
      return await finish('review', 'target_changed');
    let plan: ReturnType<typeof projectGoogleForm>;
    try { plan = projectGoogleForm(event, before); } catch { return await finish('review', 'notes_invalid'); }
    const patch = Object.fromEntries(Object.entries(plan.patch).filter(([k, v]) => (before[k] ?? null) !== v));
    await db.prepare('UPDATE google_form_events SET before_json=?,patch_json=?,target_id=?,code=? WHERE event_key=?')
      .bind(JSON.stringify(pick(before)), JSON.stringify(patch), target.Id, 'prepared', key).run();
    // Detect changes since planning. NocoDB v2 PATCH has no atomic CAS; see runbook.
    const latest = await lireEnregistrement(token, 'participations', target.Id);
    if (JSON.stringify(pick(latest)) !== JSON.stringify(pick(before))) return await finish('review', 'concurrent_change');
    if (Object.keys(patch).length) {
      await db.prepare("UPDATE google_form_events SET code='writing' WHERE event_key=?").bind(key).run();
      writing = true;
      const response = await fetch(`https://app.nocodb.com/api/v2/tables/${NC.tables.participations}/records`, {
        method: 'PATCH', headers: { 'xc-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify([{ Id: target.Id, ...patch }]), signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error('remote_write'); // never include remote response/PII in logs
      const saved = await lireEnregistrement(token, 'participations', target.Id);
      if (saved.etablissements_id !== target.etablissements_id || saved.cohortes_id !== 2 || saved.fusionne_vers != null ||
        Object.entries(patch).some(([k, v]) => k === 'fiche_contact_recue' ? saved[k] !== true && saved[k] !== 1 : saved[k] !== v)) throw new Error('readback_failed');
    }
    return await finish('complete', plan.issues.length ? 'saved_with_issues' : 'saved');
  } catch {
    if (writing) {
      // Keep target lock after any uncertain external write, even a Worker crash.
      try { await db.prepare("UPDATE google_form_events SET state='review',code='write_uncertain',target_id=?,updated_at=CURRENT_TIMESTAMP WHERE event_key=?").bind(target?.Id ?? null, key).run(); } catch { /* last phase + lock remain */ }
      return result('review', 'write_uncertain');
    }
    return finish('retryable', 'read_failed');
  }
}
