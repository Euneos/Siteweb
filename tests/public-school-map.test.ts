import { test, expect } from 'bun:test'
import { construireReseauEtablissements } from '../src/lib/reseau-etablissements'
import { publicSchoolMap } from '../src/lib/public-school-map'

test('public map includes completed and current training only, combines years and excludes dossier identifiers', () => {
  const cohorts = [{Id:1,nom:'2025–2026'}, {Id:2,nom:'2026–2027'}]
  const schools = [{Id:1,nom:'Établissement test',ville:'Toulouse',cp:'31000'}, {Id:2,nom:'Établissement à programmer',ville:'Paris',cp:'75001'}]
  const rows = [
    {Id:1,code:'DOS-0096',etablissements_id:1,cohortes_id:1,statut_formation:'Terminé'},
    {Id:2,code:'DOS-0097',etablissements_id:1,cohortes_id:2,statut_formation:'En cours'},
    {Id:3,code:'DOS-0098',etablissements_id:2,cohortes_id:2,statut_formation:'À préciser'},
    {Id:4,code:'DOS-0099',etablissements_id:2,cohortes_id:1,statut_formation:'Programmée'},
  ]
  const result = publicSchoolMap(construireReseauEtablissements(cohorts,rows,schools))
  expect(result.locations).toHaveLength(1)
  expect(result.locations[0].formations.map(f=>f.state).sort()).toEqual(['en_cours','terminee'])
  expect(result.periods.map(p=>p.locations.length)).toEqual([1,1])
  expect(JSON.stringify(result)).not.toContain('DOS-')
  expect(JSON.stringify(result)).not.toContain('À programmer')
  expect(JSON.stringify(result)).not.toContain('programmee')
})

test('completed/current schools without a reliable commune remain in the public data', () => {
  const network = construireReseauEtablissements([{Id:1,nom:'2026–2027'}], [
    {Id:1,code:'DOS-0010',etablissements_id:1,cohortes_id:1,statut_formation:'En cours'},
  ], [{Id:1,nom:'Sans repère',ville:'Sainte-Anne',cp:''}])
  const result = publicSchoolMap(network)
  expect(result.locations).toHaveLength(1)
  expect(result.locations[0].location).toBeNull()
  expect(JSON.stringify(result)).not.toContain('DOS-')
})

test('accepted candidacies are displayed as ongoing, without changing completed training or leaking dossier codes', async () => {
  const { buildMapData } = await import('../src/lib/map')
  const cohorts = [{Id:1,nom:'2026–2027'}]
  const schools = [
    {Id:1,nom:'Accepté à programmer',ville:'Toulouse',cp:'31000'},
    {Id:2,nom:'Accepté déjà terminé',ville:'Paris',cp:'75001'},
    {Id:3,nom:'En attente',ville:'Lyon',cp:'69001'},
  ]
  const rows = [
    {Id:1,code:'DOS-0096',etablissements_id:1,cohortes_id:1,statut:'Candidature acceptée',statut_formation:'À préciser'},
    {Id:2,code:'DOS-0097',etablissements_id:2,cohortes_id:1,statut:'Candidature acceptée',statut_formation:'Terminé'},
    {Id:3,code:'DOS-0098',etablissements_id:3,cohortes_id:1,statut:'Candidature reçue',statut_formation:'À préciser'},
  ]
  const original = JSON.stringify(rows)
  const result = publicSchoolMap(construireReseauEtablissements(cohorts,rows,schools), buildMapData(cohorts,rows,schools))
  expect(result.locations).toHaveLength(2)
  expect(result.locations.find(s=>s.name === 'Accepté à programmer')?.formations).toEqual([{year:'2026–2027',state:'en_cours'}])
  expect(result.locations.find(s=>s.name === 'Accepté déjà terminé')?.formations).toEqual([{year:'2026–2027',state:'terminee'}])
  expect(JSON.stringify(result)).not.toContain('DOS-')
  expect(JSON.stringify(rows)).toBe(original)
})

test('engaged establishments remain visible even when their training is still to be scheduled', async () => {
  const { buildMapData } = await import('../src/lib/map')
  const cohorts = [{Id:2,nom:'2026-2027'}]
  const schools = [{Id:29,nom:"Sainte Thérèse de l'Enfant Jésus",ville:'Toulouse',cp:'31500'}]
  const rows = [{Id:94,code:'DOS-0094',etablissements_id:29,cohortes_id:2,statut:'Établissement engagé',statut_formation:'À préciser'}]
  const result = publicSchoolMap(construireReseauEtablissements(cohorts,rows,schools),buildMapData(cohorts,rows,schools))
  expect(result.locations).toHaveLength(1)
  expect(result.locations[0].name).toContain('Sainte Thérèse')
  expect(result.locations[0].formations).toEqual([{year:'2026-2027',state:'engage'}])
  expect(JSON.stringify(result)).not.toContain('DOS-')
  expect(JSON.stringify(result)).not.toContain('a_programmer')
})

test('unvalidated received candidacies stay excluded even if a training field is filled in', async () => {
  const { buildMapData } = await import('../src/lib/map')
  const cohorts = [{Id:1,nom:'2026-2027'}]
  const schools = [{Id:1,nom:'Candidature non validée',ville:'Toulouse',cp:'31000'}]
  const rows = [{Id:1,etablissements_id:1,cohortes_id:1,statut:'Candidature reçue',statut_formation:'En cours'}]
  const result = publicSchoolMap(construireReseauEtablissements(cohorts,rows,schools),buildMapData(cohorts,rows,schools))
  expect(result.locations).toHaveLength(0)
})
