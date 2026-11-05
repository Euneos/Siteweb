// Synthetic records only. Never used by the production page.
export const boardCohorts = [{ Id: 1, annee_debut: 2026, annee_fin: 2027 }, { Id: 2, annee_debut: 2025, annee_fin: 2026 }]
export const boardSchools = [
  { Id: 1, nom: 'Collège Démonstration Toulouse', ville: 'Toulouse', cp: '31000' },
  { Id: 2, nom: 'Lycée Démonstration Rennes', ville: 'Rennes', cp: '35000' },
  { Id: 3, nom: 'École Démonstration Martinique', ville: 'Fort-de-France', cp: '97200' },
  { Id: 4, nom: 'Collège Démonstration à localiser', ville: '', cp: '' },
]
export const boardParticipations = [
  { Id: 1, etablissements_id: 1, cohortes_id: 1, statut: 'Établissement engagé', date_debut_formation: '2026-11-19', statut_formation: 'Planifiée', fiche_contact_recue: true, lettre_interet_signee: true, evaluation_jeunes_demandee: true },
  { Id: 2, etablissements_id: 2, cohortes_id: 1, statut: 'Établissement engagé', date_debut_formation: '2026-10-01', statut_formation: 'En cours', fiche_contact_recue: true, lettre_interet_signee: true },
  { Id: 3, etablissements_id: 3, cohortes_id: 1, statut: 'Établissement engagé', date_debut_formation: '2026-11-20', statut_formation: 'Planifiée', fiche_contact_recue: true, lettre_interet_signee: true },
  { Id: 4, etablissements_id: 4, cohortes_id: 1, statut: 'Établissement engagé', date_debut_formation: '', fiche_contact_recue: true, lettre_interet_signee: false },
  { Id: 5, etablissements_id: 1, cohortes_id: 1, statut: 'Candidature reçue', date_candidature: '2026-09-01' },
  { Id: 6, etablissements_id: 2, cohortes_id: 1, statut: 'Candidature acceptée' },
  { Id: 7, etablissements_id: 3, cohortes_id: 1, statut: 'Refus' },
  { Id: 8, etablissements_id: 4, cohortes_id: 1, statut: 'Abandon' },
  { Id: 9, etablissements_id: 1, cohortes_id: 1, statut: 'Établissement engagé', fusionne_vers: 1 },
  { Id: 10, etablissements_id: 1, cohortes_id: 2, statut: 'Établissement engagé' },
]
export const boardTrainers = [
  { Id: 1, cohortes_id: 1, formateurs_id: 1, accord_signe: true, statut: 'Formateur validé', promotion: 'Septembre 2026' },
  { Id: 2, cohortes_id: 1, formateurs_id: 2, accord_signe: false, statut: 'En cours de formation', promotion: 'Septembre 2026' },
  { Id: 3, cohortes_id: 1, formateurs_id: 1, accord_signe: true, fusionne_vers: 1, statut: 'Formateur validé' },
  { Id: 4, cohortes_id: null, formateurs_id: 3, accord_signe: true, statut: 'Formateur validé', promotion: 'Septembre 2025' },
]
