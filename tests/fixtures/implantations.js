// Synthetic test records only. Town names are public geographic reference data.
export const cohorts = [
  { Id: 1, nom: '2025–2026', annee_debut: 2025, annee_fin: 2026, active: false },
  { Id: 2, nom: '2026–2027', annee_debut: 2026, annee_fin: 2027, active: true },
]
export const establishments = [
  ['Paris', '75001'],
  ['Lyon', '69001'],
  ['Bordeaux', '33000'],
  ['Ajaccio', '20000'],
  ['Les Abymes', '97139'],
  ['Fort-de-France', '97200'],
  ['Cayenne', '97300'],
  ['Saint-Denis', '97400'],
  ['Mamoudzou', '97600'],
  ['', '38000'],
  ['Paris', '69001'],
  ['Orléans', '45000'],
].map(([ville, cp], i) => ({
  Id: i + 1,
  nom: `Établissement de démonstration ${String(i + 1).padStart(2, '0')}`,
  type_etab: i % 2 ? 'Lycée' : 'Collège',
  ville,
  cp,
}))
export const participations = [
  { Id: 1, etablissements_id: 1, cohortes_id: 2, statut: 'Engage' },
  { Id: 2, etablissements_id: 1, cohortes_id: 2, statut: 'Abandonne' },
  { Id: 3, etablissements_id: 1, cohortes_id: 1, statut: 'Engage' },
  ...Array.from({ length: 10 }, (_, i) => ({
    Id: i + 4,
    etablissements_id: i + 2,
    cohortes_id: 2,
    statut: i === 0 ? 'Candidature acceptée' : i === 7 ? 'Abandonne' : 'Engage',
  })),
  { Id: 14, etablissements_id: 12, cohortes_id: null, statut: 'Engage' },
  { Id: 15, etablissements_id: 12, cohortes_id: null, statut: 'Engage' },
  { Id: 16, etablissements_id: 999, cohortes_id: 2, statut: 'Engage' },
  { Id: 17, etablissements_id: null, cohortes_id: 2, statut: 'Engage' },
].map((p) => ({ ...p, code: `DEMO-${String(p.Id).padStart(2, '0')}` }))
