import { test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { NC } from '../src/lib/nocodb'
import { OPERATIONAL_ADULTS_TABLE as ADULTS } from '../src/lib/operational-data'
import { reviewVersion } from '../src/lib/google-review'
import { digest } from '../src/lib/google-form-sync'
import { writeContact, readContact } from '../src/lib/google-form-contact'
import {
  correctionSources,
  correctionOptions,
  type CorrectionSource,
} from '../src/lib/google-review-correction-plan'
import {
  prepareCorrection,
  confirmCorrection,
  checkCorrection,
  listCorrections,
  getCorrectionOptions,
  type CorrectionContext,
} from '../src/lib/google-review-correction-store'

let sql: Database,
  sharedSql: Database,
  ctx: CorrectionContext,
  row: any,
  tables: Record<string, any[]>,
  patches: any[],
  fail: string,
  now: string
const actor = 'manager@example.test',
  journal = 'journaltest1234'
const source: CorrectionSource = {
  label: 'Organisation fixture',
  family: 'organisation',
  mapping: { start: 'Début', end: 'Fin' },
}
function db(sql: Database): any {
  return {
    prepare: (q: string) => ({
      bind: (...args: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(q).run(...args).changes } }),
        all: async () => ({ results: sql.query(q).all(...args) }),
        first: async () => sql.query(q).get(...args),
      }),
    }),
  }
}
beforeEach(() => {
  sql = new Database(':memory:')
  sharedSql = new Database(':memory:')
  sql.run(
    readFileSync(
      new URL('../migrations/interne/0006_google_review_corrections.sql', import.meta.url),
      'utf8',
    ),
  )
  sharedSql.run(
    readFileSync(new URL('../workers/google-transition/schema.sql', import.meta.url), 'utf8'),
  )
  for (const f of [
    '0009_public_form_receipts.sql',
    '0010_preformation_projection.sql',
    '0011_postformation_projection.sql',
    '0012_accord_formateur.sql',
    '0014_final_questionnaires.sql',
  ])
    sharedSql.run(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'))
  sharedSql.run(
    'CREATE TABLE operational_submission_locks(target_id INTEGER PRIMARY KEY,link_hash TEXT NOT NULL,acquired_at TEXT)',
  )
  now = '2026-10-01T12:00:00Z'
  fail = ''
  patches = []
  row = {
    Id: 113,
    cle_reponse: 'google-source:113:1',
    formulaire: source.label,
    horodatage_source: '23/09/2026 10:00:00',
    reponses: JSON.stringify([
      { question: 'Début', answer: '01/10/2026' },
      { question: 'Fin', answer: '15/12/2026' },
    ]),
    detail_reprise: 'Original immutable notes',
    statut_reprise: 'À rapprocher',
  }
  tables = {
    [NC.tables.etablissements]: [
      {
        Id: 3,
        nom: 'École fictive',
        ville: 'Ville',
        fusionne_vers: null,
        referent_email: 'ref@example.test',
      },
    ],
    [NC.tables.participations]: [
      {
        Id: 7,
        etablissements_id: 3,
        cohortes_id: 2,
        fusionne_vers: null,
        code: 'DOS-7',
        statut: 'Engagé',
        statut_formation: 'Prévisionnelle',
        date_debut_formation: '2026-10-01',
        date_fin_formation: '2026-12-20',
        fiche_contact_recue: false,
        notes: 'Annotation humaine',
      },
    ],
    [NC.tables.cohortes]: [{ Id: 2, nom: '2026–2027', annee_debut: 2026, annee_fin: 2027 }],
    [NC.tables.formateurs]: [
      {
        Id: 9,
        prenom: 'Camille',
        nom: 'Exemple',
        email: 'trainer@example.test',
        fusionne_vers: null,
      },
    ],
    [NC.tables.engagements]: [
      {
        Id: 11,
        formateurs_id: 9,
        cohortes_id: 2,
        fusionne_vers: null,
        accord_signe: false,
        date_accord: null,
      },
    ],
    [ADULTS]: [
      {
        Id: 19,
        prenom: 'Alex',
        nom: 'Fictif',
        email: 'adult@example.test',
        email_2: null,
        participations_id: 7,
        date_pre_recu: null,
        date_post_recu: null,
        date_suivi_recu: null,
        date_evaluation_recu: null,
        statut: 'Déclaré',
      },
    ],
  }
  ctx = {
    db: db(sql),
    shared: db(sharedSql),
    table: journal,
    sources: [structuredClone(source)],
    now: () => now,
    client: async (path, method = 'GET', body) => {
      const url = new URL('https://fixture.test' + path),
        segments = url.pathname.split('/'),
        table = segments[2],
        id = Number(segments[4])
      if (path.startsWith('/meta/'))
        return {
          columns: [
            'date_debut_formation',
            'date_fin_formation',
            'date_pre_recu',
            'date_post_recu',
            'date_suivi_recu',
            'date_evaluation_recu',
            'date_bilan_etablissement_recu',
            'date_accord',
          ]
            .filter((k) => !(fail === 'schema' && k === 'date_pre_recu'))
            .map((title) => ({ title, uidt: 'Date' }))
            .concat([
              { title: 'fiche_contact_recue', uidt: 'Checkbox' },
              { title: 'accord_signe', uidt: 'Checkbox' },
              { title: 'notes', uidt: 'LongText' },
            ]),
        }
      if (table === journal) {
        if (method !== 'GET') throw Error('Journal is immutable')
        return structuredClone(row)
      }
      if (method !== 'GET') {
        if (method !== 'PATCH') throw Error('No creation/deletion permitted')
        patches.push({ table, body: structuredClone(body) })
        if (fail === 'before') throw Error('lost before write')
        for (const patch of body as Record<string, unknown>[])
          Object.assign(
            tables[table].find((r) => r.Id === patch.Id),
            patch,
          )
        if (fail === 'after') throw Error('lost after write')
        if (fail === 'readback') fail = 'allreads'
        return body
      }
      if (fail === 'allreads') throw Error('read unavailable')
      if (id) return structuredClone(tables[table].find((r) => r.Id === id) ?? {})
      let list = tables[table] ?? []
      const where = url.searchParams.get('where')
      if (where) {
        const matches = [...where.matchAll(/\(([^,]+),eq,([^)]*)\)/g)]
        const check = (r: any, [, k, v]: RegExpMatchArray) => String(r[k] ?? '') === v
        list = list.filter((r) =>
          where.includes('~or')
            ? matches.some((m) => check(r, m))
            : matches.every((m) => check(r, m)),
        )
      }
      return { list: structuredClone(list), pageInfo: { isLastPage: true } }
    },
  }
})
afterEach(() => {
  sql.close()
  sharedSql.close()
})
async function prepare(values: any = { end: '2026-12-15' }, targetKind = 'school', targetId = 7) {
  return (
    await prepareCorrection(
      ctx,
      {
        action: 'prepare-correction',
        id: 113,
        version: await reviewVersion(row),
        targetKind,
        targetId,
        values,
        reason: 'Vérifié avec le référent',
      },
      actor,
    )
  ).preview
}
const confirm = (preview: any, who = actor) =>
  confirmCorrection(
    ctx,
    {
      action: 'confirm-correction',
      operationId: preview.id,
      planHash: preview.hash,
      confirmed: true,
    },
    who,
  )
