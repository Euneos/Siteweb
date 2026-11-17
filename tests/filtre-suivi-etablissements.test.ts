import { describe, expect, test } from 'bun:test'
import { filtresSuivi, lireVerificationReponses } from '../src/lib/filtre-suivi-etablissements'
import type { EtatCandidature } from '../src/lib/etat-candidatures'

const now = new Date('2026-11-17T12:00:00.000Z')
const ligne = (props: Partial<EtatCandidature> = {}) => ({
  dateDebutFormation: null, dateFinFormation: null, statutFormation: null,
  contact: null, anomaliesDates: [], provenanceInvalide: false, formateurs: [],
  ...props,
}) as EtatCandidature

describe('Filtres opérationnels des établissements', () => {
  test('une date passée ne prouve pas le démarrage', () => {
    expect(filtresSuivi(ligne({ dateDebutFormation: '2026-10-01' }), now)).toEqual(['programmee'])
    expect(filtresSuivi(ligne({ statutFormation: 'En cours' }), now)).toEqual(['en-cours'])
  })
  test('dates du dossier ou du formulaire, y compris une seule date connue', () => {
    expect(filtresSuivi(ligne({ dateFinFormation: '2027-02-01' }), now)).toEqual(['programmee'])
    const contact = { formation: { start: '2026-12-01', end: null } } as EtatCandidature['contact']
    expect(filtresSuivi(ligne({ contact }), now)).toEqual(['programmee'])
  })
  test('une affectation réelle et aucune date pour attendre la programmation', () => {
    const formateurs = [{ id: 1, nom: 'Exemple' }]
    expect(filtresSuivi(ligne({ formateurs }), now)).toEqual(['attente-programmation'])
    expect(filtresSuivi(ligne(), now)).toEqual([])
    expect(filtresSuivi(ligne({ formateurs, dateDebutFormation: 'invalide' }), now)).toEqual([])
  })
  test('ne masque pas les anomalies ni les formations terminées derrière une programmation', () => {
    for (const props of [
      { anomaliesDates: ['Dates contradictoires'] }, { provenanceInvalide: true },
      { statutFormation: 'Terminée' }, { statutFormation: 'Annulée' },
    ]) expect(filtresSuivi(ligne({ dateDebutFormation: '2026-12-01', ...props }), now)).toEqual([])
  })
  test('un mail envoyé ancien ne suffit jamais à justifier une relance', () => {
    expect(filtresSuivi(ligne({ dernierContact: { sentAt: '2026-09-01T10:00:00.000Z' } as EtatCandidature['dernierContact'] }), now)).toEqual([])
  })
  test('absence de retour vérifiée aujourd’hui, strictement plus d’un mois', () => {
    const verificationReponses = { checkedAt: '2026-11-17T11:00:00.000Z', dernierRetourAt: '2026-10-16T10:00:00.000Z' }
    expect(filtresSuivi(ligne({ verificationReponses }), now)).toEqual(['a-relancer'])
    for (const changes of [
      { dernierRetourAt: '2026-10-17T10:00:00.000Z' },
      { checkedAt: '2026-11-16T11:00:00.000Z' },
      { checkedAt: '2026-11-17T13:00:00.000Z' },
    ]) expect(filtresSuivi(ligne({ verificationReponses: { ...verificationReponses, ...changes } }), now)).toEqual([])
    expect(filtresSuivi(ligne({ verificationReponses, contact: { receivedAt: '2026-11-01', formation: { start: null, end: null } } as EtatCandidature['contact'] }), now)).toEqual([])
  })
  test('le mois précédent est borné à son dernier jour', () => {
    const verificationReponses = { checkedAt: '2027-03-31T10:00:00.000Z', dernierRetourAt: '2027-02-28T10:00:00.000Z' }
    expect(filtresSuivi(ligne({ verificationReponses }), new Date('2027-03-31T12:00:00.000Z'))).toEqual([])
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
