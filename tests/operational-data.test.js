import { afterEach, expect, test } from 'bun:test'
import { NC } from '../src/lib/nocodb'
import { readContact, writeContact } from '../src/lib/google-form-contact'
import {
  OperationalDataError,
  parseOperationalInput,
  readOperationalContext,
  planOperationalAdults,
  buildOperationalPatch,
  operationalReviewCodes,
} from '../src/lib/operational-data'
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const raw = (extra = {}) => ({
  referrer: { name: ' Camille Exemple ', email: ' CAMILLE@EXAMPLE.INVALID ' },
  formation: {
    start: '2030-10-01',
    end: '2031-01-01',
    format: 'Présentiel',
    planning: '5 séances',
    sessions: 5,
  },
  schoolDetails: {
    academy: 'Académie fictive',
    address: 'Rue fictive',
    postalCode: '00000',
    type: 'Collège',
  },
  directionEmail: 'direction@example.invalid',
  operations: { groupedSchools: false },
  declaredTrainers: [{ name: 'Formatrice Exemple', email: 'trainer@example.invalid' }],
  participants: [],
  confirmed: true,
  ...extra,
})
const person = (extra = {}) => ({
  firstName: 'Alice',
  lastName: 'Exemple',
  email: 'alice@example.invalid',
  role: 'Enseignante',
  ...extra,
})
const snapshot = (extra = {}) => ({
  participation: {
    Id: 7,
    etablissements_id: 1,
    cohortes_id: 2,
    fusionne_vers: null,
    notes: 'Note humaine\n',
    ...extra,
  },
  school: { Id: 1, nom: 'Collège Exemple', ville: 'Ville fictive' },
  cohort: { Id: 2, annee_debut: 2030, annee_fin: 2031, active: true, nom: 'Cohorte 2030–2031' },
})
const provenance = (extra = {}) => ({
  version: 1,
  source: { spreadsheetId: 'fictional', rows: [7, 9], readAt: '2030-09-22T10:00:00.123456Z' },
  receivedAt: '2030-09-10T12:00:00+02:00',
  sourceResponses: [
    { row: 7, value: 'old declaration' },
    { row: 9, value: 'another declaration' },
  ],
  formation: {
    start: '2030-10-01',
    end: '2031-01-01',
    kind: 'previsionnelle',
    format: 'Ancien format',
    planning: 'Ancien planning',
    issues: [],
    validationSource: 'Equipe',
  },
  declaredTrainers: [],
  participants: {
    declared: 'Ancienne liste',
    unresolved: ['Nom incomplet'],
    importedCount: 2,
    identityNotes: ['qualification existante'],
  },
  ...extra,
})
const patch = (
  snap,
  kind = 'contact',
  data = parseOperationalInput(raw(), kind),
  reviewCodes = [],
) =>
  buildOperationalPatch({
    snapshot: snap,
    kind,
    data,
    receipt: 'f'.repeat(64),
    now: '2030-09-23T10:00:00Z',
    adultIds: [10, 11],
    reviewCodes,
  })