const check = (preview: any) =>
  checkCorrection(
    ctx,
    { action: 'check-correction', operationId: preview.id, planHash: preview.hash },
    actor,
  )
function personSource(family: any = 'preformation', extra: Record<string, string> = {}) {
  ctx.sources = [
    {
      label: 'Questionnaire fixture',
      family,
      mapping: { name: 'Nom complet', email: 'Email', establishment: 'École', ...extra },
    },
  ]
  row.formulaire = ctx.sources[0].label
  row.reponses = JSON.stringify([
    { question: 'Nom complet', answer: 'Alex Fictif' },
    { question: 'Email', answer: 'adult@example.test' },
    { question: 'École', answer: 'École fictive' },
  ])
}
test('dates: persisted exact preview, immutable source, one PATCH, readback and actor audit', async () => {
  const raw = structuredClone(row),
    p = await prepare()
  expect(p.changes).toEqual([
    { label: 'Fin de formation', before: '2026-12-20', after: '2026-12-15' },
  ])
  expect(patches).toHaveLength(0)
  const result = await confirm(p)
  expect(result.state).toBe('complete')
  expect(patches).toHaveLength(1)
  expect(patches[0].body).toEqual([{ Id: 7, date_fin_formation: '2026-12-15' }])
  expect(tables[NC.tables.participations][0].statut).toBe('Engagé')
  expect(row).toEqual(raw)
  expect(
    (await listCorrections(ctx, [{ id: 113, sourceKey: row.cle_reponse }]))[0].correction,
  ).toMatchObject({ state: 'complete', actor })
  await confirm(p)
  expect(patches).toHaveLength(1)
})
test('guard source version, exact hash, actor, target before-values and expiry', async () => {
  const p = await prepare()
  await expect(confirm({ ...p, hash: 'a'.repeat(64) })).rejects.toThrow()
  await expect(confirm(p, 'other@example.test')).rejects.toThrow()
  tables[NC.tables.participations][0].date_fin_formation = '2026-12-25'
  expect((await confirm(p)).state).toBe('conflict')
  expect(patches).toHaveLength(0)
  const next = await prepare()
  row.reponses += ' '
  expect((await confirm(next)).state).toBe('conflict')
  expect(patches).toHaveLength(0)
  const last = await prepare()
  now = '2026-10-01T12:16:00Z'
  expect((await confirm(last)).state).toBe('conflict')
})
for (const behavior of ['before', 'after', 'readback'])
  test('uncertain ' + behavior + ' cannot retry, check only reads', async () => {
    const p = await prepare()
    fail = behavior
    expect((await confirm(p)).state).toBe('uncertain')
    fail = ''
    expect((await confirm(p)).state).toBe('uncertain')
    expect(patches).toHaveLength(1)
    const result = await check(p)
    expect(result.state).toBe(behavior === 'before' ? 'uncertain' : 'complete')
    expect(patches).toHaveLength(1)
    expect(sharedSql.query('SELECT count(*) n FROM operational_submission_locks').get()).toEqual({
      n: behavior === 'before' ? 1 : 0,
    })
  })
