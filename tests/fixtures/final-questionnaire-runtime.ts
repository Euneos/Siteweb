import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import type { FinalConfig } from '../../src/lib/final-questionnaire-plan'
import { finalQuestionnaireDefinitions as definitions } from '../../src/lib/final-questionnaire-definition'

export const finalTables = {
  people: 'fictionaladults0001',
  records: 'fictionaldossiers01',
  schools: 'fictionalschools001',
  journal: 'fictionaljournal001',
}
export function finalFixtureConfig(index: number): FinalConfig {
  return {
    version: 1,
    family: index === 0 ? 'evaluation_formation' : 'bilan_etablissement',
    tables: {
      people: index === 0 ? finalTables.people : finalTables.schools,
      records: finalTables.records,
      schools: finalTables.schools,
    },
    // Mirrors the native private format: aliases only, no required `answer`.
    cohorts: [
      {
        id: 2,
        answers: ['2026-2027', '2026 2027'],
        establishments: [{ answer: 'École fictive', participationId: 7, schoolId: 9 }],
      },
      {
        id: 1,
        answers: ['2025-2026', '2025/2026', '2025 2026', '2025 - 2026', '2025-26'],
        establishments: [{ answer: 'École fictive passée', participationId: 8, schoolId: 9 }],
      },
    ],
    receipt: {
      field: index === 0 ? 'date_evaluation_recu' : 'date_bilan_etablissement_recu',
      type: 'Date',
    },
    ...(index === 1 ? { scoreNps: true } : {}),
  }
}
export const finalFixtureAnswers = (index: number) =>
  Object.fromEntries(
    definitions[index].questions.map((q) => [
      q.key,
      q.key === 'email'
        ? index === 0
          ? 'adult@example.invalid'
          : 'contact@example.invalid'
        : q.key === 'school'
          ? 'École fictive'
          : q.key === 'year'
            ? '2026-2027'
            : q.type === 'checkbox'
              ? q.choices.slice(0, 2)
              : (q.choices[0] ?? 'Réponse fictive'),
    ]),
  )
