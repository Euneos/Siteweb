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
  test('archives exclues des totaux, doublons actifs visibles et deux cohortes distinctes', () => {
    const rows = [
      { Id: 1, etablissements_id: 1, cohortes_id: 2, fusionne_vers: 2, code: 'CODE-ARCHIVE' },
      { Id: 2, etablissements_id: 1, cohortes_id: 2, fusionne_vers: null, code: 'CANONIQUE' },
      { Id: 3, etablissements_id: 1, cohortes_id: 1, code: 'ANNEE-PRECEDENTE' },
      { Id: 4, etablissements_id: 1, cohortes_id: 2, code: 'AMBIGU-ACTIF' },
      { Id: 5, etablissements_id: 1, cohortes_id: null },
      { Id: 6, etablissements_id: 1, cohortes_id: null },
      { Id: 7, etablissements_id: 1, cohortes_id: 999 },
      { Id: 8, etablissements_id: 1, cohortes_id: 999 },
    ]
    const data = buildMapData(cohorts, rows, establishments)
    expect(data.totals).toMatchObject({ participations: 7, groups: 6, establishments: 1, duplicateGroups: 1, orphanParticipations: 4 })
    expect(data.groups.find((g) => g.key === '1:2').participations.map((p) => p.id)).toEqual([2, 4])
    expect(data.groups.find((g) => g.key === '1:1').participations.map((p) => p.id)).toEqual([3])
    expect(data.groups.filter((g) => !g.cohortKnown)).toHaveLength(4)
    expect(data.groups.every((g) => g.establishmentId === 1)).toBe(true)
    expect(JSON.stringify(data)).not.toContain('CODE-ARCHIVE')
    expect(rows).toHaveLength(8)
  })
  test.each([
    ['cible absente', [{ Id: 1, fusionne_vers: 99 }]],
    ['cycle', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, fusionne_vers: 1 }]],
    ['cible archivée', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, fusionne_vers: 3 }, { Id: 3 }]],
    ['cible zéro', [{ Id: 1, fusionne_vers: 0 }]],
    ['cible non entière', [{ Id: 1, fusionne_vers: 2.5 }]],
    ['autre cohorte', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, cohortes_id: 1 }]],
    ['cohortes absentes', [{ Id: 1, fusionne_vers: 2, cohortes_id: null }, { Id: 2, cohortes_id: null }]],
    ['autre établissement', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, etablissements_id: 2 }]],
  ])('%s refuse la carte aussi bien en données brutes que via l’API', async (_, partialRows) => {
    const rows = partialRows.map((p) => ({ etablissements_id: 1, cohortes_id: 2, ...p }))
    expect(() => buildMapData(cohorts, rows, establishments)).toThrow('incohérente')
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      const list = url.pathname.includes(NC.tables.participations) ? rows
        : url.pathname.includes(NC.tables.cohortes) ? cohorts : establishments
      return Response.json({ list, pageInfo: { isLastPage: true } })
    }
    await expect(readMapData('synthetic')).rejects.toThrow('incohérente')
  })
  test('API et lignes brutes donnent la même carte après pagination des archives', async () => {
    const rows = participations.map((p) => p.Id === 1 ? { ...p, fusionne_vers: 2 } : p)
    const offsets = []
    globalThis.fetch = async (input, options) => {
      const url = new URL(String(input))
      expect(options.method).toBe('GET')
      expect(url.searchParams.get('fields')).not.toMatch(/adresse|lat|lng|email|contact/)
      const table = Object.entries(NC.tables).find(([, id]) => url.pathname.includes(id))[0]
      const source = { cohortes: cohorts, participations: rows, etablissements: establishments }[table]
      const offset = Number(url.searchParams.get('offset'))
      if (table === 'participations') {
        expect(url.searchParams.get('fields').split(',')).toContain('fusionne_vers')
        offsets.push(offset)
      }
      return Response.json({ list: source.slice(offset, offset + 1), pageInfo: { isLastPage: offset + 1 >= source.length } })
    }
    const rawData = buildMapData(cohorts, rows, establishments)
    const apiData = await readMapData('synthetic')
    expect({ ...apiData, updatedAt: null }).toEqual({ ...rawData, updatedAt: null })
    expect(apiData.totals.participations).toBe(16)
    expect(apiData.totals.duplicateGroups).toBe(0)
    expect(offsets).toEqual(Array.from({ length: 17 }, (_, i) => i))
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
