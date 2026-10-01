import { afterEach, expect, test } from 'bun:test'
import { finalQuestionnaireDefinitions as definitions } from '../src/lib/final-questionnaire-definition'
import { parseFinalQuestionnaire } from '../src/lib/final-questionnaire'
import { finalQuestionnairePreview } from '../src/lib/final-questionnaire-preview'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
const answers = (def: (typeof definitions)[number]) =>
  Object.fromEntries(
    def.questions.map((q) => [
      q.key,
      q.key === 'email'
        ? 'fictif@example.invalid'
        : q.key === 'school'
          ? 'École fictive'
          : q.key === 'year'
            ? '2026-2027'
            : q.type === 'checkbox'
              ? q.choices.slice(0, 2)
              : (q.choices[0] ?? 'Réponse fictive'),
    ]),
  )
const request = (
  def: (typeof definitions)[number],
  body: unknown,
  host = 'localhost',
  headers = {},
) =>
  new Request(`https://${host}/api/questionnaires/${def.slug}`, {
    method: 'POST',
    headers: { Origin: `https://${host}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
for (const def of definitions) {
  const body = () => ({ version: def.version, website: '', answers: answers(def) })
  test(`${def.slug}: all source questions preserved and exactly one authorized site addition`, () => {
    expect(def.questions.filter((q) => q.origin === 'source')).toHaveLength(def.sourceQuestionCount)
    expect(def.questions.filter((q) => q.origin === 'source' && q.required)).toHaveLength(
      def.sourceRequiredCount,
    )
    expect(def.questions.filter((q) => q.origin === 'site').map((q) => q.key)).toEqual(['year'])
    expect(new Set(def.questions.map((q) => q.key)).size).toBe(def.questions.length)
    expect(parseFinalQuestionnaire(def, answers(def))).toEqual(answers(def))
  })
  test(`${def.slug}: optional answers omitted, required answers never omitted`, () => {
    const value = answers(def)
    for (const q of def.questions.filter((q) => !q.required)) delete value[q.key]
    expect(() => parseFinalQuestionnaire(def, value)).not.toThrow()
    for (const q of def.questions.filter((q) => q.required)) {
      const missing = { ...value }
      delete missing[q.key]
      expect(() => parseFinalQuestionnaire(def, missing)).toThrow()
    }
  })
  for (const variant of [
    'unknown-field',
    'email',
    'year',
    'non-consecutive-year',
    'oversize',
    'control',
    'choice',
    'array-in-text',
  ])
    test(`${def.slug}: refuses ${variant}`, () => {
      const value: any = answers(def)
      if (variant === 'unknown-field') value.participationId = 7
      if (variant === 'email') value.email = 'pas un email'
      if (variant === 'year') value.year = '2026'
      if (variant === 'non-consecutive-year') value.year = '2026-2028'
      if (variant === 'oversize') value.school = 'x'.repeat(5001)
      if (variant === 'control') value.school = 'École\nAutre'
      if (variant === 'array-in-text') value.school = ['École']
      if (variant === 'choice')
        value[def.questions.find((q) => q.choices.length && q.type !== 'checkbox')!.key] =
          'Choix inconnu'
      expect(() => parseFinalQuestionnaire(def, value)).toThrow()
    })
  test(`${def.slug}: production always closed even for valid input; no transport or storage`, async () => {
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error('External transport forbidden')
      },
      {
        preconnect() {
          throw new Error('External transport forbidden')
        },
      },
    )
    for (const host of ['euneos.fr', 'www.euneos.fr']) {
      const result = await finalQuestionnairePreview(request(def, body(), host), def.slug)
      expect(result.status).toBe(503)
      expect(await result.json()).toMatchObject({ code: 'projection_unavailable' })
      expect(result.headers.get('cache-control')).toContain('no-store')
    }
  })
  test(`${def.slug}: preview validates with no persistence and no false live receipt`, async () => {
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error('External transport forbidden')
      },
      {
        preconnect() {
          throw new Error('External transport forbidden')
        },
      },
    )
    const result = await finalQuestionnairePreview(request(def, body()), def.slug)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ state: 'complete', code: 'preview', preview: true })
    for (const broken of [
      { ...body(), version: 'unknown' },
      { ...body(), website: 'bot' },
      { ...body(), extra: 'field' },
    ])
      expect((await finalQuestionnairePreview(request(def, broken), def.slug)).status).toBe(400)
    expect(
      (
        await finalQuestionnairePreview(
          request(def, body(), 'localhost', { Origin: 'https://other.invalid' }),
          def.slug,
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await finalQuestionnairePreview(
          request(def, body(), 'localhost', { 'Content-Type': 'text/plain' }),
          def.slug,
        )
      ).status,
    ).toBe(415)
    expect(
      (await finalQuestionnairePreview(request(def, { large: 'x'.repeat(65536) }), def.slug))
        .status,
    ).toBe(413)
  })
}
test('evaluation preserves six multiple-checkbox questions and three dropdowns; no invented respondent name', () => {
  const def = definitions[0],
    value: any = answers(def)
  expect(def.questions.filter((q) => q.type === 'checkbox')).toHaveLength(6)
  expect(def.questions.filter((q) => q.type === 'select')).toHaveLength(3)
  expect(def.questions.some((q) => q.key === 'name')).toBe(false)
  expect(parseFinalQuestionnaire(def, value).q19).toEqual(['Non', 'Peut-être'])
  for (const bad of ['Non', [], ['Non', 'Non'], ['Inconnu']]) {
    expect(() => parseFinalQuestionnaire(def, { ...value, q19: bad })).toThrow()
  }
  expect(() => parseFinalQuestionnaire(def, { ...value, q14: 'inconnu' })).toThrow()
  expect(() => parseFinalQuestionnaire(def, { ...value, q18: 'Autre :' })).not.toThrow()
  expect(() => parseFinalQuestionnaire(def, { ...value, q18Other: 'Champ non prouvé' })).toThrow()
})
test('bilan preserves unconditional required Si non and numeric scale including zero', () => {
  const def = definitions[1],
    value: any = answers(def)
  expect(def.questions.find((q) => q.key === 'q10')!.required).toBe(true)
  expect(def.questions.find((q) => q.key === 'q14')!.choices).toEqual(
    Array.from({ length: 11 }, (_, i) => String(i)),
  )
  expect(parseFinalQuestionnaire(def, { ...value, q09: 'Oui sans réserve', q14: '0' }).q14).toBe(
    '0',
  )
  expect(() =>
    parseFinalQuestionnaire(def, { ...value, q09: 'Oui sans réserve', q10: '' }),
  ).toThrow()
})

// Hashes computed independently from the private rendered definitions, over public
// question content only. They deliberately exclude source/account identifiers.
test('exact labels, types, options, obligations, sections and scale endpoints match source proofs', async () => {
  const hashes = [
    '877df02bb7ed9afd8ef4c4195cf7d36f84ed0a399b9a5c3cfb5147af6ad2c2e5',
    '092eb859ca4cb7ca47a9159422fc5e8e4ebf9d9d49b1b00ef8b0c7ba41467dd3',
  ]
  for (const [index, def] of definitions.entries()) {
    const content = def.questions
      .filter((q) => q.origin === 'source')
      .map((q) => ({
        label: q.label,
        description: q.description,
        section: q.section,
        type: q.key === 'email' ? 'text' : q.type,
        required: q.required,
        choices: q.choices,
        scaleLabels: q.scaleLabels,
      }))
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(content)),
    )
    expect(Buffer.from(bytes).toString('hex')).toBe(hashes[index])
  }
})
