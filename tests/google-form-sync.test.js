import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { NC } from '../src/lib/nocodb';
import { syncGoogleForm, projectGoogleForm, parseGoogleFormEvent } from '../src/lib/google-form-sync';
import { readContact, CONTACT_OPEN, CONTACT_CLOSE } from '../src/lib/google-form-contact';
import { POST, GET } from '../src/pages/api/hook/google-forms';
const savedFetch = globalThis.fetch;
const secret = 'fictional-local-test-secret-000000000000';
let sql, db, schools, targets, patches, loseResponse, dropPatch, readFailure, concurrent, gets;
const event = (overrides = {}) => ({
  version: 1, kind: 'contact', cohortId: 2,
  source: { spreadsheetId: 'fictional_sheet_id', sheetId: 0, row: 2, revision: 1, submittedAt: '2026-09-10T10:00:00.000Z', readAt: '2026-09-22T10:00:00.000Z' },
  identity: { name: 'Collège Exemple', city: 'Ville Exemple', postcode: '01234', referenceEmail: '' },
  contact: { name: 'Référente fictive', email: 'fiction@example.invalid', phone: '' },
  formation: { start: '2026-10-01', end: '2027-01-10', format: 'Présentiel', planning: '5 séances' },
  declaredTrainer: 'Personne Exemple <fiction@example.invalid>', participants: 'Noms à compléter', ...overrides,
});
beforeEach(() => {
  sql = new Database(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0002_google_form_sync.sql', import.meta.url), 'utf8'));
  db = { prepare: query => ({ bind: (...values) => ({
    run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
    first: async () => sql.query(query).get(...values), all: async () => ({ results: sql.query(query).all(...values) }),
  }) }) };
  schools = [{ Id: 1, nom: 'Collège Exemple', ville: 'Ville Exemple', cp: '1234.0', referent_email: 'fiction@example.invalid' }];
  targets = [{ Id: 7, etablissements_id: 1, cohortes_id: 2, fusionne_vers: null, notes: ' Note humaine\n', fiche_contact_recue: false,
    date_debut_formation: null, date_fin_formation: null, statut_formation: null }];
  patches = []; loseResponse = false; dropPatch = false; readFailure = false; concurrent = false; gets = 0;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url)), parts = u.pathname.split('/');
    if (u.origin !== 'https://app.nocodb.com' || !Object.values(NC.tables).includes(parts[4])) throw new Error('unexpected_destination');
    if (init?.method === 'PATCH') {
      expect(parts[4]).toBe(NC.tables.participations);
      const [patch] = JSON.parse(init.body); patches.push(patch);
      if (!dropPatch) Object.assign(targets.find(x => x.Id === patch.Id), patch);
      if (loseResponse) throw new Error('Lost response AFTER remote commit');
      return Response.json([patch]);
    }
    expect(init?.method ?? 'GET').toBe('GET'); // no creates, links, deletions or email
    if (readFailure) throw new Error('offline');
    const rows = parts[4] === NC.tables.cohortes ? [{ Id: 2 }] : parts[4] === NC.tables.etablissements ? schools : targets;
    if (parts[6]) {
      gets++;
      if (concurrent && gets === 2) targets[0].notes = 'New human edit';
      return Response.json(rows.find(x => x.Id === Number(parts[6])));
    }
    const offset = Number(u.searchParams.get('offset'));
    return Response.json({ list: rows.slice(offset, offset + 1), pageInfo: { isLastPage: offset + 1 >= rows.length } });
  };
});
afterEach(() => { globalThis.fetch = savedFetch; sql.close(); });
const sync = (e = event()) => syncGoogleForm({ db, token: 'fake-nocodb-token', event: parseGoogleFormEvent(e) });
const rows = () => sql.query('SELECT * FROM google_form_events').all();
const locks = () => sql.query('SELECT * FROM google_form_locks').all();
const env = () => ({ runtime: { env: { FORM_SUBMISSIONS: db, NOCODB_TOKEN: 'fake', GOOGLE_FORMS_SYNC_SECRET: secret, GOOGLE_FORMS_SYNC_MODE: 'apply',
  GOOGLE_FORMS_SYNC_SOURCES: JSON.stringify([{ spreadsheetId: 'fictional_sheet_id', sheetId: 0, kind: 'contact', cohortId: 2, firstRow: 2 }]) } } });