test('two confirmations of same preview issue at most one PATCH', async () => {
  const p = await prepare()
  await Promise.allSettled([confirm(p), confirm(p)])
  expect(patches).toHaveLength(1)
})
test('uncertain claim blocks a new plan on the same target/source', async () => {
  const p = await prepare()
  fail = 'before'
  await confirm(p)
  fail = ''
  const other = await prepare({ end: '2026-12-16' })
  await expect(confirm(other)).rejects.toThrow('en cours')
  expect(patches).toHaveLength(1)
})
test('collector or operational lock blocks before NocoDB write', async () => {
  const p = await prepare()
  sharedSql
    .query("INSERT INTO google_transition_runs(id,owner,expires_at) VALUES ('poll','collector',?)")
    .run(Date.parse(now) + 60000)
  expect((await confirm(p)).state).toBe('conflict')
  expect(patches).toHaveLength(0)
  sharedSql.run('DELETE FROM google_transition_runs')
  const p2 = await prepare()
  sharedSql
    .query('INSERT INTO operational_submission_locks VALUES (7,?,null)')
    .run('another-site-submission')
  expect((await confirm(p2)).state).toBe('conflict')
  expect(patches).toHaveLength(0)
})
for (const family of ['preformation', 'postformation', 'suivi_j45', 'evaluation'])
  test(
    'exact adult ' + family + ' uses original reception date, no creation/status change',
    async () => {
      personSource(family)
      if (family === 'evaluation') delete ctx.sources[0].mapping.name
      const p = await prepare({})
      expect(p.changes[0].after).toBe('2026-09-23')
      expect((await confirm(p)).state).toBe('complete')
      expect(patches[0].table).toBe(ADULTS)
      expect(tables[ADULTS][0].statut).toBe('Déclaré')
      expect(tables[ADULTS]).toHaveLength(1)
    },
  )
test('missing adult is explicitly blocked, never created', async () => {
  personSource()
  tables[ADULTS] = []
  await expect(prepare({})).rejects.toThrow('correspondance unique')
  expect(patches).toHaveLength(0)
})
for (const change of ['name', 'email', 'dossier', 'duplicate', 'schema'])
  test('adult identity/schema guard ' + change, async () => {
    personSource()
    if (change === 'name') tables[ADULTS][0].nom = 'Autre'
    if (change === 'email') tables[ADULTS][0].email = 'other@example.test'
    if (change === 'dossier') tables[ADULTS][0].participations_id = 8
    if (change === 'duplicate') tables[ADULTS].push({ ...tables[ADULTS][0], Id: 20 })
    if (change === 'schema') fail = 'schema'
    await expect(prepare({})).rejects.toThrow()
    expect(patches).toHaveLength(0)
  })