export function finalFixtureRuntime() {
  const sql = new Database(':memory:')
  for (const f of readdirSync(new URL('../../migrations/', import.meta.url))
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort())
    sql.exec(readFileSync(new URL('../../migrations/' + f, import.meta.url), 'utf8'))
  const db = {
    prepare: (query: string) => ({
      bind: (...values: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
        first: async () => sql.query(query).get(...values),
        all: async () => ({ results: sql.query(query).all(...values) }),
      }),
    }),
  }
  const state = {
    rows: [] as any[],
    people: [
      {
        Id: 50,
        nom: 'Adulte',
        prenom: 'Fictif',
        email: 'adult@example.invalid',
        email_2: null,
        participations_id: 7,
        date_evaluation_recu: null,
        statut: 'Inchangé',
        date_post_recu: null,
      },
    ],
    schools: [
      {
        Id: 9,
        nom: 'École fictive',
        referent_email: 'contact@example.invalid',
        email_direction: 'direction@example.invalid',
        email_institutionnel: null,
        email_logistique: null,
      },
    ],
    dossiers: [
      {
        Id: 7,
        cohortes_id: 2,
        etablissements_id: 9,
        fusionne_vers: null,
        date_bilan_etablissement_recu: null,
        score_nps: null,
        statut_formation: 'Inchangé',
      },
      {
        Id: 8,
        cohortes_id: 1,
        etablissements_id: 9,
        fusionne_vers: null,
        date_bilan_etablissement_recu: null,
        score_nps: null,
        statut_formation: 'Inchangé',
      },
    ] as any[],
    calls: [] as { url: string; method: string; body?: any }[],
    writes: [] as any[],
    behavior: '',
    blocked: false,
    beforeWrite: null as null | (() => void | Promise<void>),
    afterWrite: null as null | (() => void),
    schemaMissing: false,
    schemaWrongType: false,
    truncated: false,
  }
  const env: any = {
    FORM_SUBMISSIONS: db,
    NOCODB_TOKEN: 'fake-only',
    PUBLIC_FORMS_TABLE: finalTables.journal,
    OPERATIONAL_FORMS_ENABLED: 'true',
    EVALUATION_FORMATION_PROJECTION: JSON.stringify(finalFixtureConfig(0)),
    BILAN_ETABLISSEMENT_PROJECTION: JSON.stringify(finalFixtureConfig(1)),
  }
  const records = (table: string): any[] =>
    table === finalTables.people
      ? state.people
      : table === finalTables.schools
        ? state.schools
        : table === finalTables.records
          ? state.dossiers
          : table === finalTables.journal
            ? state.rows
            : (() => {
                throw new Error('Unexpected table')
              })()
  const fetcher = (async (input: any, init: any = {}) => {
    const url = new URL(String(input)),
      method = init.method ?? 'GET',
      body = init.body ? JSON.parse(init.body) : undefined
    if (url.origin !== 'https://app.nocodb.com') throw new Error('External transport forbidden')
    state.calls.push({ url: url.href, method, body })
    if (url.pathname.startsWith('/api/v2/meta/tables/')) {
      if (method !== 'GET') throw new Error('Metadata writes forbidden')
      const table = url.pathname.split('/').at(-1)
      if (![finalTables.people, finalTables.records].includes(table!))
        throw new Error('Unexpected metadata')
      return Response.json({
        columns: state.schemaMissing
          ? []
          : [
              {
                title:
                  table === finalTables.people
                    ? 'date_evaluation_recu'
                    : 'date_bilan_etablissement_recu',
                uidt: state.schemaWrongType ? 'SingleLineText' : 'Date',
              },
              { title: 'score_nps', uidt: 'Number' },
            ],
      })
    }
    const match = /^\/api\/v2\/tables\/([^/]+)\/records(?:\/(\d+))?$/.exec(url.pathname)
    if (!match) throw new Error('Unexpected endpoint')
    const table = match[1],
      data = records(table),
      isSource = table === finalTables.journal
    if (!isSource && (state.blocked || state.behavior === 'read-failure'))
      throw new Error('Fictive read failure')
    if (method !== 'GET') {
      const batch = Array.isArray(body) ? body : [body]
      if (isSource) {
        if (method !== 'POST') throw new Error('Journal must stay append-only')
        if (state.behavior === 'source-lost-before') throw new Error('Fictive lost source')
        const added = batch.map((r) => ({ ...r, Id: state.rows.length + 1 }))
        state.rows.push(...added)
        if (state.behavior === 'source-lost-after') throw new Error('Fictive lost source reply')
        return Response.json(added)
      }
      if (method !== 'PATCH') throw new Error('Business creations forbidden')
      state.writes.push({ table, body })
      await state.beforeWrite?.()
      if (state.behavior === 'write-lost-before') throw new Error('Fictive lost write')
      for (const patch of batch)
        Object.assign(
          data.find((r) => r.Id === patch.Id),
          patch,
        )
      state.afterWrite?.()
      if (state.behavior === 'readback-lost') state.blocked = true
      if (state.behavior === 'write-lost-after') throw new Error('Fictive lost reply')
      return Response.json(body)
    }
    if (match[2]) return Response.json(data.find((r) => r.Id === Number(match[2])) ?? {})
    const where = url.searchParams.get('where')
    const filtered = where
      ? data.filter((row) => {
          const fragments = [...where.matchAll(/\(([^,]+),eq,([^)]*)\)/g)]
          const checks = fragments.map(
            (m) => String(row[m[1]]).toLowerCase() === m[2].toLowerCase(),
          )
          return where.includes('~or') ? checks.some(Boolean) : checks.every(Boolean)
        })
      : data
    return Response.json({ list: filtered, pageInfo: { isLastPage: !state.truncated } })
  }) as typeof fetch
  return {
    sql,
    db,
    env,
    state,
    fetch: fetcher,
    locals: () => ({ runtime: { env } }),
    projection: () =>
      sql
        .query('SELECT * FROM public_final_questionnaire_projections ORDER BY rowid DESC LIMIT 1')
        .get() as any,
    close: () => sql.close(),
  }
}