const request = (body = event(), host = 'euneos.fr', credential = secret) => new Request(`https://${host}/api/hook/google-forms`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-google-forms-secret': credential }, body: JSON.stringify(body),
});

test('verified contact updates exactly one current dossier; notes + declared data retained, no relationships invented', async () => {
  const result = await sync(); expect(result.state).toBe('complete'); expect(result.code).toBe('saved');
  expect(targets[0].statut_formation).toBe('Prévisionnelle'); expect(targets[0].fiche_contact_recue).toBe(true);
  expect(targets[0].notes.startsWith(' Note humaine\n\n\n')).toBe(true);
  const block = readContact(targets[0].notes);
  expect(block.participants.importedCount).toBe(0);
  expect(block.participants.unresolved).toEqual(['Noms à compléter']);
  expect(block.declaredTrainers).toEqual([{ name: 'Personne Exemple', email: 'fiction@example.invalid' }]);
  expect(rows()[0].payload).toContain('Référente fictive'); expect(locks()).toHaveLength(0);
  expect(Object.keys(patches[0]).sort()).toEqual(['Id','date_debut_formation','date_fin_formation','fiche_contact_recue','notes','statut_formation'].sort());
});
test('12 concurrent submissions / replay after readAt change produce one PATCH', async () => {
  const outcomes = await Promise.all(Array.from({length:12}, () => sync()));
  expect(outcomes.some(x => x.state === 'complete')).toBe(true);
  expect(patches).toHaveLength(1);
  const e = event(); e.source.readAt = '2026-09-22T11:00:00.000Z';
  expect((await sync(e)).state).toBe('complete'); expect(patches).toHaveLength(1); expect(rows()).toHaveLength(1);
});
test('lost PATCH reply holds durable receipt and target lock, even for a different source row', async () => {
  loseResponse = true;
  expect((await sync()).code).toBe('write_uncertain'); expect(targets[0].fiche_contact_recue).toBe(true);
  loseResponse = false;
  expect((await sync()).code).toBe('write_uncertain'); expect(patches).toHaveLength(1);
  const e = event(); e.source.row = 3;
  expect((await sync(e)).code).toBe('target_busy'); expect(locks()).toHaveLength(1); expect(patches).toHaveLength(1);
});
test('unpersisted patch is uncertain, never false success', async () => {
  dropPatch = true; expect((await sync()).code).toBe('write_uncertain'); expect(locks()).toHaveLength(1);
});
test('read-only failure retries, independent target continues despite uncertain previous write', async () => {
  readFailure = true; expect((await sync()).state).toBe('retryable'); expect(locks()).toHaveLength(0);
  readFailure = false; loseResponse = true; await sync(); loseResponse = false;
  schools.push({ Id: 2, nom: 'Collège Autre', ville: 'Ville Exemple', cp: '01234' });
  targets.push({ ...targets[0], Id: 8, etablissements_id: 2, notes: '', date_debut_formation: null, date_fin_formation: null });
  const e = event(); e.identity.name = 'Collège Autre'; e.source.row = 4;
  expect((await sync(e)).state).toBe('complete'); expect(locks()).toHaveLength(1);
});
test('archives excluded, explicit cohort retained without active-cohort inference', async () => {
  targets.push({ ...targets[0], Id: 8, cohortes_id: 1 });
  targets.push({ ...targets[0], Id: 9, fusionne_vers: 7 });
  await sync(); expect(patches.map(x => x.Id)).toEqual([7]);
});
test.each(['homonym','duplicate dossier','name only','contradictory email','wrong city','wrong cohort'])(
  'ambiguous identity refuses all writes: %s', async reason => {
    const e = event();
    if (reason === 'homonym') schools.push({ ...schools[0], Id: 2 });
    if (reason === 'duplicate dossier') targets.push({ ...targets[0], Id: 8 });
    if (reason === 'name only') { e.identity.city = ''; e.identity.postcode = ''; }
    if (reason === 'contradictory email') e.identity.referenceEmail = 'other@example.invalid';
    if (reason === 'wrong city') e.identity.city = 'Wrong';
    if (reason === 'wrong cohort') targets[0].cohortes_id = 1;
    expect((await sync(e)).code).toBe('identity_unresolved'); expect(patches).toHaveLength(0);
  });
