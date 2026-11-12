import { expect, test } from 'bun:test'
import { partnershipSummary } from '../src/lib/partnership-summary'
import type { CommunicationRow, CommunicationSheet } from '../src/lib/communication'
const columns = [
  'Nom',
  'Statut',
  'Priorité',
  'Vivier',
  'Nature de la relation à viser',
  'Attribution',
  'Point de vigilance',
]
const sheets: CommunicationSheet[] = [
  'Parrainage',
  'Comité scientifique',
  'Partenaires, pas parrains',
  'TOP 10',
  'Mode d’emploi',
].map((title, i) => ({ id: String(i), title, columns, guide: i === 4 }))
const row = (sheet_id: string, cells: string[], id = 'r'): CommunicationRow => ({
  id,
  sheet_id,
  cells,
  version: 1,
  updated_by: 'test',
  updated_at: '2026-11-12 09:00:00',
})
const catalog = {
  choices: [
    {
      id: 'pool',
      scope: 'partenariats',
      column_name: 'Vivier',
      value: 'Culture',
      role: '',
      version: 1,
      deleted_at: null,
    },
  ],
  aliases: [],
}
test('counts canonical tabs once, applies exact status and priority, includes every active partner in denominator', () => {
  const rows = [
    row('0', ['A', 'Partenariat', 'A', 'Science', '', 'Candice', 'Vérifier le mandat']),
    row('0', ['B', 'En discussion', 'B', 'Culture', '', 'Charlotte', 'Préparer le rendez-vous']),
    row('1', ['C', 'Contacté', 'A', '', '', 'Pauline', 'Confirmer sa disponibilité']),
    row('2', ['D', 'Partenariat', '', '', 'Réseau', '', '']),
    row('2', ['E', 'Refus', '', '', 'Financement', 'Candice', '']),
    row('3', ['A', 'Partenariat', 'A', 'Science', '', 'Candice', '']),
    row('4', ['Guide', 'Partenariat']),
  ]
  const data = partnershipSummary(sheets, rows, catalog)
  expect(data.counters.map((c) => [c.count, c.total])).toEqual([
    [1, 5],
    [0, 5],
    [1, 2],
  ])
  expect(data.priorities.map((g) => g.total)).toEqual([1, 1])
  expect(data.priorities[0].statuses.find((s) => s.label === 'Partenariat')?.count).toBe(1)
  expect(data.pools).toEqual([
    { label: 'Culture', count: 1 },
    { label: 'Science', count: 1 },
  ])
  expect(data.people.map((p) => p.count)).toEqual([2, 1, 1, 1])
  expect(data.relations).toEqual([
    { label: 'Réseau', count: 1 },
    { label: 'Financement', count: 1 },
  ])
  expect(data.ongoing.map((e) => [e.name, e.vigilance])).toEqual([
    ['B', 'Préparer le rendez-vous'],
    ['C', 'Confirmer sa disponibilité'],
  ])
  expect(data.updated).toBe('2026-11-12T09:00:00.000Z')
})
test('shows unrepresented catalog pools and handles missing values and unknown statuses without losing rows', () => {
  const data = partnershipSummary(
    sheets,
    [
      row('0', ['A', 'Contacté', 'A', '', '', '', '']),
      row('0', ['B', 'En discussion', 'A', '', '', 'Candice; Pauline', '']),
    ],
    catalog,
  )
  expect(data.pools).toEqual([{ label: 'Culture', count: 0 }])
  expect(data.missingPool).toBe(1)
  expect(data.people.map((p) => p.count)).toEqual([1, 0, 1, 1])
  expect(data.ongoing).toHaveLength(2)
  expect(partnershipSummary(sheets, [], catalog).counters.map((c) => c.total)).toEqual([5, 5, 0])
  expect(partnershipSummary([], [], catalog).updated).toBeNull()
})

test('uses the name column of the imported partner tabs even when it is not first', () => {
  const imported = {
    ...sheets[2],
    columns: ['Priorité', 'Structure ou personne', 'Statut', 'Point de vigilance', 'Attribution'],
  }
  const data = partnershipSummary(
    [imported],
    [row(imported.id, ['A', 'Association exemple', 'En discussion', 'À relire', 'Candice'])],
    catalog,
  )
  expect(data.ongoing[0].name).toBe('Association exemple')
  expect(data.ongoing[0].vigilance).toBe('À relire')
})