test('normalization is stable, strict, and does not trust editable target identity', () => {
  const p = parseOperationalInput(raw(), 'contact')
  expect(p.referrer).toEqual({
    name: 'Camille Exemple',
    email: 'camille@example.invalid',
    phone: '',
    role: '',
  })
  expect(p.schoolDetails.address).toBe('Rue fictive')
  expect(p.operations.groupedSchools).toBe(false)
  expect(parseOperationalInput(p, 'contact')).toEqual(p)
  expect(() => parseOperationalInput(raw({ target: { schoolId: 4 } }), 'contact')).toThrow(
    OperationalDataError,
  )
})
test.each(['2030-02-30', '2030-13-01', '2030-1-01', 'tomorrow', ''])(
  'reject invalid required date %s',
  (d) => {
    expect(() =>
      parseOperationalInput(raw({ formation: { start: d, end: '2031-01-01' } }), 'contact'),
    ).toThrow()
  },
)
test('refuses reversed dates, no date/cohort inference', () => {
  expect(() =>
    parseOperationalInput(
      raw({ formation: { start: '2031-01-01', end: '2030-10-01' } }),
      'contact',
    ),
  ).toThrow(OperationalDataError)
  expect(() =>
    parseOperationalInput(raw({ formation: { end: '2031-01-01' } }), 'deploiement'),
  ).toThrow()
})
test.each([
  { referrer: { name: 'Camille', email: 'bad-email' } },
  { confirmed: false },
  { formation: { start: '2030-10-01', end: '2031-01-01', hours: '16' } },
  { operations: { students: -1 } },
  { operations: { classes: 2.5 } },
  { participants: [person({ lastName: '' })] },
  { participants: [person(), person({ email: 'other@example.invalid' })] },
  { participants: [person(), person({ firstName: 'Bob' })] },
  { referrer: { name: '[EUNEOS_CONTACT_V1]', email: 'c@example.invalid' } },
  { operations: { anonymousCodes: 'x'.repeat(6001) } },
  { schoolDetails: { secret: 'unsupported' } },
  { operations: { t1Control: '2031-01-01', t2Control: '2030-01-01' } },
])('invalid input rejected without echoing PII %#', (override) => {
  try {
    parseOperationalInput(raw(override), 'contact')
    throw new Error('expected rejection')
  } catch (e) {
    expect(e).toBeInstanceOf(OperationalDataError)
    expect(e.status).toBe(400)
    expect(e.message).not.toContain('example.invalid')
  }
})
test('deployment confirmations required, participants-only needs people and forbids formation', () => {
  expect(() => parseOperationalInput(raw(), 'deploiement')).toThrow(OperationalDataError)
  expect(
    parseOperationalInput(
      raw({ organizationConfirmed: true, changesAcknowledged: true }),
      'deploiement',
    ).confirmed,
  ).toBe(true)
  expect(() => parseOperationalInput(raw({ formation: null }), 'participants')).toThrow(
    OperationalDataError,
  )
  expect(
    parseOperationalInput(raw({ formation: null, participants: [person()] }), 'participants')
      .formation,
  ).toBeNull()
})
test('current operational fields retained, school master never changed, site provenance explicit', () => {
  const operations = { groupedSchools: true, associatedSchools: 'Autre école' }
  const data = parseOperationalInput(
    raw({
      operations,
      schoolDetails: {
        academy: 'Académie fictive',
        address: 'Rue fictive',
        postalCode: '00000',
        type: 'Collège',
      },
      directionEmail: 'direction@example.invalid',
      declaredTrainers: [{ name: 'Formatrice déclarée', email: 'trainer@example.invalid' }],
    }),
    'contact',
  )
  const p = patch(snapshot(), 'contact', data)
  const n = readContact(p.notes)
  expect(n.operationalSubmissions[0].data.operations).toEqual(operations)
  expect(n.source).toEqual({
    kind: 'site',
    receipt: 'f'.repeat(64),
    readAt: '2030-09-23T10:00:00Z',
  })
  expect(Object.keys(p).sort()).toEqual(
    [
      'Id',
      'notes',
      'fiche_contact_recue',
      'date_debut_formation',
      'date_fin_formation',
      'statut_formation',
    ].sort(),
  )
  expect(p.notes.startsWith('Note humaine\n')).toBe(true)
})
test('legacy sources, timestamps, extension fields, human prefix/suffix and participant qualification survive', () => {
  const n = provenance(),
    snap = snapshot({ notes: writeContact('Note humaine\n', n) + '\nSuite humaine' })
  const after = patch(snap)
  const parsed = readContact(after.notes)
  expect(parsed.source).toEqual(n.source)
  expect(parsed.receivedAt).toBe(n.receivedAt)
  expect(parsed.sourceResponses).toEqual(n.sourceResponses)
  expect(parsed.formation.validationSource).toBe('Equipe')
  expect(parsed.participants.identityNotes).toEqual(['qualification existante'])
  expect(parsed.participants.unresolved).toEqual(['Nom incomplet'])
  expect(after.notes.endsWith('\nSuite humaine')).toBe(true)
})
test('historical contradictions cannot be erased by fresh link even with corrected dates', () => {
  const n = provenance()
  n.formation.issues = ['Deux réponses contradictoires']
  const s = snapshot({ notes: writeContact('', n) })
  const codes = operationalReviewCodes(s, parseOperationalInput(raw(), 'contact'), 'contact')
  expect(codes).toContain('historical_issues')
  const p = patch(s, 'contact', parseOperationalInput(raw(), 'contact'), codes)
  expect(p).not.toHaveProperty('date_debut_formation')
  expect(p).not.toHaveProperty('statut_formation')
  expect(readContact(p.notes).formation.issues).toContain('Deux réponses contradictoires')
  expect(readContact(p.notes).sourceResponses).toEqual(n.sourceResponses)
})
test('cohort years come from target metadata, out-of-campaign dates require review', () => {
  expect(
    operationalReviewCodes(snapshot(), parseOperationalInput(raw(), 'contact'), 'contact'),
  ).toEqual([])
  expect(
    operationalReviewCodes(
      snapshot(),
      parseOperationalInput(
        raw({ formation: { start: '2029-10-01', end: '2030-01-01', format: 'Présentiel' } }),
        'contact',
      ),
      'contact',
    ),
  ).toContain('dates_outside_cohort')
})
test('programmed formation is not downgraded by contact, deployment/participants never claim contact receipt', () => {
  const n = provenance()
  n.formation.kind = 'deploiement'
  const s = snapshot({
    notes: writeContact('', n),
    statut_formation: 'Programmée',
    date_debut_formation: '2030-10-01',
    date_fin_formation: '2031-01-01',
  })
  const p = patch(s)
  expect(p.statut_formation).toBe('Programmée')
  expect(readContact(p.notes).formation.kind).toBe('deploiement')
  const dep = patch(
    snapshot(),
    'deploiement',
    parseOperationalInput(
      raw({ organizationConfirmed: true, changesAcknowledged: true }),
      'deploiement',
    ),
  )
  expect(dep).not.toHaveProperty('fiche_contact_recue')
  expect(readContact(dep.notes).receivedAt).toBeNull()
  const participants = patch(
    snapshot(),
    'participants',
    parseOperationalInput(raw({ formation: null, participants: [person()] }), 'participants'),
  )
  expect(Object.keys(participants).sort()).toEqual(['Id', 'notes'])
  expect(readContact(participants.notes).receivedAt).toBeNull()
})
test.each(['homonym', 'same email different name', 'same name different email'])(
  'adult ambiguity %s fails closed',
  (type) => {
    let rows = [{ Id: 1, prenom: 'Alice', nom: 'Exemple', email: 'alice@example.invalid' }]
    if (type === 'homonym') rows.push({ ...rows[0], Id: 2 })
    if (type === 'same email different name') rows[0].prenom = 'Autre'
    if (type === 'same name different email') rows[0].email = 'autre@example.invalid'
    expect(() => planOperationalAdults([person()], rows)).toThrow(OperationalDataError)
  },
)
test('exact existing adult is a no-op; no fuzzy matching or status promotion', () => {
  const rows = [
    { Id: 10, prenom: 'Alice', nom: 'Exemple', email: 'ALICE@EXAMPLE.INVALID', statut: 'Prévu' },
  ]
  expect(planOperationalAdults([person()], rows)).toEqual({ existingIds: [10], create: [] })
  expect(rows[0].statut).toBe('Prévu')
})
test.each([
  'merged',
  'cohort mismatch',
  'school mismatch',
  'abandoned',
  'cancelled',
  'inactive cohort',
  'missing cohort years',
])('context refuses %s', async (condition) => {
  const s = snapshot()
  if (condition === 'merged') s.participation.fusionne_vers = 9
  if (condition === 'cohort mismatch') s.participation.cohortes_id = 3
  if (condition === 'school mismatch') s.participation.etablissements_id = 3
  if (condition === 'abandoned') s.participation.statut = ' Abandonné '
  if (condition === 'cancelled') s.participation.statut = 'Annulée'
  if (condition === 'inactive cohort') s.cohort.active = false
  if (condition === 'missing cohort years') delete s.cohort.annee_debut
  globalThis.fetch = async (url) =>
    Response.json(
      String(url).includes(NC.tables.participations)
        ? s.participation
        : String(url).includes(NC.tables.etablissements)
          ? s.school
          : s.cohort,
    )
  await expect(
    readOperationalContext('fake', { participationId: 7, schoolId: 1, cohortId: 2 }),
  ).rejects.toThrow(OperationalDataError)
})
test('context accepts explicit normalized cohort years without hardcoded campaign', async () => {
  const s = snapshot()
  s.cohort.annee_debut = '2030'
  s.cohort.annee_fin = '2031.0'
  globalThis.fetch = async (url) =>
    Response.json(
      String(url).includes(NC.tables.participations)
        ? s.participation
        : String(url).includes(NC.tables.etablissements)
          ? s.school
          : s.cohort,
    )
  expect(
    await readOperationalContext('fake', { participationId: 7, schoolId: 1, cohortId: 2 }),
  ).toEqual({
    schoolName: 'Collège Exemple',
    city: 'Ville fictive',
    cohortLabel: 'Cohorte 2030–2031',
  })
})

