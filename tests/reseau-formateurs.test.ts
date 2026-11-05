import { describe, expect, test } from 'bun:test'
import { construireReseauFormateurs, lireLocalisationsConfirmees, localiserFormateur } from '../src/lib/reseau-formateurs'
import { networkMarkers } from '../src/lib/network-map-markers'

const person = (Id = 1, extra = {}) => ({ Id, prenom: 'Prénom fictif', nom: 'Test', ville: 'Rennes', cp: '35000', email: 'private@example.test', telephone: 'NE PAS DIFFUSER', ...extra })
const path = (Id = 1, extra = {}) => ({ Id, formateurs_id: 1, cohortes_id: null, fusionne_vers: null, promotion: 'Avril 2026', statut: 'Formateur validé', ...extra })

describe('Carte du réseau formateurs', () => {
  test('distinguishes validation from participation, includes every year without agreements or candidacy deductions', () => {
    const people = Array.from({ length: 9 }, (_, i) => person(i + 1))
    const statuses = ['Formateur validé', 'Formateur validé', 'En cours de formation', 'Formateur en cours de validation', 'Candidature validée', 'En attente confirmation formation', 'Refuse', 'Abandonne', '__proto__']
    const paths = statuses.map((statut, i) => path(i + 1, { formateurs_id: i + 1, statut, accord_signe: true, promotion: i ? 'Septembre 2026' : 'Septembre 2025' }))
    const data = construireReseauFormateurs(people, paths)
    expect(data.members.map(m => m.etat)).toEqual(['valide', 'valide'])
    expect(data.members.every(m => !('annee' in m) && !('promotion' in m))).toBe(true)
    expect(data.members.map(m => m.id)).toEqual([1, 2])
    expect(data.members.every(m => m.statut === 'Formateur validé')).toBe(true)
    expect(JSON.stringify(data)).not.toContain('private@example.test')
    expect(JSON.stringify(data)).not.toContain('NE PAS DIFFUSER')
    expect(data.members[0].location?.territory).toBe('metropole')
  })
  test('excludes archived paths only after checking their identities and targets', () => {
    const data = construireReseauFormateurs([person()], [path(), path(2, { fusionne_vers: 1 })])
    expect(data.members.length).toBe(1)
    expect(() => construireReseauFormateurs([person()], [path(2, { fusionne_vers: 99 })])).toThrow()
    expect(() => construireReseauFormateurs([person()], [path(), path(2, { fusionne_vers: 1, formateurs_id: 2 })])).toThrow()
  })
  test('counts a validated person once, across years and repeat training', () => {
    expect(construireReseauFormateurs([person()], [path(), path(2, { promotion: 'Septembre 2025' })]).members).toHaveLength(1)
    expect(construireReseauFormateurs([person()], [path(), path(2, { statut: 'En cours de formation' })]).members).toHaveLength(1)
    expect(() => construireReseauFormateurs([], [path()])).toThrow()
    expect(() => construireReseauFormateurs([person()], [path(), path(2)], { '1': { commune: '31555' }, '2': { commune: '35238' } })).toThrow()
  })
  test('locates exact cities only, preserves ambiguous/inconsistent places in list', () => {
    expect(localiserFormateur('Rennes', null).location?.name).toBe('Rennes')
    expect(localiserFormateur('Estaing', null).location).toBeNull()
    expect(localiserFormateur('Monts', null).location).toBeNull()
    expect(localiserFormateur('Anvers', null).location).toBeNull()
    expect(localiserFormateur('Rennes', '75001').location).toBeNull()
    expect(localiserFormateur('Foix', '9000').location?.name).toBe('Foix')
    expect(localiserFormateur('Paris', '75000').location?.name).toBe('Paris')
    expect(construireReseauFormateurs([person()], [path(1, { promotion: null })]).members[0].location?.name).toBe('Rennes')
  })
  test('residence correction overrides a training-place error without exposing it or changing the source', () => {
    const people = [person(1, { ville: 'Draguignan', cp: '83300' })]
    const before = JSON.stringify(people)
    const member = construireReseauFormateurs(people, [path()], { '1': { commune: '31555' } }).members[0]
    expect(member.localisation).toBe('Toulouse')
    expect(member.location?.name).toBe('Toulouse')
    expect(JSON.stringify(member)).not.toContain('Draguignan')
    expect(JSON.stringify(people)).toBe(before)
  })
  test('person-level residence applies across validated paths without replacing legacy configuration', () => {
    const people = [person(1, { ville: 'Draguignan', cp: '83300' })]
    const paths = [path(10), path(11)]
    const config = { '10': { commune: '35238' }, '11': { commune: '31555' } }
    const before = JSON.stringify(config)
    const result = construireReseauFormateurs(people, paths, config, { '1': { commune: '31555' } })
    expect(result.members).toHaveLength(1)
    expect(result.members[0].location?.name).toBe('Toulouse')
    expect(JSON.stringify(config)).toBe(before)
  })
  test('confirmed private overrides do not change the stored source rows', () => {
    const people = [person(1, { ville: 'Monts', cp: null })]
    const paths = [path()]
    const before = JSON.stringify({ people, paths })
    const config = lireLocalisationsConfirmees('{"1":{"commune":"37159"}}')
    const member = construireReseauFormateurs(people, paths, config).members[0]
    expect(member.location?.name).toBe('Monts')
    expect(member.location?.territory).toBe('metropole')
    expect(JSON.stringify({ people, paths })).toBe(before)
  })
  test('territory-level and foreign locations are explicitly labelled, never fabricated as cities', () => {
    const broad = construireReseauFormateurs([person()], [path()], { '1': { territory: '971' } }).members[0]
    expect(broad.location?.code).toBe('territory:971')
    expect(broad.localisation).toContain('commune non précisée')
    const outside = construireReseauFormateurs([person()], [path()], { '1': { outside: 'Ville étrangère, Belgique' } }).members[0]
    expect(outside.location).toBeNull()
    expect(outside.issue).toContain('Hors de France')
  })
  test('rejects invalid overrides rather than returning an incomplete roster', () => {
    for (const raw of ['[]', 'null', '{"1":{"commune":"FAUX"}}', '{"1":{"territory":"FAUX"}}', '{"1":{"place":"FAUX"}}', '{"1":{"commune":"37159","outside":"x"}}', '{"nom":{"outside":"x"}}']) {
      expect(() => lireLocalisationsConfirmees(raw)).toThrow()
    }
  })
  test('confirmed Antwerp appears in Belgium without altering the France-only map or source records', () => {
    const people = [person(1, { ville: 'Anvers', cp: null })]
    const paths = [path(1, { statut: 'Formateur validé', promotion: 'Septembre 2026' })]
    const before = JSON.stringify({ people, paths })
    const config = lireLocalisationsConfirmees('{"1":{"place":"BE-11002"}}')
    const member = construireReseauFormateurs(people, paths, config).members[0]
    expect(member.location?.territory).toBe('BE')
    expect(member.location?.name).toBe('Anvers')
    expect(member.localisation).toBe('Anvers, Belgique')
    expect(member.etat).toBe('valide')
    expect(member.issue).toBeNull()
    expect(member.location!.x).toBeGreaterThan(180)
    expect(member.location!.x).toBeLessThan(820)
    expect(member.location!.y).toBeGreaterThan(20)
    expect(member.location!.y).toBeLessThan(620)
    expect(JSON.stringify({ people, paths })).toBe(before)
    expect(localiserFormateur('Anvers', null).location).toBeNull()
  })
  test('a confirmed location never makes an unvalidated person appear in the directory', () => {
    const people = [person(1, { ville: 'Anvers', cp: null })]
    const paths = [path(1, { statut: 'En cours de formation', promotion: 'Septembre 2026' })]
    expect(construireReseauFormateurs(people, paths, { '1': { place: 'BE-11002' } }).members).toEqual([])
    expect(paths[0].statut).toBe('En cours de formation')
  })
  test('groups nearby centres for touch targets without losing a person or mixing territories', () => {
    const people = [person(1, { ville: 'Paris', cp: '75001' }), person(2, { ville: 'Orsay', cp: '91400' }), person(3, { ville: 'Rennes', cp: '35000' })]
    const paths = people.map(p => path(p.Id, { formateurs_id: p.Id }))
    const members = construireReseauFormateurs(people, paths).members
    const markers = networkMarkers(members, 350, 328)
    expect(markers.length).toBe(2)
    expect(markers.flatMap(m => m.members).length).toBe(3)
    expect(markers.find(m => m.locations.length === 2)?.members.length).toBe(2)
    for (const a of markers) for (const b of markers) {
      if (a === b) continue
      expect(Math.abs(a.x - b.x) / 640 * 350 >= 50 || Math.abs(a.y - b.y) / 600 * 328 >= 50).toBe(true)
    }
  })
})
