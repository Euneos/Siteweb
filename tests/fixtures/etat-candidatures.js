// Invented records only, shared by the compiled page regression test.
export const block = (overrides) =>
  `[EUNEOS_CONTACT_V1]\n${JSON.stringify({
    version: 1,
    source: {
      spreadsheetId: 'synthetic-sheet',
      rows: [2],
      readAt: '2026-09-22T12:00:00.123456+00:00',
    },
    receivedAt: '2026-09-21T13:01:00+02:00',
    formation: {
      start: '2026-10-01',
      end: '2027-03-01',
      kind: 'previsionnelle',
      format: 'Présentiel',
      planning: 'Cinq rencontres le jeudi',
      issues: [],
    },
    declaredTrainers: [{ name: 'Dominique Déclaration', email: 'secret@example.test' }],
    participants: { declared: 'Trois adultes', unresolved: ['Mme Exemple'], importedCount: 2 },
    sourceResponses: [{ email: 'secret-source@example.test' }],
    ...overrides,
  })}\n[/EUNEOS_CONTACT_V1]`
export const tables = {
  m5ayop8ul8s040l: [{ Id: 2, nom: '2026–2027', annee_debut: 2026, annee_fin: 2027 }],
  mbunbu0f1zztce4: [
    {
      Id: 1,
      code: 'DEMO-01',
      statut: 'Engage',
      date_candidature: '2026-09-02',
      etablissements_id: 1,
      cohortes_id: 2,
      lettre_interet_signee: true,
      fiche_contact_recue: true,
      date_debut_formation: '2026-10-01',
      date_fin_formation: '2027-03-01',
      statut_formation: 'Prévisionnelle',
      notes: `DO-NOT-EXPOSE-PRIVATE-NOTE\n${block()}`,
    },
    { Id: 2, code: 'DEMO-02', statut: 'Abandonne', etablissements_id: 2, cohortes_id: 2 },
    {
      Id: 3,
      code: 'ARCHIVE-NON-COURANTE',
      statut: 'Refuse',
      etablissements_id: 1,
      cohortes_id: 2,
      fusionne_vers: 1,
    },
    {
      Id: 4,
      code: 'DEMO-04',
      statut: 'Engage',
      etablissements_id: 4,
      cohortes_id: 2,
      statut_formation: 'À préciser',
      notes: block({
        formation: {
          start: '2026-10-08',
          end: '2026-04-08',
          kind: 'previsionnelle',
          format: '',
          planning: '',
          issues: ['Deux dates contradictoires à confirmer'],
        },
      }),
    },
  ],
  mg12klh5zv7b5n5: [
    { Id: 1, nom: 'Collège de démonstration', ville: 'Ville de test' },
    { Id: 2, nom: 'Lycée de démonstration', ville: 'Ville de test' },
    { Id: 4, nom: 'École des dates à confirmer', ville: 'Ville de test' },
  ],
  merrsayuq3xb3uk: [
    { Id: 1, participations_id: 1, formateurs_id: 1, statut: 'Prevue', nb_adultes_formes: 12 },
    { Id: 2, participations_id: 1, formateurs_id: 9, statut: 'Annulée' },
  ],
  mblganql53o34gm: [{ Id: 1, prenom: 'Camille', nom: 'Affectation' }],
  mzbpzuikti6h3pz: [
    {
      Id: 1,
      participations_id: 1,
      prenom: 'Alex',
      nom: 'Exemple',
      fonction: 'Enseignant',
      statut: 'Déclaré — fiche contact',
    },
    {
      Id: 2,
      participations_id: 1,
      prenom: 'Lou',
      nom: '<img src=x onerror="window.injected=true">',
      fonction: 'CPE',
      statut: 'Déclaré — fiche contact',
    },
  ],
}