test('live form contract: contact requires current school/contact fields and rejects removed evaluation fields', () => {
  for (const change of [
    { schoolDetails: {} },
    { directionEmail: '' },
    { operations: {} },
    { formation: { start: '2030-10-01', end: '2031-01-01', format: 'Distanciel' } },
    { operations: { groupedSchools: false, students: 5 } },
    { formation: { start: '2030-10-01', end: '2031-01-01', format: 'Présentiel', hours: 16 } },
  ])
    expect(() => parseOperationalInput(raw(change), 'contact')).toThrow(OperationalDataError)
})
test('deployment dates are optional as a pair; format, sessions, planning and trainer required', () => {
  const deploy = {
    referrer: { name: 'Camille', email: 'camille@example.invalid' },
    formation: { start: '', end: '', format: 'Présentiel', sessions: 5, planning: '5 séances' },
    declaredTrainers: [{ name: 'Formatrice Exemple', email: 'trainer@example.invalid' }],
    confirmed: true,
    organizationConfirmed: true,
    changesAcknowledged: true,
  }
  const parsed = parseOperationalInput(deploy, 'deploiement')
  expect(parsed.formation.start).toBe('')
  expect(parsed.formation.end).toBe('')
  for (const change of [
    { formation: { ...deploy.formation, start: '2030-10-01' } },
    { formation: { ...deploy.formation, sessions: 0 } },
    { formation: { ...deploy.formation, planning: '' } },
    { declaredTrainers: [] },
    { declaredTrainers: [{ name: 'Sans adresse' }] },
  ])
    expect(() => parseOperationalInput({ ...deploy, ...change }, 'deploiement')).toThrow(
      OperationalDataError,
    )
  const p = patch(snapshot(), 'deploiement', parsed)
  expect(p).not.toHaveProperty('date_debut_formation')
  expect(p).not.toHaveProperty('date_fin_formation')
  expect(p.statut_formation).toBe('À préciser')
  expect(readContact(p.notes).formation.kind).toBe('deploiement')
  expect(
    patch(snapshot({ statut_formation: 'Programmée' }), 'deploiement', parsed),
  ).not.toHaveProperty('statut_formation')
})
