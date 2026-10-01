import type { PersonProjectionConfig } from '../../src/lib/google-form-person'

// Entirely synthetic, shaped like an audited private Google personProjection.
export const preformationPersonConfig: PersonProjectionConfig = {
  family: 'preformation_a',
  headerDigest: '0'.repeat(64),
  mapping: {
    timestamp: 'Horodateur',
    email: 'Email professionnel',
    name: 'Prénom et nom',
    cohort: 'Année',
    establishment: 'École',
  },
  captureOnly: [],
  tables: { people: 'fictionaladults0001', records: 'fictionaldossiers01' },
  createMissingAdults: true,
  cohorts: [
    {
      id: 2,
      answer: '2026-2027',
      establishments: [{ answer: 'École fictive', participationId: 7, schoolId: 9 }],
    },
  ],
}
export const preformationAdult = () => ({
  Id: 50,
  prenom: 'Adulte',
  nom: 'Fictif',
  email: 'adult@example.invalid',
  email_2: null,
  participations_id: 7,
  date_pre_recu: null as string | null,
  statut: 'Inchangé',
})
export const preformationDossier = () => ({
  Id: 7,
  cohortes_id: 2,
  etablissements_id: 9,
  fusionne_vers: null as number | null,
})
