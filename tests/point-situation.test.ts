import { expect, test } from 'bun:test'
import { pointSituation, lireSituationVerifiee } from '../src/lib/point-situation'
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

const reviewed = {
  version: 1 as const, text: 'Retour demandé sur la participation et le calendrier.',
  checkedAt: '2026-10-16T15:00:00.000Z', sourceAt: '2026-10-16T14:00:00.000Z',
  sourceKind: 'mail-envoye' as const, sourceMessageIds: ['<verified@example.test>'],
}
const note = (value: unknown) => `[EUNEOS_SITUATION_V1]\n${JSON.stringify(value)}\n[/EUNEOS_SITUATION_V1]`
test('un résumé sourcé prime, sans changer les pièces ou un abandon', () => {
  const source = lireSituationVerifiee(note(reviewed))!
  expect(pointSituation(dossier({ situationVerifiee: source }))).toBe(reviewed.text)
  expect(pointSituation(dossier({ situationVerifiee: source, statut: 'Abandon' }))).toContain('abandon')
})
test('un brouillon ou une note ambiguë ne vaut pas point envoyé', () => {
  expect(lireSituationVerifiee(note({ ...reviewed, sourceKind: 'brouillon' }))).toBeNull()
  expect(lireSituationVerifiee(note(reviewed) + note(reviewed))).toBeNull()
})
test('un mail plus récent empêche de présenter un ancien résumé comme actuel', () => {
  const last = { status: 'found', sentAt: '2026-10-16T14:30:00.000Z' } as EtatCandidature['dernierContact']
  expect(pointSituation(dossier({ situationVerifiee: reviewed, dernierContact: last }))).not.toBe(reviewed.text)
})
