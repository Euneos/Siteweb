import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { enregistrerCandidature, type SubmissionDatabase } from '../src/lib/candidature-store'
import { NC } from '../src/lib/nocodb'
import {
  prepareAcknowledgement,
  prepareDecisionMail,
  confirmDecisionMail,
  dispatchCandidatureMail,
  getCandidatureMail,
  listCandidatureMails,
  retryRejectedMail,
  reconcileCandidatureMail,
  cancelDecisionDraft,
  type CandidatureMailEnv,
} from '../src/lib/candidature-mail'
import { acknowledgementPayload } from '../src/lib/candidature-mail-templates'
const originalFetch = globalThis.fetch
let sql: Database,
  db: SubmissionDatabase,
  env: CandidatureMailEnv,
  parts: any[],
  schools: any[],
  calls: any[],
  events: any[]
let provider: () => Promise<Response>,
  hook: ((url: URL, init?: RequestInit) => Promise<void>) | undefined
const actor = 'manager@example.invalid'
const templates = {
  accepted: {
    version: 'test-accepted-v1',
    approvalRef: 'TEST_ONLY',
    subject: 'Acceptation {{etablissement}}',
    text: 'Décision pour {{cohorte}} — {{etablissement}}',
  },
  refused: {
    version: 'test-refused-v1',
    approvalRef: 'TEST_ONLY',
    subject: 'Refus {{etablissement}}',
    text: 'Décision pour {{cohorte}} — {{etablissement}}',
  },
}
function wrap(database: Database): SubmissionDatabase {
  return {
    prepare: (query: string) => ({
      bind: (...v: any[]) => ({
        run: async () => ({ meta: { changes: database.query(query).run(...v).changes } }),
        first: async <T>() => database.query(query).get(...v) as T | null,
        all: async <T>() => ({ results: database.query(query).all(...v) as T[] }),
      }),
    }),
  }
}
beforeEach(() => {
  sql = new Database(':memory:')
  for (const f of ['0001_form_submissions.sql', '0002_google_form_sync.sql', '0004_operational_submissions.sql', '0007_candidature_mails.sql', '0008_candidature_decisions.sql'])
    sql.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'))
  db = wrap(sql)
  parts = [
    {
      Id: 7,
      etablissements_id: 1,
      cohortes_id: 2,
      fusionne_vers: null,
      statut: 'Candidature recue',
    },
  ]
  schools = [
    {
      Id: 1,
      nom: 'Collège fictif',
      cp: '01000',
      ville: 'Ville fictive',
      referent_email: 'test@example.invalid',
    },
  ]
  env = {
    CANDIDATURE_MAIL_REGISTRY_ENABLED: 'true',
    CANDIDATURE_DECISION_SEND_ENABLED: 'true',
    CANDIDATURE_MAIL_OWNER: 'site',
    CANDIDATURE_MAIL_SEND_ENABLED: 'true',
    BREVO_API_KEY: 'fictive-key',
    CANDIDATURE_DECISION_TEMPLATES: JSON.stringify(templates),
  }
  calls = []
  events = []
  hook = undefined
  provider = async () => Response.json({ messageId: '<fictive-message>' }, { status: 201 })
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const u = new URL(String(url))
    calls.push({
      url: u.href,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    if (hook) await hook(u, init)
    if (u.origin === 'https://api.brevo.com') {
      if (u.pathname === '/v3/smtp/email' && init?.method === 'POST') return provider()
      if (u.pathname === '/v3/smtp/statistics/events' && !init?.method)
        return Response.json({ events })
      throw new Error('UNEXPECTED_BREVO')
    }
    if (u.origin !== 'https://app.nocodb.com') throw new Error('NO_REAL_NETWORK')
    const [, , , , table, operation, id] = u.pathname.split('/')
    const rows =
      table === NC.tables.participations
        ? parts
        : table === NC.tables.etablissements
          ? schools
          : table === NC.tables.cohortes
            ? [{ Id: 2, nom: '2026–2027', active: true }]
            : null
    if (!rows) throw new Error('UNEXPECTED_TABLE')
    if (!init?.method || init.method === 'GET')
      return Response.json(
        id ? rows.find((r) => r.Id === Number(id)) : { list: rows, pageInfo: { isLastPage: true } },
      )
    if (init.method === 'PATCH' && table === NC.tables.participations) {
      const body=JSON.parse(String(init.body)); for(const patch of body) Object.assign(parts.find(p=>p.Id===patch.Id),patch); return Response.json(body)
    }
    if (init.method === 'POST') {
      const data = JSON.parse(String(init.body))
      if (operation === 'links') {
        const row = parts.find((r) => r.Id === Number(u.pathname.split('/')[8]))
        row[
          u.pathname.includes(NC.liens['participations.etablissement'])
            ? 'etablissements_id'
            : 'cohortes_id'
        ] = data[0].Id
        return Response.json(true)
      }
      const row = { Id: table === NC.tables.participations ? 8 : 2, ...data[0] }
      rows.push(row)
      return Response.json([row])
    }
    throw new Error('UNEXPECTED_REMOTE_WRITE')
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
  sql.close()
})
const ctx = () => ({ db, env, token: 'fictive-token' })
const prepare = (kind: 'accepted' | 'refused' = 'accepted') =>
  prepareDecisionMail({ ...ctx(), participationId: 7, kind, actor })
async function queueDecision(kind: 'accepted' | 'refused' = 'accepted') {
  const m = await prepare(kind)
  parts[0].statut = kind === 'accepted' ? 'Candidature acceptée' : 'Refus'
  await confirmDecisionMail({
    ...ctx(),
    id: m.id,
    previewHash: m.preview_hash,
    actor,
    confirm: true,
  })
  return m.id
}
async function queueAR(complete = true) {
  sql.run(
    "INSERT INTO form_submissions(submission_key,form_type,cohort_id,state,phase,parent_id,record_id) VALUES('new','etablissement',2,'processing','verifying',1,7)",
  )
  const id = await prepareAcknowledgement({
    db,
    env,
    submissionKey: 'new',
    participationId: 7,
    schoolId: 1,
    cohortId: 2,
    school: schools[0].nom,
    email: schools[0].referent_email,
  })
  if (complete)
    sql.run("UPDATE form_submissions SET state='complete',phase='saved' WHERE submission_key='new'")
  return id
}
const send = (id: string) => dispatchCandidatureMail({ ...ctx(), id })
const posts = () => calls.filter((c) => c.url === 'https://api.brevo.com/v3/smtp/email')
test('migration neither backfills historical receipts nor creates events on status update', () => {
  sql.run(
    "INSERT INTO form_submissions(submission_key,form_type,cohort_id,state,phase,parent_id,record_id) VALUES('old','etablissement',2,'complete','saved',1,7)",
  )
  sql.run("UPDATE form_submissions SET updated_at=CURRENT_TIMESTAMP WHERE submission_key='old'")
  parts[0].statut = 'Candidature acceptée'
  expect(sql.query('SELECT * FROM candidature_mails').all()).toEqual([])
  expect(calls).toEqual([])
})
test('AR is made dispatchable by the atomic completion statement, not before', async () => {
  const id = await queueAR(false)
  expect((await send(id)).state).toBe('awaiting_receipt')
  expect(posts()).toHaveLength(0)
  sql.run("UPDATE form_submissions SET state='complete',phase='saved' WHERE submission_key='new'")
  expect((await send(id)).state).toBe('accepted')
  expect(posts()).toHaveLength(1)
  expect((await getCandidatureMail(db, id)).message_id).toBe('<fictive-message>')
  expect((await getCandidatureMail(db, id)).provider_state).toBeNull()
})
test('replayed and concurrent dispatches cause a single provider request', async () => {
  const id = await queueAR()
  await Promise.all(Array.from({ length: 12 }, () => send(id)))
  await send(id)
  expect(posts()).toHaveLength(1)
  expect(sql.query('SELECT * FROM candidature_mail_attempts').all()).toHaveLength(1)
})
test('historic or mismatched receipt cannot be prepared as a new AR', async () => {
  await expect(
    prepareAcknowledgement({
      db,
      env,
      submissionKey: 'old',
      participationId: 7,
      schoolId: 1,
      cohortId: 2,
      school: 'Fake',
      email: 'test@example.invalid',
    }),
  ).rejects.toThrow('nouvelle candidature')
  const id = await queueAR(false)
  sql.run(
    "UPDATE form_submissions SET record_id=8,state='complete',phase='saved' WHERE submission_key='new'",
  )
  expect((await send(id)).state).toBe('awaiting_receipt')
})
test('actual candidature store prepares durable AR before completion, duplicate never prepares it again', async () => {
  parts = []
  let id = '',
    prepared = 0
  const input = {
    db,
    token: 'fictive-token',
    kind: 'etablissement' as const,
    identity: schools[0],
    application: { statut: 'Candidature recue' },
    beforeComplete: async (r: any) => {
      prepared++
      id = await prepareAcknowledgement({
        db,
        env,
        ...r,
        school: schools[0].nom,
        email: schools[0].referent_email,
      })
    },
  }
  expect(await enregistrerCandidature(input)).toEqual({ duplicate: false })
  expect((await getCandidatureMail(db, id)).state).toBe('queued')
  expect(await enregistrerCandidature(input)).toEqual({ duplicate: true })
  expect(prepared).toBe(1)
  expect(posts()).toHaveLength(0)
})
test('failed AR preparation leaves application in review, without a send', async () => {
  parts = []
  await expect(
    enregistrerCandidature({
      db,
      token: 'fictive-token',
      kind: 'etablissement',
      identity: schools[0],
      application: { statut: 'Candidature recue' },
      beforeComplete: async () => {
        throw new Error('disk')
      },
    }),
  ).rejects.toThrow()
  expect(sql.query('SELECT state FROM form_submissions').get()).toEqual({ state: 'review' })
  expect(posts()).toHaveLength(0)
})
for (const kind of ['accepted', 'refused'] as const)
  test(`future ${kind} requires exact human preview then explicit saved decision`, async () => {
    const m = await prepare(kind)
    expect(m.state).toBe('draft')
    expect(posts()).toHaveLength(0)
    await expect(
      confirmDecisionMail({
        ...ctx(),
        id: m.id,
        previewHash: m.preview_hash,
        actor,
        confirm: true,
      }),
    ).rejects.toThrow('décision explicite')
    parts[0].statut = kind === 'accepted' ? 'Candidature acceptée' : 'Refuse'
    const confirm = { ...ctx(), id: m.id, previewHash: m.preview_hash, actor, confirm: true }
    await Promise.all([confirmDecisionMail(confirm), confirmDecisionMail(confirm)])
    expect((await send(m.id)).state).toBe('accepted')
    expect(posts()).toHaveLength(1)
    expect(sql.query('SELECT confirmed_by FROM candidature_mails').get()).toEqual({
      confirmed_by: actor,
    })
  })
for (const statut of [
  'Candidature acceptée',
  'Refuse',
  'Refus',
  'Retenu',
  'Engage',
  'Établissement engagé',
  'Abandon',
  'Abandonne',
])
  test(`old ${statut} is not a future decision`, async () => {
    parts[0].statut = statut
    await expect(prepare()).rejects.toThrow('avant la décision')
    expect(posts()).toHaveLength(0)
  })
test('legacy analysis and new canonical received use shared status mapping', async () => {
  parts[0].statut = 'Candidature reçue'
  const m = await prepare()
  await cancelDecisionDraft(db, m.id, actor)
  parts[0].statut = 'En cours d’analyse'
  expect((await prepare()).state).toBe('draft')
})
test('racing prepare actions cannot create opposite or duplicate decision mails', async () => {
  const outcomes = await Promise.allSettled([
    prepare('accepted'),
    prepare('refused'),
    prepare('accepted'),
  ])
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(await listCandidatureMails(db, 7)).toHaveLength(1)
})
test('proposal templates are viewable but cannot be confirmed', async () => {
  delete env.CANDIDATURE_DECISION_TEMPLATES
  const m = await prepare()
  expect(m.canConfirm).toBe(false)
  parts[0].statut = 'Candidature acceptée'
  await expect(
    confirmDecisionMail({ ...ctx(), id: m.id, previewHash: m.preview_hash, actor, confirm: true }),
  ).rejects.toThrow('pas validé')
})
test('wrong actor, hash, explicit consent or expired draft cannot queue', async () => {
  const m = await prepare()
  parts[0].statut = 'Candidature acceptée'
  for (const override of [
    { actor: 'other@example.invalid' },
    { previewHash: 'bad' },
    { confirm: false },
  ])
    await expect(
      confirmDecisionMail({
        ...ctx(),
        id: m.id,
        previewHash: m.preview_hash,
        actor,
        confirm: true,
        ...override,
      }),
    ).rejects.toThrow()
  sql.run("UPDATE candidature_mails SET expires_at='2000-01-01T00:00:00.000Z'")
  await expect(
    confirmDecisionMail({ ...ctx(), id: m.id, previewHash: m.preview_hash, actor, confirm: true }),
  ).rejects.toThrow('expiré')
})
test('changed recipient or template invalidates confirmation', async () => {
  const m = await prepare()
  parts[0].statut = 'Candidature acceptée'
  schools[0].referent_email = 'other@example.invalid'
  await expect(
    confirmDecisionMail({ ...ctx(), id: m.id, previewHash: m.preview_hash, actor, confirm: true }),
  ).rejects.toThrow('changé')
})
for (const state of ['timeout', '5xx', 'invalid-json', 'no-id'])
  test(`${state} stays uncertain and never auto retries`, async () => {
    const id = await queueAR()
    provider = async () => {
      if (state === 'timeout') throw new Error('SECRET_CANARY')
      if (state === '5xx') return new Response('SECRET_CANARY', { status: 503 })
      if (state === 'invalid-json') return new Response('bad', { status: 201 })
      return Response.json({})
    }
    expect((await send(id)).state).toBe('uncertain')
    await send(id)
    await expect(retryRejectedMail(db, id)).rejects.toThrow('incertain')
    expect(posts()).toHaveLength(1)
  })
test('explicit provider rejection can be retried, with preserved attempt history', async () => {
  const id = await queueAR()
  provider = async () => new Response('rejected', { status: 429 })
  expect((await send(id)).state).toBe('rejected')
  await send(id)
  expect(posts()).toHaveLength(1)
  await retryRejectedMail(db, id)
  provider = async () => Response.json({ messageId: '<second>' }, { status: 201 })
  expect((await send(id)).state).toBe('accepted')
  expect(sql.query('SELECT * FROM candidature_mail_attempts').all()).toHaveLength(2)
})
test('lost persisted success retains the sending claim and cannot resend', async () => {
  const id = await queueAR()
  let fail = false
  const normal = db
  db = {
    prepare: (q) => {
      const stmt = normal.prepare(q)
      return {
        bind: (...v) => {
          const bound = stmt.bind(...v)
          return {
            ...bound,
            run: async () => {
              if (fail && q.startsWith('UPDATE candidature_mail_attempts')) throw new Error('disk')
              return bound.run()
            },
          }
        },
      }
    },
  }
  provider = async () => {
    fail = true
    return Response.json({ messageId: '<sent-before-crash>' }, { status: 201 })
  }
  await expect(send(id)).rejects.toThrow('disk')
  db = normal
  expect((await send(id)).state).toBe('sending')
  expect(posts()).toHaveLength(1)
})
test('disabled sender or missing transport leaves durable queue untouched', async () => {
  const id = await queueAR()
  env.CANDIDATURE_MAIL_SEND_ENABLED = 'false'
  await expect(send(id)).rejects.toThrow('désactivé')
  env.CANDIDATURE_MAIL_SEND_ENABLED = 'true'
  env.CANDIDATURE_MAIL_OWNER = 'gas'
  await expect(send(id)).rejects.toThrow('désactivé')
  env.CANDIDATURE_MAIL_OWNER = 'site'
  delete env.BREVO_API_KEY
  await expect(send(id)).rejects.toThrow('transport')
  expect((await getCandidatureMail(db, id)).state).toBe('queued')
  expect(posts()).toHaveLength(0)
})
test('changed dossier after confirmation blocks dispatch without a provider call', async () => {
  const id = await queueDecision()
  parts[0].statut = 'Abandon'
  await expect(send(id)).rejects.toThrow('correspond plus')
  expect(posts()).toHaveLength(0)
})
test('archive and nonactive cohort are rejected before preparation', async () => {
  parts[0].fusionne_vers = 9
  await expect(prepare()).rejects.toThrow('archivé')
  parts[0].fusionne_vers = null
  parts[0].cohortes_id = 1
  await expect(prepare()).rejects.toThrow('campagne active')
})
test('provider evidence reconciles an uncertain send, without a new POST, and retains delivered separately', async () => {
  const id = await queueAR()
  provider = async () => {
    throw new Error('lost')
  }
  await send(id)
  const m = await getCandidatureMail(db, id)
  events = [
    {
      date: new Date().toISOString(),
      email: 'test@example.invalid',
      event: 'delivered',
      messageId: '<reconciled>',
      tag: `candidate-${m.attempt_id}`,
    },
  ]
  const r = await reconcileCandidatureMail({ ...ctx(), id })
  expect(r.mail.message_id).toBe('<reconciled>')
  expect(r.mail.provider_state).toBe('delivered')
  await reconcileCandidatureMail({ ...ctx(), id })
  await send(id)
  expect(posts()).toHaveLength(1)
  expect(sql.query('SELECT * FROM candidature_mail_events').all()).toHaveLength(1)
})
test('absence, foreign or multiple messages cannot authorize resending', async () => {
  const id = await queueAR()
  provider = async () => {
    throw new Error('lost')
  }
  await send(id)
  expect((await reconcileCandidatureMail({ ...ctx(), id })).evidence).toBe('not_found')
  const m = await getCandidatureMail(db, id),
    e = {
      date: new Date().toISOString(),
      email: 'test@example.invalid',
      event: 'delivered',
      messageId: '<one>',
      tag: `candidate-${m.attempt_id}`,
    }
  events = [{ ...e, email: 'other@example.invalid' }]
  expect((await reconcileCandidatureMail({ ...ctx(), id })).evidence).toBe('not_found')
  events = [e, { ...e, messageId: '<two>' }]
  await expect(reconcileCandidatureMail({ ...ctx(), id })).rejects.toThrow('Plusieurs')
  expect((await getCandidatureMail(db, id)).state).toBe('uncertain')
  expect(posts()).toHaveLength(1)
})
test('template variables and multiple recipients are refused', () => {
  expect(() => acknowledgementPayload('{{unknown}}', 'test@example.invalid')).toThrow()
  expect(() =>
    acknowledgementPayload('School', 'first@example.invalid,second@example.invalid'),
  ).toThrow()
})

// Real prospective decision workflow; every remote operation remains mocked.
import { prepareDecisionScreen, executeDecision, decisionView } from '../src/lib/candidature-decision'
const screenCtx=()=>({...ctx(),env:{...env,CANDIDATURE_DECISIONS_ENABLED:'true',CANDIDATURE_DECISION_WRITE_OWNER:'site',CANDIDATURE_DECISION_CONCURRENCY_REVIEW:'TEST_ONLY_EXCLUSIVE_WRITER'}})
const screen=()=>prepareDecisionScreen({...screenCtx(),participationId:7,kind:'accepted',actor})
const execute=(p:any,withEmail=false)=>executeDecision({...screenCtx(),id:p.id,actor,previewHash:p.previewHash,confirm:true,withEmail})
const patches=()=>calls.filter(c=>c.method==='PATCH')
test('screen records only the canonical status then sends the exact approved preview',async()=>{
  parts[0].statut='Candidature reçue';parts[0].notes='KEEP';parts[0].statut_origine='Candidature recue'
  const p=await screen();expect(p.statusAfter).toBe('Candidature acceptée')
  const result=await execute(p,true)
  expect(result.decision).toBe('saved');expect(result.mail?.state).toBe('accepted')
  expect(patches()).toHaveLength(1);expect(patches()[0].body).toEqual([{Id:7,statut:'Candidature acceptée'}])
  expect(parts[0].notes).toBe('KEEP');expect(parts[0].statut_origine).toBe('Candidature recue')
  expect(posts()[0].body.to).toEqual([{email:p.payload.to}]);expect(posts()[0].body.textContent).toBe(p.payload.text)
  expect(sql.query('SELECT * FROM operational_submission_locks').all()).toHaveLength(0)
})
test('unapproved template permits explicit decision without mail, never an implicit send',async()=>{
  delete env.CANDIDATURE_DECISION_TEMPLATES
  const p=await screen();expect(p.approved).toBe(false)
  await expect(execute(p,true)).rejects.toThrow('envoi n’est pas disponible')
  expect(patches()).toHaveLength(0)
  const result=await execute(p,false);expect(result.decision).toBe('saved');expect(result.mail?.state).toBe('cancelled')
  expect(posts()).toHaveLength(0)
})
test('unknown external concurrency keeps decision disabled, including no-mail decision',async()=>{
  const p=await screen()
  await expect(executeDecision({...ctx(),id:p.id,actor,previewHash:p.previewHash,confirm:true,withEmail:false})).rejects.toThrow('lecture seule')
  expect(patches()).toHaveLength(0);expect(posts()).toHaveLength(0)
})
test('concurrent decision calls and replays never repeat PATCH or POST',async()=>{
  const p=await screen()
  const outcomes=await Promise.allSettled([execute(p,true),execute(p,true)])
  expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  const replay=await execute(p,true);expect(replay.replayed).toBe(true)
  expect(patches()).toHaveLength(1);expect(posts()).toHaveLength(1)
  await expect(execute(p,false)).rejects.toThrow('autre choix')
})
test('full dossier, school and cohort reads prevent stale preview write',async()=>{
  const p=await screen();parts[0].notes='concurrent external change'
  await expect(execute(p,false)).rejects.toThrow('changé');expect(patches()).toHaveLength(0)
  expect(sql.query('SELECT state FROM candidature_decisions').get()).toEqual({state:'cancelled'})
})
test('a same-version template change prevents any status mutation',async()=>{
  const p=await screen();env.CANDIDATURE_DECISION_TEMPLATES=JSON.stringify({...templates,accepted:{...templates.accepted,text:'Changed'}})
  await expect(execute(p,true)).rejects.toThrow('modèle a changé');expect(patches()).toHaveLength(0)
})
for(const legacy of [false,true])test(`existing ${legacy?'legacy Google':'shared site'} lock blocks before mutation`,async()=>{
  const p=await screen()
  if(legacy)sql.run("INSERT INTO google_form_locks(target_id,event_key) VALUES(7,'historical')")
  else sql.run("INSERT INTO operational_submission_locks(target_id,link_hash) VALUES(7,'other-writer')")
  await expect(execute(p,false)).rejects.toThrow();expect(patches()).toHaveLength(0);expect(posts()).toHaveLength(0)
})
test('NocoDB request committed then response lost remains review with lock and no email',async()=>{
  const p=await screen()
  hook=async(u,init)=>{if(init?.method==='PATCH'){parts[0].statut='Candidature acceptée';throw new Error('response lost')}}
  const result=await execute(p,true);expect(result.decision).toBe('review');expect(posts()).toHaveLength(0)
  expect(sql.query('SELECT write_started,state FROM candidature_decisions').get()).toEqual({write_started:1,state:'review'})
  expect(sql.query('SELECT * FROM operational_submission_locks').all()).toHaveLength(1)
  await expect(execute(p,true)).rejects.toThrow('vérifier');expect(patches()).toHaveLength(1)
})
test('readback mismatch in an unrelated field blocks sending and retains the lock',async()=>{
  const p=await screen();hook=async(u,init)=>{if(init?.method==='PATCH')parts[0].notes='concurrent mutation'}
  const result=await execute(p,true);expect(result.decision).toBe('review');expect(posts()).toHaveLength(0)
})
test('mail failure after saved status is reported independently, never repeats decision',async()=>{
  const p=await screen();provider=async()=>{throw new Error('mail timeout')}
  const result=await execute(p,true);expect(result.decision).toBe('saved');expect(result.mail?.state).toBe('uncertain')
  await execute(p,true);expect(patches()).toHaveLength(1);expect(posts()).toHaveLength(1)
})
test('an unresolved historic Retenu is visible but never offered as received',async()=>{
  parts[0].statut=null;parts[0].statut_origine='Retenu'
  const view=await decisionView(screenCtx(),7);expect(view.dossier.status).toContain('qualifier');expect(view.canPrepare).toBe(false)
  await expect(screen()).rejects.toThrow('avant la décision')
})

test('AR sending flag does not activate acceptance or refusal emails',async()=>{
  const id=await queueDecision();delete env.CANDIDATURE_DECISION_SEND_ENABLED
  await expect(send(id)).rejects.toThrow('périmètre distinct');expect(posts()).toHaveLength(0)
})
test('a second canonical dossier for the same school and cohort blocks any decision',async()=>{
  const p=await screen();parts.push({...parts[0],Id:8})
  await expect(execute(p,true)).rejects.toThrow('ambigu');expect(patches()).toHaveLength(0);expect(posts()).toHaveLength(0)
})
test('archive appearing between preview and last full recheck never triggers a PATCH',async()=>{
  const p=await screen();let reads=0
  hook=async(u,init)=>{if(u.pathname.endsWith('/records/7') && (!init?.method||init.method==='GET') && ++reads===2){parts.push({...parts[0],Id:8});parts[0].fusionne_vers=8}}
  await expect(execute(p,true)).rejects.toThrow('archivé');expect(patches()).toHaveLength(0);expect(posts()).toHaveLength(0)
})
test('one opaque tag is used for unambiguous provider correlation',async()=>{
  const id=await queueAR();const result=await send(id)
  expect(posts()[0].body.tags).toEqual([`candidate-${result.attempt_id}`])
})