test('exact name AND reference email is sufficient when source has no city/postcode', async () => {
  const e = event(); e.identity = { name: 'Collège Exemple', city: '', postcode: '', referenceEmail: 'fiction@example.invalid' };
  expect((await sync(e)).state).toBe('complete');
});
test.each([
  ['2026-10-10','2026-03-15'], ['2026-02-30','2026-10-01'], ['garbage',''], ['', '2026-12-01']
])('bad/incomplete dates %s / %s preserve reception, record issues and do not affect other fields', async (start,end) => {
  const e = event(); e.formation.start = start; e.formation.end = end;
  expect((await sync(e)).code).toBe('saved_with_issues'); expect(targets[0].fiche_contact_recue).toBe(true);
  expect(targets[0].date_debut_formation).toBeNull(); expect(targets[0].date_fin_formation).toBeNull();
  expect(targets[0].statut_formation).toBe('À préciser'); expect(readContact(targets[0].notes).formation.issues.length).toBeGreaterThan(0);
});
test('different response with contradictory dates cannot silently replace first forecast', async () => {
  await sync(); const e = event(); e.source.row = 3; e.formation.start = '2026-10-20';
  expect((await sync(e)).code).toBe('saved_with_issues'); expect(targets[0].date_debut_formation).toBe('2026-10-01');
  expect(readContact(targets[0].notes).source.rows).toEqual([2,3]);
});
test('correction of same source row updates forecast; original replay cannot roll it back', async () => {
  await sync(); const e = event(); e.formation.start = '2026-10-20'; e.source.submittedAt = '2026-09-11T10:00:00.000Z'; e.source.revision = 2;
  await sync(e); expect(targets[0].date_debut_formation).toBe('2026-10-20');
  await sync(); expect(targets[0].date_debut_formation).toBe('2026-10-20'); expect(rows()).toHaveLength(2);
});
test('a delayed never-seen old version is rejected after a newer source timestamp', async () => {
  const newer = event(); newer.source.submittedAt = '2026-09-11T10:00:00.000Z'; newer.source.revision = 2; await sync(newer);
  const old = event(); old.formation.start = '2026-09-30';
  expect((await sync(old)).code).toBe('stale_source'); expect(patches).toHaveLength(1);
});
test('deployment takes priority, preserves participants imported count, later contact cannot replace it', async () => {
  await sync(); let block = readContact(targets[0].notes); block.participants.importedCount = 17;
  targets[0].notes = 'Human\n'+CONTACT_OPEN+'\n'+JSON.stringify(block)+'\n'+CONTACT_CLOSE+'\nAfter';
  const deployed = event({ kind: 'deploiement', participants: '', declaredTrainer: '' });
  deployed.source.spreadsheetId = 'deployment_sheet_id'; deployed.formation.start = '2026-11-04';
  await sync(deployed); expect(targets[0].statut_formation).toBe('Programmée');
  block = readContact(targets[0].notes); expect(block.participants.importedCount).toBe(17); expect(block.formation.kind).toBe('deploiement');
  const later = event(); later.source.row = 5;
  await sync(later); expect(targets[0].date_debut_formation).toBe('2026-11-04');
  expect(readContact(targets[0].notes).source.spreadsheetId).toBe('deployment_sheet_id');
  expect(targets[0].notes.startsWith('Human\n')).toBe(true); expect(targets[0].notes.endsWith('\nAfter')).toBe(true);
});
test('deployment alone never asserts contact received and terminal training status is preserved', async () => {
  targets[0].statut_formation = 'Terminée';
  await sync(event({ kind: 'deploiement' }));
  expect(targets[0].fiche_contact_recue).toBe(false); expect(targets[0].statut_formation).toBe('Terminée');
  expect(readContact(targets[0].notes).receivedAt).toBeNull();
});
test('malformed or duplicate notes are retained and flagged, not discarded', async () => {
  targets[0].notes = CONTACT_OPEN+'bad json'+CONTACT_CLOSE;
  expect((await sync()).code).toBe('notes_invalid'); expect(patches).toHaveLength(0);
  expect(() => readContact(CONTACT_OPEN+'{}'+CONTACT_CLOSE+CONTACT_OPEN+'{}'+CONTACT_CLOSE)).toThrow();
});
test('human edits after plan block PATCH', async () => {
  concurrent = true;
  expect((await sync()).code).toBe('concurrent_change'); expect(patches).toHaveLength(0); expect(locks()).toHaveLength(0);
});
test('failed receipt completion AFTER write does not release target lock', async () => {
  const wrapped = { prepare: query => query.startsWith('UPDATE google_form_events SET state=') ? { bind: () => ({ run: async () => { throw new Error('db failed'); } }) } : db.prepare(query) };
  const outcome = await syncGoogleForm({ db: wrapped, token: 'fake', event: event() });
  expect(outcome.code).toBe('write_uncertain'); expect(locks()).toHaveLength(1); expect(patches).toHaveLength(1);
});
test('API denies previews/auth/source/cohort before any NocoDB request', async () => {
  for (const [req, expected] of [[request(event(),'preview.pages.dev'),404],[request(event(),'euneos.fr','wrong'),401]]) {
    expect((await POST({ request:req,locals:env() })).status).toBe(expected);
  }
  const unknown = event(); unknown.source.sheetId = 123;
  expect((await POST({request:request(unknown),locals:env()})).status).toBe(403);
  expect((await POST({request:request(event({cohortId:1})),locals:env()})).status).toBe(400);
  expect(rows()).toHaveLength(0); expect(gets).toBe(0);
});
test('API refuses oversized streamed body, malformed JSON, missing migration/config', async () => {
  expect((await POST({request:request({huge:'x'.repeat(40000)}),locals:env()})).status).toBe(413);
  const bad = new Request('https://euneos.fr/api/hook/google-forms',{method:'POST',headers:{'content-type':'application/json','x-google-forms-secret':secret},body:'no'});
  expect((await POST({request:bad,locals:env()})).status).toBe(400);
  const missing = env(); delete missing.runtime.env.GOOGLE_FORMS_SYNC_SOURCES;
  expect((await GET({request:request(),locals:missing})).status).toBe(503);
  sql.exec('DROP TABLE google_form_events');
  expect((await GET({request:request(),locals:env()})).status).toBe(503);
});
test('API readiness is side-effect free; success response exposes only technical receipt', async () => {
  const ready = await GET({request:request(),locals:env()}); expect((await ready.json()).ready).toBe(true); expect(rows()).toHaveLength(0);
  const res = await POST({request:request(),locals:env()}); expect(res.status).toBe(200);
  const body = await res.json(); expect(Object.keys(body).sort()).toEqual(['code','receipt','state']);
  expect(body.code).toBe('saved');
});

