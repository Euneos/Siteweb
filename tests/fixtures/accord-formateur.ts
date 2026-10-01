import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { accordVersion } from '../../src/lib/accord-formateur-definition'
export const accordConfig = {
  family: 'accord_formateur',
  headerDigest: 'a'.repeat(64),
  mapping: {
    timestamp: 'timestamp',
    email: 'email',
    firstName: 'firstName',
    lastName: 'lastName',
    agreement: 'agreement',
    agreementDate: 'agreementDate',
  },
  captureOnly: ['signature'],
  tables: { people: 'fictiontrainerstable', records: 'fictionjourneystable' },
  cohorts: [{ id: null }],
  fixedCohort: null,
  agreementAnswer: 'Oui',
}
export const accordAnswers = () => ({
  email: 'trainer@example.invalid',
  lastName: 'Fictif',
  firstName: 'Camille',
  agreement: 'Oui',
  signature: 'Camille Fictif',
  agreementDate: '2026-10-01',
})
export const accordBody = () => ({ version: accordVersion, website: '', answers: accordAnswers() })
export function accordFixture() {
  const sql = new Database(':memory:')
  const root = new URL('../../migrations/', import.meta.url)
  for (const f of readdirSync(root)
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort())
    sql.exec(readFileSync(new URL(f, root), 'utf8'))
  const db = {
    prepare: (query: string) => ({
      bind: (...values: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
        first: async () => sql.query(query).get(...values),
        all: async () => ({ results: sql.query(query).all(...values) }),
      }),
    }),
  }
  const fixture = {
    sql,
    db,
    env: {
      FORM_SUBMISSIONS: db,
      OPERATIONAL_FORMS_ENABLED: 'true',
      PUBLIC_FORMS_TABLE: 'fictionjournalstable',
      NOCODB_TOKEN: 'fixture-only',
      ACCORD_FORMATEUR_PERSON_PROJECTION: JSON.stringify(accordConfig),
    } as Record<string, any>,
    people: [
      { Id: 12, prenom: 'Camille', nom: 'Fictif', email: 'trainer@example.invalid' },
    ] as any[],
    journeys: [
      {
        Id: 21,
        formateurs_id: 12,
        cohortes_id: null,
        fusionne_vers: null,
        accord_signe: false,
        date_accord: null,
        statut: 'Validé',
        date_candidature: '2025-01-01',
      },
    ] as any[],
    sources: [] as any[],
    calls: [] as any[],
    behavior: '',
    blockReads: false,
    journeyLists: 0,
    proof: () =>
      sql
        .query('SELECT * FROM public_accord_projections ORDER BY received_at,receipt LIMIT 1')
        .get() as any,
    fetch: async (input: any, init: any): Promise<Response> => {
      const url = new URL(String(input)),
        method = init?.method ?? 'GET'
      if (url.origin !== 'https://app.nocodb.com') throw new Error('Unexpected external transport')
      const [, , , , table, , id] = url.pathname.split('/')
      if (
        ![accordConfig.tables.people, accordConfig.tables.records, 'fictionjournalstable'].includes(
          table,
        )
      )
        throw new Error('Unexpected table')
      fixture.calls.push({ method, table, body: init?.body ? JSON.parse(init.body) : null })
      if (table === 'fictionjournalstable') {
        if (method === 'PATCH') throw new Error('Journal must remain immutable')
        if (fixture.behavior === 'source-lookup-fails' && method === 'GET')
          throw new Error('PRIVATE_PROVIDER_ERROR')
        if (method === 'POST') {
          if (fixture.behavior === 'source-lost-before') throw new Error('PRIVATE_PROVIDER_ERROR')
          const rows = JSON.parse(init.body).map((row: any) => ({
            ...row,
            Id: fixture.sources.length + 1,
          }))
          fixture.sources.push(...rows)
          if (fixture.behavior === 'source-lost-after') throw new Error('PRIVATE_PROVIDER_ERROR')
          return Response.json(rows)
        }
        if (method !== 'GET') throw new Error('Unexpected method')
        if (id)
          return Response.json(
            fixture.behavior === 'source-corrupted'
              ? { ...fixture.sources[0], reponses: 'corrupt' }
              : fixture.sources.find((s) => s.Id === Number(id)),
          )
        const list = fixture.sources.filter(
          (s) =>
            !url.searchParams.has('where') ||
            url.searchParams.get('where') === `(cle_reponse,eq,${s.cle_reponse})`,
        )
        return Response.json({
          list: fixture.behavior === 'source-duplicate' ? [...list, ...list] : list,
        })
      }
      if (fixture.blockReads || fixture.behavior === 'identity-read-fails')
        throw new Error('PRIVATE_PROVIDER_ERROR')
      if (table === accordConfig.tables.people) {
        if (method !== 'GET') throw new Error('Never mutate trainer')
        if (id) return Response.json(fixture.people.find((p) => p.Id === Number(id)) ?? {})
        return Response.json({
          list: fixture.people.filter(
            (p) => url.searchParams.get('where') === `(email,eq,${p.email})`,
          ),
          pageInfo: { isLastPage: fixture.behavior !== 'truncated' },
        })
      }
      if (method === 'PATCH') {
        if (fixture.behavior === 'business-lost-before') throw new Error('PRIVATE_PROVIDER_ERROR')
        for (const patch of JSON.parse(init.body)) {
          if (Object.keys(patch).some((k) => !['Id', 'accord_signe', 'date_accord'].includes(k)))
            throw new Error('Disallowed business field')
          Object.assign(
            fixture.journeys.find((j) => j.Id === patch.Id),
            patch,
          )
        }
        if (fixture.behavior === 'business-readback-fails') fixture.blockReads = true
        if (fixture.behavior === 'business-lost-after') throw new Error('PRIVATE_PROVIDER_ERROR')
        return Response.json(JSON.parse(init.body))
      }
      if (method !== 'GET') throw new Error('Never create journey')
      if (id) return Response.json(fixture.journeys.find((j) => j.Id === Number(id)) ?? {})
      fixture.journeyLists++
      if (fixture.behavior === 'concurrent-journey' && fixture.journeyLists === 2)
        fixture.journeys.push({ ...fixture.journeys[0], Id: 22 })
      return Response.json({
        list: fixture.journeys.filter(
          (j) => url.searchParams.get('where') === `(formateurs_id,eq,${j.formateurs_id})`,
        ),
        pageInfo: { isLastPage: true },
      })
    },
  }
  return fixture
}
