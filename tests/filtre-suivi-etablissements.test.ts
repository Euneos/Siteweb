import { describe, expect, test } from 'bun:test'
import { filtresSuivi, lireVerificationReponses } from '../src/lib/filtre-suivi-etablissements'
import type { EtatCandidature } from '../src/lib/etat-candidatures'

const ligne = (props: Partial<EtatCandidature> = {}) => ({
  dateDebutFormation: null, dateFinFormation: null, statutFormation: null,
  contact: null, anomaliesDates: [], provenanceInvalide: false, formateurs: [],
  ...props,
}) as EtatCandidature

describe('Filtres opérationnels des établissements', () => {
  test('une date passée ne prouve pas le démarrage', () => {
    expect(filtresSuivi(ligne({ dateDebutFormation: '2026-10-01' }))).toEqual(['programmee'])
    expect(filtresSuivi(ligne({ statutFormation: 'En cours' }))).toEqual(['en-cours'])
  })
  test('dates du dossier ou du formulaire, y compris une seule date connue', () => {
    expect(filtresSuivi(ligne({ dateFinFormation: '2027-02-01' }))).toEqual(['programmee'])
    const contact = { formation: { start: '2026-12-01', end: null } } as EtatCandidature['contact']
    expect(filtresSuivi(ligne({ contact }))).toEqual(['programmee'])
  })
  test('une affectation réelle et aucune date pour attendre la programmation', () => {
    const formateurs = [{ id: 1, nom: 'Exemple' }]
    expect(filtresSuivi(ligne({ formateurs }))).toEqual(['attente-programmation'])
    expect(filtresSuivi(ligne())).toEqual(['autres'])
    expect(filtresSuivi(ligne({ formateurs, dateDebutFormation: 'invalide' }))).toEqual(['autres'])
  })
  test('ne masque pas les anomalies ni les formations terminées derrière une programmation', () => {
    for (const props of [
      { anomaliesDates: ['Dates contradictoires'] }, { provenanceInvalide: true },
      { statutFormation: 'Terminée' }, { statutFormation: 'Annulée' },
    ]) expect(filtresSuivi(ligne({ dateDebutFormation: '2026-12-01', ...props }))).toEqual(['autres'])
  })
  test('un mail envoyé ancien ne change pas le classement complémentaire', () => {
    expect(filtresSuivi(ligne({ dernierContact: { sentAt: '2026-09-01T10:00:00.000Z' } as EtatCandidature['dernierContact'] }))).toEqual(['autres'])
  })
  test('la preuve de réponse ne conditionne plus le quatrième filtre ni ne crée de doublon', () => {
    const verificationReponses = { checkedAt: '2026-11-17T11:00:00.000Z', dernierRetourAt: '2026-10-16T10:00:00.000Z' }
    expect(filtresSuivi(ligne({ verificationReponses }))).toEqual(['autres'])
    for (const changes of [
      { dernierRetourAt: '2026-10-17T10:00:00.000Z' },
      { checkedAt: '2026-11-16T11:00:00.000Z' },
      { checkedAt: '2026-11-17T13:00:00.000Z' },
    ]) expect(filtresSuivi(ligne({ verificationReponses: { ...verificationReponses, ...changes } }))).toEqual(['autres'])
    expect(filtresSuivi(ligne({ verificationReponses, statutFormation: 'En cours' }))).toEqual(['en-cours'])
    expect(filtresSuivi(ligne({ verificationReponses, dateDebutFormation: '2026-12-01' }))).toEqual(['programmee'])
    expect(filtresSuivi(ligne({ verificationReponses, formateurs: [{ id: 1, nom: 'Exemple' }] }))).toEqual(['attente-programmation'])
  })
  test('les quatre filtres couvrent tous les dossiers sans chevauchement', () => {
    const premiers = ['en-cours', 'programmee', 'attente-programmation']
    for (const statutFormation of [null, 'En cours', 'Prévisionnelle', 'Terminée', 'Annulée']) {
      for (const dateDebutFormation of [null, '2026-12-01', 'invalide']) {
        for (const provenanceInvalide of [false, true]) {
          for (const anomaliesDates of [[], ['Dates contradictoires']]) {
            for (const formateurs of [[], [{ id: 1, nom: 'Exemple' }]]) {
              const categories = filtresSuivi(ligne({ statutFormation, dateDebutFormation, provenanceInvalide, anomaliesDates, formateurs }))
              expect(categories).toHaveLength(1)
              expect(categories.includes('autres')).toBe(!categories.some(c => premiers.includes(c)))
            }
          }
        }
      }
    }
  })
  test('projection des preuves stricte, sans corps de mail', () => {
    const value = { version: 1, checkedAt: '2026-11-17T11:00:00.000Z', dernierRetourAt: '2026-10-16T10:00:00.000Z', body: 'privé' }
    const encode = (v: unknown) => `[EUNEOS_REPONSES_VERIFIEES_V1]${JSON.stringify(v)}[/EUNEOS_REPONSES_VERIFIEES_V1]`
    expect(lireVerificationReponses(encode(value))).toEqual({ checkedAt: value.checkedAt, dernierRetourAt: value.dernierRetourAt })
    expect(lireVerificationReponses(encode(value) + encode(value))).toBeNull()
    expect(lireVerificationReponses(encode({ ...value, dernierRetourAt: '2026-12-01T10:00:00.000Z' }))).toBeNull()
    expect(lireVerificationReponses(null)).toBeNull()
  })
})