test('parent microseconds/offsets/extras and two-source issues survive a replay of either row', async () => {
  const parent = {
    version:1, source:{spreadsheetId:'fictional_sheet_id',rows:[2,3],readAt:'2026-09-22T19:00:00.123456+00:00'},
    sourceResponses:[{row:2,original:'First response'},{row:3,original:'Contradictory response'}],
    receivedAt:'2026-09-10T12:00:00+02:00',
    formation:{start:null,end:null,kind:'previsionnelle',format:'Présentiel',planning:'',issues:['Deux réponses contradictoires'],validationSource:{kind:'human-review',id:'fictional'}},
    declaredTrainers:[], participants:{declared:'Two people',unresolved:['Initials'],importedCount:17,identityNotes:['Initials are not resolved']},
  };
  targets[0].notes = '  Human\n'+CONTACT_OPEN+'\n'+JSON.stringify(parent)+'\n'+CONTACT_CLOSE+'\n  ';
  targets[0].statut_formation='À préciser';
  expect((await sync()).code).toBe('saved_with_issues');
  expect(targets[0].date_debut_formation).toBeNull(); expect(targets[0].date_fin_formation).toBeNull();
  const block = readContact(targets[0].notes);
  expect(block.formation.issues).toContain('Deux réponses contradictoires');
  expect(block.formation.validationSource).toEqual(parent.formation.validationSource);
  expect(block.sourceResponses).toEqual(parent.sourceResponses);
  expect(block.participants.identityNotes).toEqual(parent.participants.identityNotes);
  expect(block.participants.importedCount).toBe(17);
  expect(block.receivedAt).toBe(parent.receivedAt);
  expect(targets[0].notes.endsWith('\n  ')).toBe(true);
});
test.each(['2026-09-22','2026-09-22T20:00:00+02:00','2026-09-22T18:00:00.1Z','2026-09-22T18:00:00.123456+00:00'])(
  'parent receivedAt accepts valid ISO %s', receivedAt => {
    const patch = projectGoogleForm(event(),targets[0]).patch;
    const block = readContact(patch.notes); block.receivedAt=receivedAt;
    expect(readContact(CONTACT_OPEN+JSON.stringify(block)+CONTACT_CLOSE).receivedAt).toBe(receivedAt);
  });
