import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { futureSheet } from './fixtures/google-future'
import { handleRequest, type Env } from '../workers/google-transition/worker'
import { POST } from '../src/pages/api/hook/google-forms'
import { NC } from '../src/lib/nocodb'

for (const scenario of ['contact', 'deploiement', 'conflict', 'uncertain', 'unknown field']) {
  test(`full authenticated push / real receiver / SQLite / fake Noco: ${scenario}`, async () => {
    const f = await futureSheet(
      scenario === 'contact' || scenario === 'unknown field' ? 'contact' : 'deploiement',
    )
    if (['deploiement', 'conflict', 'uncertain'].includes(scenario)) {
      f.values[8] = '06/10/2026'
      f.values[9] = '07/10/2026'
    }
    if (scenario === 'unknown field') f.values[8] = 'Ancienne question remplie'
    const sql = new Database(':memory:')
    for (const file of [
      'workers/google-transition/schema.sql',
      'migrations/0002_google_form_sync.sql',
      'migrations/0004_operational_submissions.sql',
      'migrations/0005_google_form_transition_captures.sql',
    ])
      sql.exec(readFileSync(new URL('../' + file, import.meta.url), 'utf8'))
    const db = {
      prepare: (query: string) => ({
        bind: (...values: any[]) => ({
          run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
          first: async <T>() => sql.query(query).get(...values) as T | null,
          all: async <T>() => ({ results: sql.query(query).all(...values) as T[] }),
        }),
      }),
    }
    const dossier: Record<string, unknown> = {
      Id: 7,
      etablissements_id: 1,
      cohortes_id: 2,
      notes: 'Note humaine conservée',
      fiche_contact_recue: false,
      fusionne_vers: null,
    }
    if (scenario === 'conflict') dossier.date_debut_formation = '2026-10-05'
    const rawRows: Record<string, unknown>[] = [],
      patches: unknown[] = [],
      trace: string[] = []
    const before = structuredClone(dossier),
      savedFetch = globalThis.fetch
    const secret = 'fictional-bridge-secret-at-least-32-characters'
    const env: Env = {
      STATE: db,
      NOCODB_TOKEN: 'fake',
      JOURNAL_TABLE: 'fictionaljournal',
      SOURCES: JSON.stringify([
        {
          ...f.source,
          label: 'Source fictive',
          mapping: f.mapping,
          policy: f.policy,
          projectionFirstRow: 2,
        },
      ]),
      ENABLED: 'true',
      PROJECTION_ENABLED: 'true',
      PROJECTION_START_AT: f.source.projectionStartAt,
      INPUT_MODE: 'push',
      RUN_SECRET: secret,
      GOOGLE_FORMS_SYNC_SECRET: secret,
    }
    const locals = {
      runtime: {
        env: {
          FORM_SUBMISSIONS: db,
          NOCODB_TOKEN: 'fake',
          GOOGLE_FORMS_TRANSITION_ENABLED: 'true',
          GOOGLE_FORMS_TRANSITION_MODE: 'apply',
          GOOGLE_FORMS_SYNC_SECRET: secret,
          GOOGLE_FORMS_SYNC_SOURCES: JSON.stringify([f.source]),
        },
      },
    }
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input)),
        method = init.method ?? 'GET'
      if (url.href === 'https://euneos.fr/api/hook/google-forms') {
        expect(rawRows).toHaveLength(1) // full raw evidence was verified first
        trace.push('hook')
        return POST({ request: new Request(url, init), locals } as any)
      }
      expect(url.origin).toBe('https://app.nocodb.com') // any mail/Google call fails
      const parts = url.pathname.split('/'),
        table = parts[4]
      if (table === env.JOURNAL_TABLE) {
        if (method === 'POST') {
          const r = { Id: 1, ...JSON.parse(String(init.body)) }
          rawRows.push(r)
          return Response.json(r)
        }
        if (method === 'PATCH') Object.assign(rawRows[0], JSON.parse(String(init.body)))
        if (parts[6] || method === 'PATCH') return Response.json(rawRows[0])
        return Response.json({ list: rawRows, pageInfo: { isLastPage: true } })
      }
      if (method === 'PATCH') {
        expect(table).toBe(NC.tables.participations)
        const [patch] = JSON.parse(String(init.body))
        patches.push(patch)
        Object.assign(dossier, patch)
        if (scenario === 'uncertain') throw new Error('lost_after_commit')
        return Response.json([patch])
      }
      expect(method).toBe('GET')
      const records =
        table === NC.tables.cohortes
          ? [{ Id: 2, active: true, annee_debut: 2026, annee_fin: 2027 }]
          : table === NC.tables.etablissements
            ? [
                {
                  Id: 1,
                  nom: f.values[1],
                  ville: f.values[2],
                  cp: f.values[3],
                  referent_email: f.values[5],
                },
              ]
            : table === NC.tables.participations
              ? [dossier]
              : null
      expect(records).not.toBeNull()
      return Response.json(
        parts[6] ? records![0] : { list: records, pageInfo: { isLastPage: true } },
      )
    }) as typeof fetch
    try {
      const body = JSON.stringify({
        version: 1,
        source: { spreadsheetId: f.source.spreadsheetId, sheetId: 0 },
        headers: f.headers,
        rows: [f.values],
      })
      for (let replay = 0; replay < 3; replay++) {
        const request = new Request('https://worker.invalid/ingest', {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body,
        })
        const response = await handleRequest(request, env, {
          fetch: globalThis.fetch,
          now: () => Date.parse('2026-09-29T08:30:00Z'),
          sleep: async () => {},
        })
        expect(response.status).toBe(200)
      }
      expect(trace).toEqual(['hook'])
      expect(rawRows).toHaveLength(1)
      if (scenario === 'conflict' || scenario === 'unknown field') {
        expect(dossier).toEqual(before)
        expect(patches).toHaveLength(0)
        expect(rawRows[0].statut_reprise).toBe('À rapprocher')
      } else {
        expect(patches).toHaveLength(1)
        expect(rawRows[0].statut_reprise).toBe(
          scenario === 'uncertain' ? 'À rapprocher' : 'Repris dans le dossier',
        )
      }
      const locks = sql.query('SELECT * FROM operational_submission_locks').all()
      expect(locks).toHaveLength(scenario === 'uncertain' ? 1 : 0)
      expect(sql.query('SELECT * FROM google_form_transition_captures').all()).toHaveLength(1)
    } finally {
      globalThis.fetch = savedFetch
      sql.close()
    }
  })
}
