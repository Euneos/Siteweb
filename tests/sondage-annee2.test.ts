import { expect, test } from 'bun:test'
import { parseSurvey, surveyQuestions } from '../src/lib/sondage-annee2'
import { POST } from '../src/pages/api/questionnaires/sondage-annee2'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
const identity = {
  school: 'Collège fictif',
  city: 'Ville test',
  name: 'Référente test',
  email: 'test@example.invalid',
}
test('survey: ranking preserves order and rejects duplicate or conflicting choices', () => {
  const choices = surveyQuestions.find((q) => q.key === 'activities')!.choices!
  const ranked = choices.slice(0, 6).reverse()
  expect(parseSurvey({ ...identity, activities: ranked }).activities).toEqual(ranked)
  expect(() => parseSurvey({ ...identity, activities: [choices[0]], activityStatus: 'Nous n’envisageons pas de suite pour le moment.' })).toThrow()
  expect(() => parseSurvey({ ...identity, activities: [choices[0], choices[0]] })).toThrow()
  expect(parseSurvey({ ...identity, activities: choices.slice(0, 3) }).activities).toHaveLength(3)
  expect(() => parseSurvey({ ...identity, activities: ['Autre'] })).toThrow()
})
test('survey: hidden answers discarded, other answers required only when selected', () => {
  expect(
    parseSurvey({ ...identity, training: 'Non.', trainingCount: '12' }).trainingCount,
  ).toBeUndefined()
  expect(parseSurvey({ ...identity, training: 'Oui.', trainingCount: '12' }).trainingCount).toBe(
    '12',
  )
  expect(() => parseSurvey({ ...identity, students: ['Autre'] })).toThrow()
  expect(
    parseSurvey({ ...identity, students: ['Autre'], studentsOther: 'Un journal' }).studentsOther,
  ).toBe('Un journal')
  expect(
    parseSurvey({ ...identity, students: [], studentsOther: 'Ancienne saisie' }).studentsOther,
  ).toBeUndefined()
})
test('survey: preview validates without storage and refuses cross-origin requests', async () => {
  const request = (origin: string) =>
    new Request('http://localhost/api/questionnaires/sondage-annee2', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'sondage-annee2-v1', website: '', answers: identity }),
    })
  const response = await POST({ request: request('http://localhost'), locals: {} } as any)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ state: 'complete', preview: true })
  expect(
    (await POST({ request: request('https://other.invalid'), locals: {} } as any)).status,
  ).toBe(403)
})
test('survey: lost write acknowledgement is reconciled without a second write', async () => {
  const sql = new Database(':memory:')
  sql.run(
    readFileSync(
      new URL('../migrations/0009_public_form_receipts.sql', import.meta.url),
      'utf8',
    ).split('CREATE TABLE IF NOT EXISTS public_form_rate_limits')[0],
  )
  sql.run(
    'CREATE TABLE public_form_rate_limits(bucket TEXT PRIMARY KEY,requests INTEGER,expires_at INTEGER)',
  )
  const db = {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(query).run(...args).changes } }),
        first: async () => sql.query(query).get(...args),
      }),
    }),
  }
  const locals = {
    runtime: {
      env: {
        FORM_SUBMISSIONS: db,
        NOCODB_TOKEN: 'fictional',
        OPERATIONAL_FORMS_ENABLED: 'true',
        PUBLIC_FORMS_TABLE: 'fictionalsources01',
      },
    },
  }
  const originalFetch = globalThis.fetch
  let saved: any = null,
    writes = 0
  globalThis.fetch = (async (input: any, options: any) => {
    const url = String(input)
    if (!url.includes('/tables/fictionalsources01/records'))
      throw new Error('Unexpected destination')
    if (options?.method === 'POST') {
      writes++
      saved = { ...JSON.parse(options.body)[0], Id: 1 }
      throw new Error('Lost acknowledgement')
    }
    return Response.json(url.includes('?') ? { list: saved ? [saved] : [] } : saved)
  }) as typeof fetch
  const submit = () =>
    POST({
      locals,
      request: new Request('https://euneos.fr/api/questionnaires/sondage-annee2', {
        method: 'POST',
        headers: { Origin: 'https://euneos.fr', 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 'sondage-annee2-v1', website: '', answers: identity }),
      }),
    } as any)
  try {
    expect((await submit()).status).toBe(503)
    expect(await (await submit()).json()).toEqual({ state: 'complete' })
    expect(await (await submit()).json()).toEqual({ state: 'complete' })
    expect(writes).toBe(1)
    expect(sql.query('SELECT noco_id,state FROM public_form_receipts').get()).toEqual({
      noco_id: 1,
      state: 'complete',
    })
  } finally {
    globalThis.fetch = originalFetch
    sql.close()
  }
})