test('same-row revision recalculates owned technical issues; deployment can confirm it', async () => {
  const bad = event(); bad.formation.end='2025-01-10'; await sync(bad);
  const corrected = event(); corrected.source.revision = 2;
  expect((await sync(corrected)).code).toBe('saved'); expect(targets[0].date_debut_formation).toBe('2026-10-01');
  const deployment = event({kind:'deploiement'}); deployment.source.spreadsheetId='deployment_sheet_id';
  await sync(deployment); expect(targets[0].date_debut_formation).toBe('2026-10-01'); expect(targets[0].statut_formation).toBe('Programmée');
});
test('private reviewed mapping handles source alias, retains raw identity; stale/ambiguous mapping refuses', async () => {
  const e=event(); e.identity.name='COLLEGE EXEMPLE FRANCIS';
  const mapping={submitted:e.identity,schoolId:1,expected:{name:'Collège Exemple',city:'Ville Exemple',postcode:'01234'}};
  expect((await sync(e)).code).toBe('identity_unresolved');
  // A targeted authenticated retry can recheck this read-only refusal after mapping correction.
  expect((await syncGoogleForm({db,token:'fake',event:e,sourceConfig:{identityMappings:[mapping]}})).state).toBe('complete');
  expect(rows()[0].payload).toContain('COLLEGE EXEMPLE FRANCIS');
  e.source.row=3;
  expect((await syncGoogleForm({db,token:'fake',event:e,sourceConfig:{identityMappings:[mapping,mapping]}})).code).toBe('identity_unresolved');
  e.source.row=4;
  expect((await syncGoogleForm({db,token:'fake',event:e,sourceConfig:{identityMappings:[{...mapping,expected:{...mapping.expected,city:'wrong'}}]}})).code).toBe('identity_unresolved');
});