test('duplicate adult introduced after preview refuses confirmation', async () => {
  personSource()
  const p = await prepare({})
  tables[ADULTS].push({ ...tables[ADULTS][0], Id: 20 })
  expect((await confirm(p)).state).toBe('conflict')
  expect(patches).toHaveLength(0)
})
test('explicit annual dossier fills missing historical year but rejects contradictory declared year', async () => {
  personSource()
  const p = await prepare({})
  expect(p.targetLabel).toContain('2026–2027')
  ctx.sources[0].mapping.cohort = 'Année'
  const a = JSON.parse(row.reponses)
  a.push({ question: 'Année', answer: '2025-2026' })
  row.reponses = JSON.stringify(a)
  await expect(prepare({})).rejects.toThrow('année déclarée')
})
test('old receipt date can be corrected only through exact displayed before/after', async () => {
  personSource()
  tables[ADULTS][0].date_pre_recu = '2026-09-20'
  const p = await prepare({})
  expect(p.changes[0]).toMatchObject({ before: '2026-09-20', after: '2026-09-23' })
  expect((await confirm(p)).state).toBe('complete')
})
test('agreement requires literal Oui and exact trainer/year, no business status change', async () => {
  ctx.sources = [
    {
      label: 'Accord fixture',
      family: 'accord_formateur',
      mapping: {
        firstName: 'Prénom',
        lastName: 'Nom',
        email: 'Email',
        agreement: 'Accord',
        agreementDate: 'Date',
      },
      agreementAnswer: 'Oui',
    },
  ]
  row.formulaire = 'Accord fixture'
  row.reponses = JSON.stringify([
    { question: 'Prénom', answer: 'Camille' },
    { question: 'Nom', answer: 'Exemple' },
    { question: 'Email', answer: 'trainer@example.test' },
    { question: 'Accord', answer: 'Oui' },
    { question: 'Date', answer: '20/09/2026' },
  ])
  const p = await prepare({}, 'trainer', 11)
  expect((await confirm(p)).state).toBe('complete')
  expect(patches[0].body).toEqual([{ Id: 11, accord_signe: true, date_accord: '2026-09-20' }])
  row.reponses = row.reponses.replace('"Oui"', '"Non"')
  await expect(prepare({}, 'trainer', 11)).rejects.toThrow('affirmatif')
})
test('bilan établissement has no fabricated person name; exact contact email/school required', async () => {
  ctx.sources = [
    {
      label: 'Bilan fixture',
      family: 'bilan_etablissement',
      mapping: { email: 'Email', establishment: 'École' },
    },
  ]
  row.formulaire = 'Bilan fixture'
  row.reponses = JSON.stringify([
    { question: 'Email', answer: 'ref@example.test' },
    { question: 'École', answer: 'École fictive' },
  ])
  const p = await prepare({})
  expect((await confirm(p)).state).toBe('complete')
  expect(patches[0].body).toEqual([{ Id: 7, date_bilan_etablissement_recu: '2026-09-23' }])
})
test('source labels/digest/questions are exact; unknown source cannot be assimilated', async () => {
  personSource()
  ctx.sources[0].headerDigest = await digest(
    JSON.stringify(JSON.parse(row.reponses).map((a: any) => a.question)),
  )
  expect((await getCorrectionOptions(ctx, 113)).options.kind).toBe('adult')
  await prepare({})
  row.reponses = row.reponses.replace('Nom complet', 'Nouveau nom')
  await expect(prepare({})).rejects.toThrow('questions sources')
  row.formulaire = 'GoogleForms — pre_formation_adultes'
  expect((await getCorrectionOptions(ctx, 113)).options.kind).toBeNull()
  await expect(prepare({})).rejects.toThrow('correspondance')
})
test('configuration accepts audited aliases only and rejects client-like arbitrary fields', () => {
  expect(
    correctionSources(
      JSON.stringify([
        {
          label: 'exact',
          family: 'preformation_a',
          mapping: { name: 'Nom', email: 'Email' },
          agreementAnswer: null,
        },
      ]),
    )[0].family,
  ).toBe('preformation')
  expect(() =>
    correctionSources([
      {
        label: 'x',
        family: 'preformation',
        mapping: { email: 'Email', name: 'Nom', statut: 'État' },
      },
    ]),
  ).toThrow()
  expect(() =>
    correctionSources([
      { label: 'x', family: 'evaluation_formation', mapping: { email: 'Email' } },
    ]),
  ).toThrow()
})
test('date corrections preserve notes and roster; align structured dates without clearing other warnings', async () => {
  const projection: any = {
    version: 1,
    source: { spreadsheetId: 'fictitious', rows: [2], readAt: '2026-09-23T10:00:00Z' },
    receivedAt: '2026-09-23',
    formation: {
      start: '2026-10-01',
      end: '2026-12-20',
      kind: 'previsionnelle',
      format: 'Présentiel',
      planning: 'Planning original',
      issues: ['Participants à vérifier'],
    },
    declaredTrainers: [],
    participants: {
      declared: 'Liste brute intacte',
      unresolved: ['Personne à vérifier'],
      importedCount: 0,
    },
  }
  tables[NC.tables.participations][0].notes = writeContact('Annotation humaine', projection)
  const p = await prepare()
  expect((await confirm(p)).state).toBe('complete')
  const saved = readContact(tables[NC.tables.participations][0].notes)!
  expect(saved.formation.end).toBe('2026-12-15')
  expect(saved.formation.issues).toEqual(projection.formation.issues)
  expect(saved.participants).toEqual(projection.participants)
  expect(tables[NC.tables.participations][0].notes.startsWith('Annotation humaine')).toBe(true)
})
test('forbidden values and invalid dates rejected before any write', async () => {
  for (const values of [
    { statut: 'Formé' },
    { end: '2026-02-30' },
    { end: '2025-12-20' },
    { start: '2026-12-31', end: '2026-12-20' },
    { contactReceived: false },
  ])
    await expect(prepare(values)).rejects.toThrow()
  expect(patches).toHaveLength(0)
})
test('merged annual duplicate is excluded with its explicit canonical relation; active duplicates block', async () => {
  tables[NC.tables.participations].push({
    ...tables[NC.tables.participations][0],
    Id: 8,
    fusionne_vers: 7,
  })
  expect((await confirm(await prepare())).state).toBe('complete')
  tables[NC.tables.participations][1].fusionne_vers = null
  await expect(prepare()).rejects.toThrow('unique')
})
test('dossier duplicate arriving after preview blocks before write', async () => {
  const p = await prepare()
  tables[NC.tables.participations].push({ ...tables[NC.tables.participations][0], Id: 8 })
  expect((await confirm(p)).state).toBe('conflict')
  expect(patches).toHaveLength(0)
})
for (const family of ['contact', 'organisation', 'postformation'])
  test('declared school contradiction never silently changes target ' + family, async () => {
    if (family === 'postformation') personSource(family)
    else {
      ctx.sources[0].family = family as any
      ctx.sources[0].mapping.name = 'École'
      const a = JSON.parse(row.reponses)
      a.push({ question: 'École', answer: 'École fictive' })
      row.reponses = JSON.stringify(a)
    }
    row.reponses = row.reponses.replace('École fictive', 'Autre école')
    await expect(prepare(family === 'postformation' ? {} : { end: '2026-12-15' })).rejects.toThrow(
      'établissement déclaré',
    )
    expect(patches).toHaveLength(0)
  })
