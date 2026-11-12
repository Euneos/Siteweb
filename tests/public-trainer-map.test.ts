import { test, expect } from 'bun:test'
import { construireReseauFormateurs } from '../src/lib/reseau-formateurs'
import { publicTrainerMap } from '../src/lib/public-trainer-map'

test('public network keeps all validated people including missing communes, with no personal identifiers', () => {
  const network = construireReseauFormateurs([
    {Id:1,prenom:'Prénom privé',nom:'Nom privé',ville:'Toulouse',cp:''},
    {Id:2,nom:'Autre privé',ville:'Ville inconnue',cp:''},
    {Id:3,nom:'Candidat',ville:'Paris',cp:'75001'},
  ], [
    {Id:10,formateurs_id:1,statut:'Formateur validé'},
    {Id:11,formateurs_id:1,statut:'Formateur validé',cohortes_id:2},
    {Id:12,formateurs_id:2,statut:'Formateur validé'},
    {Id:13,formateurs_id:3,statut:'En cours de formation'},
  ])
  const result = publicTrainerMap(network)
  expect(result).toHaveLength(2)
  expect(result.filter(x=>!x.location)).toHaveLength(1)
  expect(JSON.stringify(result)).not.toContain('privé')
  expect(result.every(x=>!('id' in x))).toBe(true)
})

test('public map adds trainees once, while the resource directory remains validated-only', async () => {
  const { construireCartePubliqueFormateurs } = await import('../src/lib/reseau-formateurs')
  const people = [{Id:1,nom:'Formé',ville:'Toulouse',cp:'31000'},{Id:2,nom:'En formation',ville:'Paris',cp:'75001'},{Id:3,nom:'Candidat',ville:'Metz',cp:'57000'}]
  const paths = [{Id:1,formateurs_id:1,statut:'Formateur validé'},{Id:2,formateurs_id:1,statut:'En cours de formation',cohortes_id:2},{Id:3,formateurs_id:2,statut:'En cours de formation'},{Id:4,formateurs_id:3,statut:'Candidature acceptée'}]
  expect(construireReseauFormateurs(people,paths).members).toHaveLength(1)
  const publicMap = publicTrainerMap(construireCartePubliqueFormateurs(people,paths))
  expect(publicMap).toHaveLength(2)
  expect(publicMap.filter(p=>p.trainingState==='en_formation')).toHaveLength(1)
  expect(publicMap.find(p=>p.trainingState==='valide')?.name).toBe('Formateur')
  expect(JSON.stringify(publicMap)).not.toContain('validé')
})
