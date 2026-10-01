import { expect, test } from 'bun:test'
import {
  APPLICATION_FIELD_RULES,
  validateApplicationFields,
  type ApplicationField,
} from '../src/lib/google-form-application'
import {
  planGooglePerson,
  checkGooglePersonPlan,
  googleReconciliationDetail,
  type PersonProjectionConfig,
} from '../src/lib/google-form-person'
import { digest } from '../src/lib/google-form-sync'

const tables = { people: 'fictionalpeople123', records: 'fictionalrecords123' }
async function fixture(
  family: PersonProjectionConfig['family'] = 'candidature_formateur',
  fields: ApplicationField[] = [{ field: 'motivation', type: 'text', header: 'Motivation' }],
  answers = ['Accompagner les équipes'],
) {
  const adult = family === 'suivi_j45',
    school = family === 'candidature_etablissement'
  const headers = [
    'Horodateur',
    'Nom',
    'Email',
    'Année',
    ...(adult ? ['École'] : []),
    ...fields.flatMap((f) =>
      f.type === 'submissionDate' ? [] : [typeof f.header === 'string' ? f.header : f.header.label],
    ),
  ]
  const cells = [
    '01/10/2026 12:00:00',
    school ? 'École Exemple' : 'Alex Exemple',
    'alex@example.test',
    '2026–2027',
    ...(adult ? ['École Exemple'] : []),
    ...answers,
  ]
  const config: PersonProjectionConfig = {
    family,
    headerDigest: await digest(JSON.stringify(headers)),
    mapping: {
      timestamp: 'Horodateur',
      name: 'Nom',
      email: 'Email',
      cohort: 'Année',
      ...(adult ? { establishment: 'École' } : {}),
    },
    captureOnly: [],
    tables,
    cohorts: [
      {
        id: 2,
        answer: '2026–2027',
        ...(adult
          ? { establishments: [{ answer: 'École Exemple', participationId: 7, schoolId: 9 }] }
          : {}),
      },
    ],
    businessFields: { version: 1, fields },
  }
  const person: Record<string, unknown> & { Id: number } = {
    Id: 50,
    nom: school ? 'École Exemple' : 'Exemple',
    prenom: school ? '' : 'Alex',
    email: 'alex@example.test',
    referent_email: 'alex@example.test',
    participations_id: 7,
  }
  const record: Record<string, unknown> & { Id: number } = {
    Id: 7,
    cohortes_id: 2,
    formateurs_id: 50,
    etablissements_id: school ? 50 : 9,
    fusionne_vers: null,
    statut: 'Inchangé',
    date_candidature: '2026-01-15',
    direction_email: 'preserve@example.test',
  }
  const calls: string[] = []
  const read = async (path: string) => {
    calls.push(path)
    const row = path.startsWith(`tables/${tables.people}/`) ? person : record
    return path.includes('?') ? { list: [{ ...row }], pageInfo: { isLastPage: true } } : { ...row }
  }
  const run = () => planGooglePerson(config, headers, cells, '2026-10-01T10:00:00Z', read)
  return { config, headers, cells, person, record, read, run, calls }
}
function planned(outcome: Awaited<ReturnType<typeof planGooglePerson>>) {
  expect(outcome.state).toBe('planned')
  if (outcome.state !== 'planned') throw Error('Expected plan')
  return outcome.plan
}

test('application maps only audited empty fields; identity, cohort and existing workflow are unchanged', async () => {
  const f = await fixture()
  const plan = planned(await f.run())
  expect(plan.table).toBe(tables.records)
  expect(plan.id).toBe(7)
  expect(plan.before).toEqual({ motivation: null })
  expect(plan.after).toEqual({ motivation: 'Accompagner les équipes' })
  expect(plan.remaining).toBe(false)
  expect(plan.linkOnly).toBe(false)
  expect(f.record).toMatchObject({
    statut: 'Inchangé',
    date_candidature: '2026-01-15',
    direction_email: 'preserve@example.test',
  })
  expect(await checkGooglePersonPlan(plan, f.read)).toBe('before')
  // Simulate remote success followed by a lost response, with the frozen plan replayed.
  Object.assign(f.record, plan.after)
  const frozen = JSON.parse(JSON.stringify(plan))
  expect(await checkGooglePersonPlan(frozen, f.read)).toBe('after')
  const replay = planned(await f.run())
  expect(await checkGooglePersonPlan(replay, f.read)).toBe('after')
  expect(frozen).toEqual(plan)
  expect(
    googleReconciliationDetail(
      'source',
      { state: 'complete', code: 'saved' },
      '2026-10-01T12:00:00Z',
      plan,
    ),
  ).toContain('"fields":["motivation"]')
})

