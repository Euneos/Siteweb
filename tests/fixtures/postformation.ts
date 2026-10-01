import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import {
  postformationDefinitions,
  type PostformationDefinition,
} from '../../src/lib/postformation-definition'

export const samplePostformation = (def: PostformationDefinition) =>
  Object.fromEntries(
    def.questions.flatMap((q) => [
      [
        q.key,
        q.key === 'name'
          ? 'Adulte Fictif'
          : q.key === 'email'
            ? 'adult@example.invalid'
            : q.key === 'school'
              ? 'École fictive'
              : q.key === 'year'
                ? '2026-2027'
                : q.type === 'checkbox'
                  ? [q.choices[0]]
                  : q.required
                    ? (q.choices[0] ?? 'Réponse fictive')
                    : '',
      ],
      ...(q.other ? [[`${q.key}Other`, '']] : []),
    ]),
  )
export function postformationFixture() {
  const sql = new Database(':memory:')
  const root = new URL('../../migrations/', import.meta.url)
  for (const file of readdirSync(root)
    .filter((f) => /^\d.*\.sql$/.test(f))
    .sort())
    sql.exec(readFileSync(new URL(file, root), 'utf8'))
  const db = {
    prepare: (q: string) => ({
      bind: (...v: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
        first: async () => sql.query(q).get(...v),
        all: async () => ({ results: sql.query(q).all(...v) }),
      }),
    }),
  }
  const config = (family: string) => ({
    family,
    headerDigest: '0'.repeat(64),
    mapping: {
      timestamp: 'Horodateur',
      name: 'Nom',
      email: 'Email',
      establishment: 'Établissement',
      cohort: 'Année',
    },
    captureOnly: [],
    tables: { people: 'fictionaladults0001', records: 'fictionaldossiers01' },
    cohorts: [
      {
        id: 2,
        answer: '2026-2027',
        establishments: [{ answer: 'École fictive', participationId: 7, schoolId: 9 }],
      },
    ],
  })
  const f = {
    sql,
    db,
    rows: [] as any[],
    calls: [] as any[],
    writes: [] as any[],
    behavior: '',
    readbackBlocked: false,
    people: [
      {
        Id: 50,
        prenom: 'Adulte',
        nom: 'Fictif',
        email: 'adult@example.invalid',
        email_2: null,
        participations_id: 7,
        date_post_recu: null,
        date_suivi_recu: null,
        statut: 'Déclaré — préformation',
      },
    ] as any[],
    dossier: { Id: 7, cohortes_id: 2, etablissements_id: 9, fusionne_vers: null } as any,
    env: {
      FORM_SUBMISSIONS: db,
      NOCODB_TOKEN: 'fixture-only',
      PUBLIC_FORMS_TABLE: 'publicanswerstable',
      OPERATIONAL_FORMS_ENABLED: 'true',
      POST_FORMATION_PERSON_PROJECTION: JSON.stringify(config('postformation_b')),
      SUIVI_J45_PERSON_PROJECTION: JSON.stringify(config('suivi_j45')),
    } as any,
  }
  const transport = async (input: any, init: any) => {
    const url = new URL(String(input)),
      method = init?.method ?? 'GET',
      table = url.pathname.split('/')[4],
      id = /records\/(\d+)$/.exec(url.pathname)?.[1]
    f.calls.push({ url: url.href, method })
    if (
      url.origin !== 'https://app.nocodb.com' ||
      !['publicanswerstable', 'fictionaladults0001', 'fictionaldossiers01'].includes(table)
    )
      throw new Error('Unexpected external transport')
    if (table === 'fictionaldossiers01') {
      if (method !== 'GET') throw new Error('Unexpected dossier mutation')
      return Response.json(f.dossier)
    }
    if (table === 'fictionaladults0001') {
      if (f.behavior === 'adult-read-failure' || f.readbackBlocked)
        throw new Error('PRIVATE_READ_CANARY')
      if (method !== 'GET') {
        if (method !== 'PATCH') throw new Error('No adult creation allowed')
        const patches = JSON.parse(init.body)
        f.writes.push(...patches)
        if (f.behavior === 'write-before-save') throw new Error('PRIVATE_WRITE_CANARY')
        for (const p of patches)
          Object.assign(
            f.people.find((a) => a.Id === p.Id),
            p,
          )
        if (f.behavior === 'write-readback-failure') f.readbackBlocked = true
        if (f.behavior === 'write-after-save') throw new Error('PRIVATE_WRITE_CANARY')
        return Response.json(patches)
      }
      if (id) {
        if (f.behavior === 'identity-race') f.people[0].nom = 'Changé'
        return Response.json(f.people.find((a) => a.Id === Number(id)) ?? {})
      }
      const where = url.searchParams.get('where') ?? ''
      return Response.json({
        list: f.people.filter((a) =>
          [a.email, a.email_2].filter(Boolean).some((e) => where.includes(`,eq,${e})`)),
        ),
        pageInfo: { isLastPage: f.behavior !== 'partial-list' },
      })
    }
    if (method === 'POST') {
      if (f.behavior === 'capture-before-save') throw new Error('PRIVATE_CAPTURE_CANARY')
      const records = JSON.parse(init.body).map((r: any) => ({ ...r, Id: f.rows.length + 1 }))
      f.rows.push(...records)
      if (f.behavior === 'capture-after-save') throw new Error('PRIVATE_CAPTURE_CANARY')
      return Response.json(records)
    }
    if (method === 'PATCH') throw new Error('Journal must remain append-only')
    if (id)
      return Response.json(
        f.behavior === 'capture-mismatch'
          ? { ...f.rows[0], reponses: 'corrupted' }
          : f.rows.find((r) => r.Id === Number(id)),
      )
    const where = url.searchParams.get('where')
    return Response.json({
      list: where ? f.rows.filter((r) => where === `(cle_reponse,eq,${r.cle_reponse})`) : f.rows,
    })
  }
  return Object.assign(f, { transport, config })
}
