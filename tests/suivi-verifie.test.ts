import { describe, expect, test } from 'bun:test'
import { lireSuiviVerifie, type SuiviVerifie } from '../src/lib/suivi-verifie'
import { trierProgression, type EtatCandidature } from '../src/lib/etat-candidatures'

describe('suivi opérationnel vérifié', () => {
  const summary: SuiviVerifie = { version: 1, checkedAt: '2026-10-22T12:00:00.000Z', dateDeReference: null,
    qualification: 'non renseignée', referent: 'Référente', situation: 'Janvier, sans jour fixé.',
    organisation: 'Reçu le 10/10/2026', organisationRecue: true, sources: ['Formulaire de déploiement'] }
  const notes = (v: unknown) => `[EUNEOS_SUIVI_VERIFIE_V1]${JSON.stringify(v)}[/EUNEOS_SUIVI_VERIFIE_V1]`
  test('les sources ambigües ou invalides ne sont pas présentées comme vérifiées', () => {
    expect(lireSuiviVerifie(notes(summary))).toEqual(summary)
    expect(lireSuiviVerifie(notes(summary) + notes(summary))).toBeNull()
    expect(lireSuiviVerifie(notes({ ...summary, qualification: 'certaine' }))).toBeNull()
    expect(lireSuiviVerifie(notes({ ...summary, checkedAt: 'hier' }))).toBeNull()
    expect(lireSuiviVerifie(notes({ ...summary, rawMail: 'privé' }))).not.toHaveProperty('rawMail')
  })
  test('les dates priment sur les pièces et les sans-date restent après les débuts à venir', () => {
    const row = (id: number, date: string | null, pieces = false) => ({ id, etablissement: String(id),
      statut: 'Candidature acceptée', dateDebutFormation: date, dateCandidature: '2026-01-01',
      lettreSignee: pieces, ficheContactRecue: pieces } as EtatCandidature)
    const input = [row(1, null, true), row(2, '2026-11-18', true), row(3, '2026-11-02'), row(4, '2026-09-24')]
    expect(trierProgression(input).map(l => l.id)).toEqual([4, 3, 2, 1])
    expect(input.map(l => l.id)).toEqual([1, 2, 3, 4])
  })
})