test('secondary-email duplicate created after preview blocks confirmation', async () => {
  personSource()
  tables[ADULTS][0].email = 'primary@example.test'
  tables[ADULTS][0].email_2 = 'adult@example.test'
  const p = await prepare({})
  tables[ADULTS].push({ ...tables[ADULTS][0], Id: 20, email: 'adult@example.test', email_2: null })
  expect((await confirm(p)).state).toBe('conflict')
  expect(patches).toHaveLength(0)
})
for (const family of ['preformation', 'postformation', 'suivi_j45', 'evaluation'])
  test(
    'native ' +
      family +
      ' in-flight claim blocks manual write; terminal native claim allows explicit correction',
    async () => {
      personSource(family)
      const p = await prepare({})
      const projection =
        family === 'preformation'
          ? 'public_preformation_projections'
          : family === 'evaluation'
            ? 'public_final_questionnaire_projections'
            : 'public_postformation_projections'
      const claims =
        family === 'preformation'
          ? 'public_preformation_person_claims'
          : family === 'evaluation'
            ? 'public_final_questionnaire_claims'
            : 'public_postformation_claims'
      const field = {
        preformation: 'date_pre_recu',
        postformation: 'date_post_recu',
        suivi_j45: 'date_suivi_recu',
        evaluation: 'date_evaluation_recu',
      }[family]!
      const key = await digest(
        family === 'preformation' ? `${ADULTS}:7:adult@example.test` : `${ADULTS}:19:${field}`,
      )
      sharedSql
        .query(
          "INSERT INTO public_form_receipts(receipt,kind,answers_hash) VALUES('native','fixture','hash')",
        )
        .run()
      sharedSql.query(`INSERT INTO ${claims}(identity_key,receipt) VALUES(?,'native')`).run(key)
      sharedSql
        .query(
          `INSERT INTO ${projection}(receipt,received_at,config_digest,state${family === 'evaluation' ? ',payload' : ''}) VALUES('native',?,'hash','writing'${family === 'evaluation' ? ",'{}'" : ''})`,
        )
        .run(now)
      expect((await confirm(p)).state).toBe('conflict')
      expect(patches).toHaveLength(0)
      sharedSql.query(`UPDATE ${projection} SET state='complete' WHERE receipt='native'`).run()
      const next = await prepare({})
      expect((await confirm(next)).state).toBe('complete')
      expect(patches).toHaveLength(1)
    },
  )
