import { expect, test } from 'bun:test'
import {
  STATUTS_CANDIDATURE,
  candidatureArretee,
  estCodeStatutCandidature,
  justificatifsEngagementPresents,
  statutCandidature,
} from '../src/lib/statut-candidature'

test('les cinq choix futurs gardent les codes NocoDB existants', () => {
  expect(STATUTS_CANDIDATURE.map((s) => s.code)).toEqual([
    'Candidature recue',
    'Candidature acceptée',
    'Engage',
    'Abandonne',
    'Refuse',
  ])
  expect(STATUTS_CANDIDATURE.map((s) => s.label)).toEqual([
    'Candidature reçue',
    'Candidature acceptée',
    'Établissement engagé',
    'Abandon',
    'Refus',
  ])
  for (const { code, label } of STATUTS_CANDIDATURE) {
    expect(estCodeStatutCandidature(code)).toBe(true)
    expect(statutCandidature(code)).toEqual({ code, label })
    expect(statutCandidature(label)).toEqual({ code, label })
  }
})

test.each(['En cours d’analyse', "En cours d'analyse", ' Candidature reçue '])(
  '%s s’affiche sous Reçue sans devenir un nouveau choix stocké',
  (source) => {
    expect(statutCandidature(source)).toEqual({
      code: 'Candidature recue',
      label: 'Candidature reçue',
    })
    expect(estCodeStatutCandidature(source)).toBe(false)
  },
)

test.each(['Retenu', 'Accuse reception', 'Invite', 'En discussion', 'Valide', 'Inconnu'])(
  '%s reste historique à qualifier, jamais accepté implicitement',
  (source) => {
    expect(statutCandidature(source)).toEqual({
      code: null,
      label: `${source} — historique à qualifier`,
    })
    expect(estCodeStatutCandidature(source)).toBe(false)
  },
)

test.each([null, undefined, ''])('statut absent %s : aucune décision inventée', (source) => {
  expect(statutCandidature(source)).toEqual({ code: null, label: 'Non renseigné' })
})

test('même libellé dans les cohortes et archives, aucune réécriture ni promotion par les pièces', () => {
  const rows = [
    { Id: 1, cohortes_id: 1, fusionne_vers: null, statut: 'Engage' },
    {
      Id: 2,
      cohortes_id: 2,
      fusionne_vers: null,
      statut: 'Candidature acceptée',
      fiche_contact_recue: true,
      lettre_interet_signee: true,
    },
    { Id: 3, cohortes_id: 2, fusionne_vers: 2, statut: 'En cours d’analyse' },
    { Id: 4, cohortes_id: 1, fusionne_vers: null, statut: 'Retenu' },
  ]
  const before = structuredClone(rows)
  expect(rows.map((row) => statutCandidature(row.statut).label)).toEqual([
    'Établissement engagé',
    'Candidature acceptée',
    'Candidature reçue',
    'Retenu — historique à qualifier',
  ])
  expect(rows).toEqual(before)
})

test.each(['Abandonne', 'Abandonné', 'Abandon', 'Refuse', 'Refusé', 'Refus'])(
  '%s est arrêté pour la présentation et les filtres',
  (source) => {
    expect(candidatureArretee(source)).toBe(true)
  },
)

test('Engagé exige deux cases vraies sans coercition de chaînes', () => {
  for (const contact of [true, 1])
    for (const lettre of [true, 1]) {
      expect(
        justificatifsEngagementPresents({
          fiche_contact_recue: contact,
          lettre_interet_signee: lettre,
        }),
      ).toBe(true)
    }
  for (const missing of [false, 0, undefined, null, 'true', 'false', '1']) {
    expect(
      justificatifsEngagementPresents({
        fiche_contact_recue: missing,
        lettre_interet_signee: true,
      }),
    ).toBe(false)
    expect(
      justificatifsEngagementPresents({
        fiche_contact_recue: true,
        lettre_interet_signee: missing,
      }),
    ).toBe(false)
  }
})
