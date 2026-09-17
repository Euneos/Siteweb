import { afterEach, describe, expect, test } from 'bun:test'
import { buildMapData, locateCommune, normalizePostcode, readMapData } from '../src/lib/map'
import { NC } from '../src/lib/nocodb'
import { cohorts, establishments, participations } from './fixtures/implantations'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Implantations : commune sans point école supposé', () => {
  test.each([
    ['Paris', '75001', '75056', 'metropole'],
    ['Ajaccio', '20000', '2A004', 'metropole'],
    ['Les Abymes', '97139', '97101', '971'],
    ['Fort de France', '97200', '97209', '972'],
    ['Cayenne', '97300', '97302', '973'],
    ['St-Denis', '97400', '97411', '974'],
    ['Mamoudzou', '97600', '97611', '976'],
  ])('%s %s : centre communal officiel et territoire distinct', (city, cp, code, territory) => {
    const { location, issue } = locateCommune(city, cp)
    expect(issue).toBeNull()
    expect(location).toMatchObject({ code, territory })
    expect(location.x).toBeGreaterThan(0)
    expect(location.x).toBeLessThan(1000)
    expect(location.y).toBeGreaterThan(0)
    expect(location.y).toBeLessThan(650)
  })
  test.each([
    ['', '75001'],
    ['Paris', ''],
    ['Paris', '69001'],
    ['Paris CEDEX', '75001'],
    ['Pariss', '75001'],
    ['Paris', '123'],
    ['Nouméa', '98800'],
  ])('%s %s : aucune approximation ni faux point', (city, cp) => {
    const result = locateCommune(city, cp)
    expect(result.location).toBeNull()
    expect(result.issue).toBeTruthy()
  })
  test('les coordonnées et adresses Noco ne sont jamais utilisées ni exposées', () => {
    const privateFields = {
      adresse: 'PRIVATE-STREET',
      lat: 0,
      lng: 0,
      referent_email: 'private@example.test',
    }
    const data = buildMapData(
      cohorts,
      [{ Id: 1, etablissements_id: 1, cohortes_id: 2 }],
      [{ Id: 1, ville: 'Paris', cp: '75001', ...privateFields }],
    )
    expect(data.groups[0].location.lon).toBe(2.347)
    expect(data.groups[0].location.lat).toBe(48.8589)
    expect(JSON.stringify(data)).not.toMatch(
      /PRIVATE-STREET|private@example.test|adresse|referent_email/,
    )
  })
  test('normalise un CP numérique sans perdre le zéro initial', () => {
    const data = buildMapData(
      cohorts,
      [{ Id: 1, etablissements_id: 1, cohortes_id: 2 }],
      [{ Id: 1, ville: 'Nice', cp: 6000 }],
    )
    expect(data.groups[0].postcode).toBe('06000')
    expect(data.groups[0].location.name).toBe('Nice')
    expect(normalizePostcode('6000.0')).toBe('06000')
    expect(normalizePostcode('97400.0')).toBe('97400')
    expect(normalizePostcode('97400.5')).toBe('97400.5')
    expect(locateCommune('Saint-Denis', normalizePostcode('97400.0')).location.territory).toBe(
      '974',
    )
  })
})
describe('Fidélité à toutes les participations NocoDB', () => {
  test('regroupe par établissement ET cohorte, conserve statuts divergents et chaque ID', () => {
    const result = buildMapData(cohorts, participations, establishments)
    expect(result.totals).toEqual({
      participations: 17,
      establishments: 12,
      groups: 16,
      located: 12,
      unlocated: 4,
      duplicateGroups: 1,
      orphanParticipations: 4,
    })
    expect(
      result.groups.flatMap((g) => g.participations.map((p) => p.id)).sort((a, b) => a - b),
    ).toEqual(participations.map((p) => p.Id))
    expect(result.groups.find((g) => g.key === '1:2').participations.map((p) => p.status)).toEqual([
      'Engage',
      'Abandonne',
    ])
    expect(result.groups.find((g) => g.key === '1:1').participations).toHaveLength(1)
  })
  test('cohortes manquantes et établissements introuvables restent séparés et visibles', () => {
    const result = buildMapData(cohorts, participations, establishments)
    expect(result.groups.filter((g) => !g.cohortKnown)).toHaveLength(2)
    expect(result.groups.filter((g) => !g.establishmentKnown)).toHaveLength(2)
    expect(
      result.groups.filter((g) => !g.establishmentKnown).every((g) => g.location === null),
    ).toBe(true)
  })
  test('sélection factuelle de cohorte, sans année codée ni choix arbitraire', () => {
    expect(buildMapData(cohorts, [], []).defaultCohort).toBe('2')
    expect(
      buildMapData(
        cohorts.map((c) => ({ ...c, active: true })),
        [],
        [],
      ).defaultCohort,
    ).toBe('')
    expect(
      buildMapData(
        cohorts.map((c) => ({ ...c, active: false })),
        [],
        [],
      ).defaultCohort,
    ).toBe('')
    expect(
      buildMapData([{ Id: 37, annee_debut: 2035, annee_fin: 2036, active: 1 }], [], []).cohorts[0]
        .label,
    ).toBe('2035–2036')
  })
  test('une base vide est distincte des données incohérentes', () => {
    expect(buildMapData([], [], []).totals.participations).toBe(0)
    expect(() =>
      buildMapData(cohorts, [participations[0], participations[0]], establishments),
    ).toThrow('incohérente')
    expect(() => buildMapData(cohorts, [{ Id: 'wrong' }], establishments)).toThrow('incohérente')
  })
  test('réutilise la pagination complète même si Noco réduit la taille des pages', async () => {
    const requests = []
    const source = { cohortes: cohorts, participations, etablissements: establishments }
    globalThis.fetch = async (input, options) => {
      const url = new URL(input)
      expect(url.origin).toBe('https://app.nocodb.com')
      expect(options.method).toBe('GET')
      expect(options.body).toBeUndefined()
      const table = Object.entries(NC.tables).find(([, id]) => url.pathname.includes(id))?.[0]
      expect(['cohortes', 'participations', 'etablissements']).toContain(table)
      expect(url.searchParams.get('fields')).not.toMatch(/adresse|lat|lng|email|contact/)
      const offset = Number(url.searchParams.get('offset'))
      const list = source[table].slice(offset, offset + 3)
      requests.push([table, offset])
      return Response.json({
        list,
        pageInfo: { isLastPage: offset + list.length >= source[table].length },
      })
    }
    expect((await readMapData('synthetic-token')).totals.participations).toBe(17)
    expect(
      requests.filter(([table]) => table === 'participations').map(([, offset]) => offset),
    ).toEqual([0, 3, 6, 9, 12, 15])
  })
  test('une erreur sur une page ne devient jamais un résultat partiel ou zéro', async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(input)
      if (url.pathname.includes(NC.tables.participations)) {
        if (url.searchParams.get('offset') !== '0')
          return new Response('private upstream details', { status: 503 })
        return Response.json({ list: [participations[0]], pageInfo: { isLastPage: false } })
      }
      return Response.json({ list: [], pageInfo: { isLastPage: true } })
    }
    await expect(readMapData('synthetic-token')).rejects.toThrow('NocoDB 503')
  })
})
