import { describe, expect, test } from 'bun:test'
import { resolvePublicDossier } from '../src/lib/public-dossier-match'

const cohorts = [{ Id: 2, active: true, annee_debut: 2026, annee_fin: 2027 }]
const school = { Id: 6, nom: 'CLG CHARLOUN RIEU', ville: 'Saint-Martin de Crau', referent_email: 'referent@example.org' }
const part = { Id: 44, etablissements_id: 6, cohortes_id: 2, fusionne_vers: null, statut: 'Établissement engagé' }
const identity = { schoolName: 'Collège Charloun Rieu', city: 'Saint Martin de Crau', schoolYear: '2026-2027' }
const match = (schools = [school], parts: Record<string, any>[] = [part], input = identity, email = 'referent@example.org') =>
  resolvePublicDossier(schools, parts as any, cohorts, input, email)

describe('public dossier matching', () => {
  test('recognises college/CLG and city punctuation', () => {
    expect(match().target?.participationId).toBe(44)
  })
  test('accepts up to two edits, accents and case; rejects a third edit', () => {
    expect(match(undefined, undefined, { ...identity, schoolName: 'COLLÈGE Charloun Riue' }).target?.participationId).toBe(44)
    expect(match(undefined, undefined, { ...identity, schoolName: 'Collège Charloun XYZ' }).target).toBeNull()
  })
  test('recognises an initial only with an already known contact', () => {
    const schools = [{ ...school, nom: 'Collège Adélaide Hautval', ville: 'Ferrette' }]
    const input = { ...identity, schoolName: 'Collège A Hautval', city: 'Ferrette' }
    expect(match(schools, undefined, input).target?.participationId).toBe(44)
    expect(match(schools, undefined, input, 'unknown@example.org').code).toBe('identity_contact_review')
  })
  test('uses contact already recorded on the annual dossier', () => {
    const schools = [{ ...school, nom: "Lycée Jean d'Ormesson", ville: 'Châteaurenard' }]
    const input = { ...identity, schoolName: 'Lycée Jean d’Ormesson', city: 'Chateaurenard' }
    expect(match(schools, [{ ...part, apporteur_email: 'other@example.org' }], input, ' OTHER@example.org ').target?.participationId).toBe(44)
  })
  test('does not use email alone or choose between plausible dossiers', () => {
    expect(match(undefined, undefined, { ...identity, city: 'Autre ville' }).target).toBeNull()
    expect(match(undefined, [part, { ...part, Id: 45 }]).code).toBe('identity_ambiguous')
    expect(match([school, { ...school, Id: 7, nom: 'Collège Charloun Rie' }], [part, { ...part, Id: 45, etablissements_id: 7 }]).code).toBe('identity_ambiguous')
  })
  test('excludes archives, closed dossiers and other years', () => {
    expect(match(undefined, [part, { ...part, Id: 45, fusionne_vers: 44 }]).target?.participationId).toBe(44)
    for (const change of [{ fusionne_vers: 45 }, { statut: 'Abandon' }, { statut: 'Refus' }, { cohortes_id: 1 }])
      expect(match(undefined, [{ ...part, ...change }]).target).toBeNull()
    expect(match(undefined, undefined, { ...identity, schoolYear: '2025-2026' }).code).toBe('identity_cohort_review')
  })
  test('refuses contradictory email and malformed dossier metadata', () => {
    expect(match([school, { ...school, Id: 7, referent_email: 'other@example.org' }], [{ ...part, apporteur_email: 'other@example.org' }], identity, 'other@example.org').code).toBe('identity_contact_conflict')
    expect(() => match(undefined, [{ ...part, notes: '[EUNEOS_CONTACT_V1]broken' }])).toThrow()
  })
})