test('filled fields including false and zero never change; valid empty fields become partial plan', async () => {
  const f = await fixture(
    'candidature_formateur',
    [
      { field: 'motivation', type: 'text', header: 'Motivation' },
      { field: 'annees_experience', type: 'text', header: 'Expérience' },
      {
        field: 'consentement',
        type: 'consent',
        header: 'Consentement',
        options: [{ source: 'Oui, je confirme', value: true }],
      },
      { field: 'pratique_personnelle', type: 'text', header: 'Pratique' },
    ],
    ['Nouvelle motivation', '10', 'Oui, je confirme', 'Pratique déclarée'],
  )
  f.record.motivation = 'Texte humain'
  f.record.annees_experience = 0
  f.record.consentement = false
  const plan = planned(await f.run())
  expect(plan.after).toEqual({ pratique_personnelle: 'Pratique déclarée' })
  expect(plan.remaining).toBe(true)
  expect(plan.guard.at(-1)?.fields).toEqual({
    motivation: 'Texte humain',
    annees_experience: 0,
    consentement: false,
  })
  f.record.motivation = 'Changement humain concurrent'
  expect(await checkGooglePersonPlan(plan, f.read)).toBe('conflict')
  const conflict = await fixture()
  conflict.record.motivation = 'Autre'
  expect(await conflict.run()).toEqual({ state: 'review', code: 'existing_value_conflict' })
})

test('unknown choice/value/type or dangerous field cannot become a write', async () => {
  for (const key of [
    'statut',
    'date_candidature',
    'email',
    'direction_email',
    'apporteur_email',
    'Id',
    'fusionne_vers',
    'formateurs_id',
    'cohortes_id',
    '__proto__',
    'constructor',
  ]) {
    const f = await fixture()
    f.config.businessFields!.fields = [{ field: key, type: 'text', header: 'Motivation' }]
    await expect(f.run()).rejects.toThrow('person_application_configuration_invalid')
    expect(f.calls).toHaveLength(0)
  }
  for (const mapping of [
    { field: 'motivation', type: 'number', header: 'Motivation' },
    { field: 'motivation', type: 'text', header: 'Motivation', default: 'invented' },
    {
      field: 'accord_principe',
      type: 'choice',
      header: 'Motivation',
      options: [{ source: 'Maybe', value: 'Maybe' }],
    },
  ])
    expect(() =>
      validateApplicationFields('candidature_formateur', {
        version: 1,
        fields: [mapping],
      } as never),
    ).toThrow()
  const f = await fixture(
    'candidature_formateur',
    [
      {
        field: 'accord_principe',
        type: 'choice',
        header: 'Accord',
        options: [{ source: 'Oui', value: 'Oui' }],
      },
    ],
    ['Peut-être'],
  )
  expect(await f.run()).toEqual({ state: 'review', code: 'application_value_invalid' })
})

test('source labels and type mappings are explicit; unrecognised values remain partial', async () => {
  const f = await fixture(
    'candidature_etablissement',
    [
      {
        field: 'accord_direction',
        type: 'choice',
        header: 'Accord',
        options: [{ source: 'Oui, la direction confirme', value: 'Oui' }],
      },
      { field: 'document_lien', type: 'url', header: 'Document' },
      {
        field: 'consentement',
        type: 'consent',
        header: 'Confirmation',
        options: [{ source: 'Je confirme ma demande', value: true }],
      },
    ],
    ['Oui, la direction confirme', 'javascript:alert(1)', 'Je confirme ma demande'],
  )
  const plan = planned(await f.run())
  expect(plan.after).toEqual({ accord_direction: 'Oui', consentement: true })
  expect(plan.remaining).toBe(true)
  expect(
    googleReconciliationDetail(
      'source',
      { state: 'complete', code: 'saved_raw_remaining' },
      '2026-10-01T12:00:00Z',
      plan,
    ),
  ).toContain('"state":"partial"')
})

