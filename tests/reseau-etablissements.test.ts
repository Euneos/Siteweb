import { describe, expect, test } from 'bun:test'
import { construireReseauEtablissements, etatFormationCarte } from '../src/lib/reseau-etablissements'

const cohorts = [{ Id: 1, nom: '2025-2026', annee_debut: 2025 }, { Id: 2, nom: '2026-2027', annee_debut: 2026 }]
const schools = [{ Id: 1, nom: 'École test', ville: 'Rennes', cp: '35000', email: 'PRIVATE' }]
const dossier = (Id: number, extra = {}) => ({ Id, code: `DOS-${Id}`, etablissements_id: 1, cohortes_id: 1, statut_formation: 'Terminé', fusionne_vers: null, ...extra })

describe('Carte des établissements formés', () => {
  test('completion and ongoing/programmed states remain distinct without inference from dates', () => {
    const rows = ['Terminé', 'En cours', 'Programmée', 'Prévisionnelle', 'À préciser', '', 'Terminee'].map((s, i) => dossier(i + 1, { statut_formation: s, statut: 'Établissement engagé', date_fin_formation: '2020-01-01', nb_adultes_formes: 12 }))
    const result = construireReseauEtablissements(cohorts, rows, schools)
    expect(result.members).toHaveLength(1)
    expect(result.members[0].etats).toEqual(['terminee', 'en_cours', 'programmee', 'a_programmer'])
    expect(result.members[0].formations).toHaveLength(5)
    expect(result.members[0].id).toBe(1)
    expect(result.members[0].location?.name).toBe('Rennes')
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(construireReseauEtablissements(cohorts, [dossier(1)], schools).members).toHaveLength(1)
  })
  test('Charlotte’s mapping includes blank calendars, À préciser and Prévisionnelle', () => {
    for (const status of ['', 'À préciser', 'Prévisionnelle']) expect(etatFormationCarte(dossier(1, { statut_formation: status }))).toBe('a_programmer')
    expect(etatFormationCarte(dossier(1, { statut_formation: '', date_debut_formation: '2027-01-01' }))).toBeNull()
    expect(etatFormationCarte(dossier(1, { statut_formation: '', date_fin_formation: '2020-01-01' }))).toBeNull()
    for (const statut of ['Refus', 'Abandon']) expect(etatFormationCarte(dossier(1, { statut }))).toBeNull()
    expect(etatFormationCarte(dossier(1, { statut_formation: 'Programmée' }))).toBe('programmee')
  })
  test('one establishment can be trained in two cohorts; duplicates within a cohort are grouped', () => {
    const result = construireReseauEtablissements(cohorts, [dossier(1), dossier(2), dossier(3, { cohortes_id: 2 })], schools)
    expect(result.members).toHaveLength(2)
    expect(result.members[0].dossiers).toEqual(['DOS-1', 'DOS-2'])
    expect(new Set(result.members.map(m => m.annee))).toEqual(new Set(['1', '2']))
  })
  test('archives are reconciled before training status is selected', () => {
    const result = construireReseauEtablissements(cohorts, [dossier(1, { fusionne_vers: 2 }), dossier(2, { statut_formation: 'En cours' })], schools)
    expect(result.members[0].etats).toEqual(['en_cours'])
    expect(result.members[0].dossiers).toEqual(['DOS-2'])
  })
  test('empty cohorts stay selectable; unknown cohorts and ambiguous locations stay unlocated', () => {
    const result = construireReseauEtablissements(cohorts, [dossier(1)], [{ ...schools[0], ville: 'Sainte-Anne', cp: null }])
    expect(result.cohorts).toEqual([{ value: '1', label: '2025-2026' }, { value: '2', label: '2026-2027' }])
    expect(result.members[0].location).toBeNull()
    const unknown = construireReseauEtablissements(cohorts, [dossier(1, { cohortes_id: null })], schools)
    expect(unknown.members[0].location).toBeNull()
    expect(unknown.members[0].issue).toBe('Cohorte à préciser')
  })
})