test('manual correction reserves native claims permanently, including secondary email, without creating a person', async () => {
  personSource()
  tables[ADULTS][0].email_2 = 'secondary@example.test'
  const p = await prepare({})
  expect((await confirm(p)).state).toBe('complete')
  expect(sharedSql.query('SELECT count(*) n FROM public_preformation_person_claims').get()).toEqual(
    { n: 2 },
  )
  expect(
    sharedSql
      .query("SELECT count(*) n FROM public_form_receipts WHERE kind='manual_google_correction'")
      .get(),
  ).toEqual({ n: 1 })
  expect(tables[ADULTS]).toHaveLength(1)
})
test('uncertain write quarantines collector durably beyond normal lease and before-value check never unlocks', async () => {
  const p = await prepare()
  fail = 'before'
  const result = await confirm(p)
  fail = ''
  expect(result.message).toContain('collecte Google reste suspendue')
  const lease = sharedSql
    .query("SELECT owner,expires_at FROM google_transition_runs WHERE id='poll'")
    .get() as any
  expect(lease.expires_at).toBe(Number.MAX_SAFE_INTEGER)
  now = '2026-10-02T12:00:00Z'
  const takeover = sharedSql
    .query(
      "INSERT INTO google_transition_runs(id,owner,expires_at) VALUES('poll','worker',?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE expires_at<?",
    )
    .run(Date.parse(now) + 1200000, Date.parse(now))
  expect(takeover.changes).toBe(0)
  expect((await check(p)).state).toBe('uncertain')
  expect(
    sharedSql.query("SELECT owner,expires_at FROM google_transition_runs WHERE id='poll'").get(),
  ).toEqual(lease)
  expect(patches).toHaveLength(1)
})
test('explicit readback after lost response unlocks only after verified audit; never repeats the PATCH', async () => {
  const p = await prepare()
  fail = 'after'
  await confirm(p)
  fail = ''
  expect(
    (sharedSql.query("SELECT expires_at FROM google_transition_runs WHERE id='poll'").get() as any)
      .expires_at,
  ).toBe(Number.MAX_SAFE_INTEGER)
  expect((await check(p)).state).toBe('complete')
  expect(
    (sharedSql.query("SELECT expires_at FROM google_transition_runs WHERE id='poll'").get() as any)
      .expires_at,
  ).toBe(0)
  expect(sql.query('SELECT state FROM google_review_corrections WHERE id=?').get(p.id)).toEqual({
    state: 'complete',
  })
  expect(patches).toHaveLength(1)
})