test('multiselect parses whole labels containing commas and preserves API storage separators', async () => {
  const f = await fixture(
    'candidature_formateur',
    [
      {
        field: 'experience_animation',
        type: 'multiChoice',
        header: 'Expériences',
        separator: ', ',
        options: [
          { source: "Oui, auprès d'adultes", value: "Oui, auprès d'adultes" },
          { source: "Oui, auprès d'élèves", value: "Oui, auprès d'élèves" },
        ],
      },
    ],
    ["Oui, auprès d'adultes, Oui, auprès d'élèves"],
  )
  expect(planned(await f.run()).after).toEqual({
    experience_animation: "Oui, auprès d'adultes · Oui, auprès d'élèves",
  })
  f.cells[f.cells.length - 1] = "Oui, auprès d'adultes, Autre"
  expect((await f.run()).state).toBe('review')
  f.cells[f.cells.length - 1] = "Oui, auprès d'adultes, Oui, auprès d'adultes"
  expect((await f.run()).state).toBe('review')
  const s = await fixture(
    'candidature_etablissement',
    [
      {
        field: 'enjeux',
        type: 'multiChoice',
        header: 'Enjeux',
        separator: ', ',
        options: [
          { source: 'Usages numériques', value: 'Usages numériques' },
          { source: 'Autre', value: 'Autre' },
        ],
      },
    ],
    ['Usages numériques, Autre'],
  )
  expect(planned(await s.run()).after.enjeux).toBe('Usages numériques,Autre')
})

test('J45 receipt date requires opt-in, exact identity and cohort; older and newer dates are preserved', async () => {
  const f = await fixture('suivi_j45', [{ field: 'date_suivi_recu', type: 'submissionDate' }], [])
  const plan = planned(await f.run())
  expect(plan.table).toBe(tables.people)
  expect(plan.after).toEqual({ date_suivi_recu: '2026-10-01' })
  f.person.statut = null
  expect(planned(await f.run()).after).toEqual({ date_suivi_recu: '2026-10-01' })
  expect(f.person.statut).toBeNull()
  for (const existing of ['2026-07-15', '2026-11-01']) {
    f.person.date_suivi_recu = existing
    expect(await f.run()).toEqual({ state: 'review', code: 'existing_value_conflict' })
    expect(f.person.date_suivi_recu).toBe(existing)
  }
  delete f.person.date_suivi_recu
  f.record.cohortes_id = 1
  expect((await f.run()).state).toBe('review')
  f.record.cohortes_id = 2
  f.person.nom = 'Autre'
  expect((await f.run()).state).toBe('review')
  f.person.nom = 'Exemple'
  delete f.config.businessFields
  expect(planned(await f.run())).toMatchObject({ linkOnly: true, after: {}, remaining: true })
  expect(() =>
    validateApplicationFields('candidature_formateur', {
      version: 1,
      fields: [{ field: 'date_suivi_recu', type: 'submissionDate' }],
    }),
  ).toThrow()
})

