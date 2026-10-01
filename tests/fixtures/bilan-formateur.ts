import { accordFixture } from './accord-formateur'
import { bilanQuestions, bilanVersion } from '../../src/lib/bilan-formateur-definition'
import { bilanFields, type BilanConfig } from '../../src/lib/bilan-formateur-plan'
export const bilanTestConfig: BilanConfig = {
  version: 1,
  family: 'bilan_formateur',
  tables: {
    people: 'fictiontrainerstable',
    records: 'fictiondossierstable',
    missions: 'fictionmissionstable',
  },
  cohorts: [
    {
      id: 1,
      answer: '2026-2027',
      establishments: [{ answer: 'École fictive', participationId: 31, schoolId: 41 }],
    },
  ],
  receipt: { field: 'bilan_recu', type: 'Checkbox', value: true },
  fields: Object.entries(bilanFields).map(([source, f]) => ({
    source: source as keyof typeof bilanFields,
    ...f,
  })),
}
export const bilanBody = () => ({
  version: bilanVersion,
  website: '',
  answers: Object.fromEntries(
    bilanQuestions.map((q) => [
      q.key,
      q.key === 'contractReturned'
        ? ['OUI']
        : q.key === 'email'
          ? 'trainer@example.invalid'
          : q.key === 'school'
            ? 'École fictive'
            : q.key === 'year'
              ? '2026-2027'
              : q.key === 'name'
                ? 'Camille Fictif'
                : q.key === 'start'
                  ? '2026-09-01'
                  : q.key === 'end'
                    ? '2026-09-30'
                    : q.key === 'adultCount'
                      ? '12'
                      : q.key === 'invoiceAmount'
                        ? '1000,00'
                        : q.type === 'url'
                          ? 'https://example.invalid/document'
                          : (q.choices[0] ?? 'Réponse fictive'),
    ]),
  ),
})
export function bilanFixture() {
  const fixture = accordFixture()
  fixture.env.BILAN_FORMATEUR_PROJECTION = JSON.stringify(bilanTestConfig)
  const dossier = { Id: 31, etablissements_id: 41, cohortes_id: 1, fusionne_vers: null } as any
  const missions = [
    {
      Id: 51,
      participations_id: 31,
      formateurs_id: 12,
      statut: 'En cours',
      date_debut: null,
      date_fin_reelle: null,
      nb_adultes_formes: null,
      dates_respectees: null,
      difficulte: null,
      bilan_recu: false,
      convention_signee: false,
    },
  ] as any[]
  const orig = fixture.fetch
  const state = {
    ...fixture,
    dossier,
    missions,
    missionLists: 0,
    blockMissionReads: false,
    proof: () =>
      fixture.sql.query('SELECT * FROM public_bilan_formateur_projections LIMIT 1').get() as any,
  }
  state.fetch = async (input: any, init: any) => {
    const url = new URL(String(input)),
      table = url.pathname.split('/')[4],
      id = url.pathname.split('/')[6],
      method = init?.method ?? 'GET'
    if (![bilanTestConfig.tables.records, bilanTestConfig.tables.missions].includes(table))
      return orig(input, init)
    if (url.origin !== 'https://app.nocodb.com') throw new Error('Unexpected network')
    state.calls.push({ table, method, body: init?.body ? JSON.parse(init.body) : null })
    if (state.blockMissionReads) throw new Error('PRIVATE_READ_FAILURE')
    if (table === bilanTestConfig.tables.records) {
      if (method !== 'GET') throw new Error('No dossier mutation')
      return Response.json(state.dossier)
    }
    if (method === 'PATCH') {
      if (state.behavior === 'lost-before') throw new Error('PRIVATE_WRITE_FAILURE')
      for (const patch of JSON.parse(init.body))
        Object.assign(
          state.missions.find((m) => m.Id === patch.Id),
          patch,
        )
      if (state.behavior === 'readback-fails') state.blockMissionReads = true
      if (state.behavior === 'lost-after') throw new Error('PRIVATE_WRITE_FAILURE')
      return Response.json(JSON.parse(init.body))
    }
    if (method !== 'GET') throw new Error('Never create mission')
    if (id) return Response.json(state.missions.find((m) => m.Id === Number(id)) ?? {})
    state.missionLists++
    if (state.behavior === 'concurrent-mission' && state.missionLists === 2)
      state.missions.push({ ...state.missions[0], Id: 52 })
    return Response.json({
      list: state.missions.filter(
        (m) =>
          url.searchParams.get('where') ===
          `(participations_id,eq,${m.participations_id})~and(formateurs_id,eq,${m.formateurs_id})`,
      ),
      pageInfo: { isLastPage: state.behavior !== 'truncated' },
    })
  }
  return state
}