test('source revisions apply A -> B -> A without recycling a previous complete content receipt', async () => {
  const a=event(); await sync(a);
  const b=event(); b.source.revision=2; b.formation.start='2026-10-20'; await sync(b);
  const back=event(); back.source.revision=3; await sync(back);
  expect(targets[0].date_debut_formation).toBe(a.formation.start); expect(patches).toHaveLength(3);
  expect(rows().map(x=>x.source_revision)).toEqual([1,2,3]);
  await sync(b); expect(targets[0].date_debut_formation).toBe(a.formation.start); expect(patches).toHaveLength(3);
});
test('same source revision with different contents is refused, not falsely reported complete', async () => {
  await sync();const changed=event();changed.formation.start='2026-10-20';
  expect((await sync(changed)).code).toBe('revision_conflict');expect(patches).toHaveLength(1);
});
test('unchanged participant declaration retains imported qualification and extra notes', async () => {
  await sync();const old=readContact(targets[0].notes);
  old.participants={declared:event().participants,unresolved:[],importedCount:17,identityNotes:['Verified import']};
  targets[0].notes=CONTACT_OPEN+JSON.stringify(old)+CONTACT_CLOSE;
  const changed=event();changed.source.revision=2;changed.formation.format='Hybride';await sync(changed);
  expect(readContact(targets[0].notes).participants).toEqual(old.participants);
});
test('technical source correction never erases human or multiple-source issues', async () => {
  const bad=event();bad.formation.start='invalid';await sync(bad);
  const old=readContact(targets[0].notes);old.formation.issues.push('Confirmation humaine attendue');
  targets[0].notes=CONTACT_OPEN+JSON.stringify(old)+CONTACT_CLOSE;
  const corrected=event();corrected.source.revision=2;await sync(corrected);
  const block=readContact(targets[0].notes);expect(block.formation.issues).toEqual(['Confirmation humaine attendue']);
  expect(targets[0].date_debut_formation).toBeNull();
});

test('server defaults to read-only plan; authenticated operator can force plan even when apply enabled', async () => {
  const configuration=env();delete configuration.runtime.env.GOOGLE_FORMS_SYNC_MODE;
  let res=await POST({request:request(),locals:configuration});let result=await res.json();
  expect(result.state).toBe('plan');expect(result.code).toBe('ready');expect(result.targetId).toBe(7);
  expect(result.patch.fiche_contact_recue).toBe(true);expect(rows()).toHaveLength(0);expect(patches).toHaveLength(0);
  const req=request();req.headers.set('x-google-forms-mode','plan');
  result=await (await POST({request:req,locals:env()})).json();expect(result.state).toBe('plan');expect(rows()).toHaveLength(0);expect(patches).toHaveLength(0);
});

test('server source firstRow rejects historical row even with correct cohort and valid secret',async()=>{
  const configuration=env();const sources=JSON.parse(configuration.runtime.env.GOOGLE_FORMS_SYNC_SOURCES);sources[0].firstRow=3;
  configuration.runtime.env.GOOGLE_FORMS_SYNC_SOURCES=JSON.stringify(sources);
  const res=await POST({request:request(),locals:configuration});expect(res.status).toBe(403);expect(rows()).toHaveLength(0);expect(patches).toHaveLength(0);
  const next=event();next.source.row=3;expect((await POST({request:request(next),locals:configuration})).status).toBe(200);expect(patches).toHaveLength(1);
});
test.each(['2025-10-01','2028-10-01'])('valid ISO date outside configured campaign stays an issue, never programmed: %s',async start=>{
  const e=event({kind:'deploiement'});e.formation.start=start;e.formation.end=start.slice(0,4)+'-12-01';
  expect((await sync(e)).code).toBe('saved_with_issues');expect(targets[0].date_debut_formation).toBeNull();expect(targets[0].statut_formation).toBe('À préciser');
  expect(readContact(targets[0].notes).formation.issues.some(x=>x.includes('2026–2027'))).toBe(true);expect(targets[0].cohortes_id).toBe(2);
});

test('lost/reset adapter revision counters cannot falsely report an old completed value as current',async()=>{
  const a=event();await sync(a);const b=event();b.source.revision=2;b.formation.start='2026-10-20';await sync(b);
  expect((await sync(a)).code).toBe('stale_source');expect(targets[0].date_debut_formation).toBe('2026-10-20');expect(patches).toHaveLength(2);
});