test('columns must be fully audited, non-overlapping and pinned including duplicate labels', async () => {
  const f = await fixture()
  f.headers.push('Inconnu')
  f.cells.push('Réponse')
  f.config.headerDigest = await digest(JSON.stringify(f.headers))
  expect(await f.run()).toEqual({ state: 'review', code: 'unmapped_fields' })
  f.config.captureOnly.push('Inconnu')
  expect(planned(await f.run()).remaining).toBe(true)
  f.config.captureOnly.push('Motivation')
  await expect(f.run()).rejects.toThrow('sheet_mapping_overlap')
  const g = await fixture()
  g.headers.push('Motivation')
  g.cells.push('Seconde réponse')
  g.config.headerDigest = await digest(JSON.stringify(g.headers))
  await expect(g.run()).rejects.toThrow('sheet_header_ambiguous')
  g.config.businessFields!.fields = [
    {
      field: 'motivation',
      type: 'text',
      header: { label: 'Motivation', occurrence: 2, column: 6 },
    },
  ]
  g.config.captureOnly = [{ label: 'Motivation', occurrence: 1, column: 5 }]
  expect(planned(await g.run()).after.motivation).toBe('Seconde réponse')
  g.headers.reverse()
  expect(await g.run()).toEqual({ state: 'review', code: 'sheet_headers_changed' })
})

test('every allowlisted field maps using its exact storage type and rejects wrong family', async () => {
  for (const family of ['candidature_etablissement', 'candidature_formateur'] as const)
    for (const [field, rule] of Object.entries(APPLICATION_FIELD_RULES[family])) {
      let mapping: ApplicationField, value: string, expected: unknown
      if (rule.type === 'text') {
        mapping = { field, type: 'text', header: 'Question' }
        value = '0012'
        expected = value
      } else if (rule.type === 'url') {
        mapping = { field, type: 'url', header: 'Question' }
        value = 'https://example.test/document'
        expected = value
      } else if (rule.type === 'multiChoice') {
        mapping = {
          field,
          type: 'multiChoice',
          header: 'Question',
          separator: ', ',
          options: [{ source: 'Choix audité', value: rule.values![0] }],
        }
        value = 'Choix audité'
        expected = rule.values![0]
      } else {
        mapping = {
          field,
          type: rule.type as 'choice' | 'consent',
          header: 'Question',
          options: [{ source: 'Choix audité', value: rule.values![0] }],
        }
        value = 'Choix audité'
        expected = rule.values![0]
      }
      const f = await fixture(family, [mapping], [value])
      expect(planned(await f.run()).after[field]).toBe(expected)
    }
  for (const family of ['bilan_etablissement', 'postformation_b', 'evaluation_formation'])
    expect(() =>
      validateApplicationFields(family, {
        version: 1,
        fields: [{ field: 'motivation', type: 'text', header: 'Question' }],
      }),
    ).toThrow()
})

test('blanks, control characters, too-long text and invalid dates are not coerced or truncated', async () => {
  const f = await fixture()
  f.cells[4] = ''
  expect(planned(await f.run()).after).toEqual({})
  for (const value of ['x'.repeat(5001), 'hello\u0000world']) {
    f.cells[4] = value
    expect(await f.run()).toEqual({ state: 'review', code: 'application_value_invalid' })
  }
  const g = await fixture('suivi_j45', [{ field: 'date_suivi_recu', type: 'submissionDate' }], [])
  expect(await planGooglePerson(g.config, g.headers, g.cells, 'not-a-date', g.read)).toEqual({
    state: 'review',
    code: 'date_invalid',
  })
  const local = planned(
    await planGooglePerson(g.config, g.headers, g.cells, '2026-10-01T22:30:00Z', g.read),
  )
  expect(local.after.date_suivi_recu).toBe('2026-10-02')
})

test('allowlist is exactly the application API fields minus workflow, date and email fields', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const [family, file] of [
    ['candidature_etablissement', 'candidature-etablissement'],
    ['candidature_formateur', 'candidature-formateur'],
  ] as const) {
    const source = await readFile(new URL(`../src/pages/api/${file}.ts`, import.meta.url), 'utf8')
    const block = /application:\s*\{([\s\S]*?)\n\s*\},/.exec(source)?.[1]
    expect(block).toBeDefined()
    const keys = [...block!.matchAll(/^\s*(\w+):/gm)]
      .map((match) => match[1])
      .filter(
        (k) => !['statut', 'date_candidature', 'direction_email', 'apporteur_email'].includes(k),
      )
    expect(Object.keys(APPLICATION_FIELD_RULES[family]).sort()).toEqual(keys.sort())
  }
})
