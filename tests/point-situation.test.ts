import { expect, test } from 'bun:test'
import { pointSituation } from '../src/lib/point-situation'
import type { EtatCandidature } from '../src/lib/etat-candidatures'

const dossier = (changes: Partial<EtatCandidature> = {}) => ({
  statut: 'Candidature reçue', lettreSignee: false, ficheContactRecue: false,
  anomaliesDates: [], provenanceInvalide: false, aVerifier: false,
  formateurs: [], contact: null, dateDebutFormation: null, dateFinFormation: null,
  ...changes,
} as EtatCandidature)

test('les pièces ne remplacent pas la décision humaine', () => {
  const text = pointSituation(dossier({ lettreSignee: true, ficheContactRecue: true }))
  expect(text).toContain('Lettre signée et fiche contact reçues')
  expect(text).toContain('décision de candidature en attente')
  expect(text).not.toContain('engagé')
})
test('une case non cochée reste une réception à confirmer, pas une absence prouvée', () => {
  expect(pointSituation(dossier())).toContain('réception de la fiche contact à confirmer')
  expect(pointSituation(dossier())).not.toContain('non reçue')
})
test('les contradictions de dates restent signalées même avec les pièces reçues', () => {
  expect(pointSituation(dossier({ statut: 'Établissement engagé', lettreSignee: true,
    ficheContactRecue: true, anomaliesDates: ['Fin avant début'] }))).toContain('dates à vérifier')
})
test('abandon et refus ne réclament pas les pièces de candidature', () => {
  expect(pointSituation(dossier({ statut: 'Abandon' }))).toBe('Établissement en abandon ; dossier arrêté.')
  expect(pointSituation(dossier({ statut: 'Refus' }))).toBe('Candidature refusée ; dossier arrêté.')
})
