// Synthetic answers only. Deliberately unequal active/control counts.
export const contactV2 = () => ({
  version: 2,
  referrer: { name: 'Référent Exemple', email: 'referrer@example.invalid' },
  schoolDetails: {
    academy: 'Académie fictive',
    address: 'Rue fictive',
    postalCode: '00000',
    type: 'Collège',
  },
  directionEmail: 'direction@example.invalid',
  operations: { groupedSchools: false },
  formation: { format: 'Présentiel' },
  evaluationInterest: { answer: 'Non', level: '' },
  confirmed: true,
})
export const deploymentV2 = () => ({
  version: 2,
  referrer: { name: 'Référent Exemple', email: 'referrer@example.invalid' },
  formation: { format: 'Présentiel', planning: 'Deux sessions à préciser', sessions: 2 },
  declaredTrainers: [{ name: 'Formateur Exemple', email: 'trainer@example.invalid' }],
  preformation: 'Je vais le faire',
  confirmed: true,
  organizationConfirmed: true,
  changesAcknowledged: true,
})
export const youthV2 = () => ({
  version: 2,
  referrer: { name: 'Référent Exemple', email: 'referrer@example.invalid' },
  youth: {
    totalClasses: 3,
    totalStudents: 75,
    levels: 'Cinquième, quatrième',
    evaluation: true,
    activeClasses: '5A ; cinquième ; 24 ; Enseignant Exemple ; atelier',
    controlClasses: '4B ; quatrième ; 29 ; Enseignante Exemple',
    activeCount: 24,
    controlCount: 29,
    activeT1: '2026-10-01',
    activeT2: '2027-01-15',
    controlT1: '2026-10-02',
    workshopCount: 5,
    workshopSchedule: '5A ; dates à préciser ; cinq ateliers',
  },
  confirmed: true,
  organizationConfirmed: true,
  changesAcknowledged: true,
})
