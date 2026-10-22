import { expect, test } from 'bun:test'
import { construireSuiviFormateurs, filtrerFormateurs } from '../src/lib/suivi-formateurs'

test('archives excluded, missing identities visible, dates and decisions kept independent', () => {
  const lignes = construireSuiviFormateurs(
    [{ Id: 1, prenom: 'Élodie', nom: 'Exemple', ville: 'Lyon' }],
    [
      {
        Id: 10,
        formateurs_id: 1,
        date_candidature: '2026-09-17',
        statut: 'Candidature recue',
        accord_signe: true,
      },
      { Id: 11, formateurs_id: 1, fusionne_vers: 10 },
      { Id: 12, formateurs_id: 99, date_candidature: '2026-10-22', statut: 'Candidature validée' },
      { Id: 13, formateurs_id: 1, date_candidature: '2026-10-23', statut: 'Candidature recue' },
      { Id: 14, formateurs_id: 1, statut: 'Candidature recue' },
    ],
    new Date('2026-10-22T12:00:00Z'),
  )
  expect(lignes).toHaveLength(4)
  expect(lignes.find((l) => l.id === 10)).toMatchObject({
    ancien: true,
    accord: true,
    statut: 'Candidature recue',
  })
  expect(lignes.find((l) => l.id === 12)).toMatchObject({
    nouveau: true,
    aExaminer: false,
    personneId: undefined,
  })
  expect(lignes.find((l) => l.id === 13)?.nouveau).toBe(false)
  expect(lignes.find((l) => l.id === 14)?.ancien).toBe(false)
  expect(filtrerFormateurs(lignes, 'elodie', '', 'anciens').map((l) => l.id)).toEqual([10])
})
