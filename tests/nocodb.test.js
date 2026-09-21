import { afterEach, describe, expect, test } from 'bun:test'
import { lireToutes, NC, reconcilierActifs } from '../src/lib/nocodb'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('Réconciliation des dossiers archivés', () => {
  test('ne conserve que les actifs sans modifier les sources ni leurs relations', () => {
    const rows = [
      { Id: 1, fusionne_vers: 3, cohortes_id: 2, etablissements_id: 7, code: 'ANCIEN' },
      { Id: 2, cohortes_id: 2, etablissements_id: 7 },
      { Id: 3, fusionne_vers: null, cohortes_id: 2, etablissements_id: 7 },
    ]
    const before = structuredClone(rows)
    rows.forEach(Object.freeze)
    Object.freeze(rows)
    expect(reconcilierActifs(rows, ['cohortes_id', 'etablissements_id'])).toEqual([rows[1], rows[2]])
    expect(rows).toEqual(before)
  })
  test('champ absent ou null : actif ; aucune sélection parmi plusieurs dossiers actifs', () => {
    const rows = [{ Id: 1 }, { Id: 2, fusionne_vers: null }]
    expect(reconcilierActifs(rows)).toEqual(rows)
  })
  test.each([
    ['cible absente', [{ Id: 1, fusionne_vers: 99 }]],
    ['cycle', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, fusionne_vers: 1 }]],
    ['auto-fusion', [{ Id: 1, fusionne_vers: 1 }]],
    ['cible archivée', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, fusionne_vers: 3 }, { Id: 3 }]],
    ['Id ambigu', [{ Id: 1 }, { Id: 1 }]],
    ['Id zéro', [{ Id: 0 }]],
    ['Id non entier', [{ Id: 1.5 }]],
    ['Id texte', [{ Id: '1' }]],
    ['Id absent', [{}]],
    ['ligne absente', [null]],
  ])('refuse %s avant de filtrer', (_, rows) => {
    expect(() => reconcilierActifs(rows)).toThrow('incohérente')
  })
  test.each([0, -1, 1.5, '2', '', false, true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'fusionne_vers=%s est invalide et ne devient pas actif', (fusionne_vers) => {
      expect(() => reconcilierActifs([{ Id: 1, fusionne_vers }, { Id: 2 }])).toThrow('fusionne_vers invalide')
    },
  )
  test.each([
    [{ cohortes_id: 1, etablissements_id: 7 }, { cohortes_id: 2, etablissements_id: 7 }],
    [{ cohortes_id: 2, etablissements_id: 7 }, { cohortes_id: 2, etablissements_id: 8 }],
    [{ cohortes_id: null, etablissements_id: 7 }, { cohortes_id: null, etablissements_id: 7 }],
    [{ cohortes_id: 2 }, { cohortes_id: 2 }],
    [{ cohortes_id: 0, etablissements_id: 7 }, { cohortes_id: 0, etablissements_id: 7 }],
  ])('refuse les rattachements différents ou non prouvés : %j / %j', (source, target) => {
    expect(() => reconcilierActifs(
      [{ Id: 1, fusionne_vers: 2, ...source }, { Id: 2, ...target }],
      ['cohortes_id', 'etablissements_id'],
    )).toThrow('rattachement')
  })
})

describe('Lecture paginée avec archives', () => {
  test.each([
    ['participations', 'etablissements_id'],
    ['engagements', 'formateurs_id'],
  ])('%s : export brut complet, projection minimale et archivage validé ensuite', async (table, parent) => {
    const rows = [
      { Id: 1, fusionne_vers: 5, [parent]: 7, cohortes_id: 2 },
      { Id: 2, fusionne_vers: 5, [parent]: 7, cohortes_id: 2 },
      { Id: 3, [parent]: 7, cohortes_id: 1 },
      { Id: 4, [parent]: 7, cohortes_id: null },
      { Id: 5, fusionne_vers: null, [parent]: 7, cohortes_id: 2 },
    ]
    const offsets = []
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe(`/api/v2/tables/${NC.tables[table]}/records`)
      expect(init.method).toBe('GET')
      expect(init.body).toBeUndefined()
      expect(url.searchParams.get('where')).toBeNull()
      expect(url.searchParams.get('fields').split(',').sort()).toEqual(
        ['Id', 'fusionne_vers', parent, 'cohortes_id'].sort(),
      )
      const offset = Number(url.searchParams.get('offset'))
      offsets.push(offset)
      const list = rows.slice(offset, offset + 2)
      return Response.json({ list, pageInfo: { isLastPage: offset + list.length >= rows.length } })
    }
    expect(await lireToutes('synthetic', table, 'Id')).toEqual(rows.slice(2))
    expect(offsets).toEqual([0, 2, 4])
    expect(rows).toHaveLength(5)
  })
  test('ancien schéma : le champ demandé mais absent de la réponse reste compatible', async () => {
    globalThis.fetch = async () => Response.json({ list: [{ Id: 1 }], pageInfo: { isLastPage: true } })
    expect(await lireToutes('synthetic', 'participations', 'Id')).toEqual([{ Id: 1 }])
  })
  test('deux parcours du même formateur sans cohorte ni promotion : archive valide, historique conservé', async () => {
    // Synthetic IDs only; reproduces two trainer dossiers with both cohorts null.
    const rows = [
      { Id: 11, fusionne_vers: 12, formateurs_id: 7, cohortes_id: null, promotion: null },
      { Id: 12, fusionne_vers: null, formateurs_id: 7, cohortes_id: null, promotion: null },
    ]
    const before = structuredClone(rows)
    expect(reconcilierActifs(rows, ['formateurs_id', 'cohortes_id'], ['cohortes_id'])).toEqual([rows[1]])
    const offsets = []
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      expect(init.method).toBe('GET')
      expect(init.body).toBeUndefined()
      expect(url.searchParams.get('fields').split(',').sort()).toEqual(
        ['Id', 'fusionne_vers', 'formateurs_id', 'cohortes_id'].sort(),
      )
      const offset = Number(url.searchParams.get('offset'))
      offsets.push(offset)
      // Match the actual projection: promotion is unnecessary for validation.
      const list = rows.slice(offset, offset + 1).map(({ promotion, ...row }) => row)
      return Response.json({ list, pageInfo: { isLastPage: offset === 1 } })
    }
    expect(await lireToutes('synthetic', 'engagements', 'Id')).toEqual([
      { Id: 12, fusionne_vers: null, formateurs_id: 7, cohortes_id: null },
    ])
    expect(offsets).toEqual([0, 1])
    expect(rows).toEqual(before)
  })
  test.each([[null, 2], [2, null], [undefined, undefined], [0, 0]])(
    'cohortes de parcours %j / %j : divergence ou absence non explicite refusée', async (source, target) => {
      globalThis.fetch = async () => Response.json({
        list: [
          { Id: 11, fusionne_vers: 12, formateurs_id: 7, cohortes_id: source },
          { Id: 12, formateurs_id: 7, cohortes_id: target },
        ],
        pageInfo: { isLastPage: true },
      })
      await expect(lireToutes('synthetic', 'engagements', 'Id')).rejects.toThrow('rattachement cohortes_id')
    },
  )
  test.each([null, undefined, 0, 7.5, '7'])(
    'deux cohortes nulles exigent toujours un formateur valide : %j', async (formateurs_id) => {
      globalThis.fetch = async () => Response.json({
        list: [
          { Id: 11, fusionne_vers: 12, formateurs_id, cohortes_id: null },
          { Id: 12, formateurs_id, cohortes_id: null },
        ],
        pageInfo: { isLastPage: true },
      })
      await expect(lireToutes('synthetic', 'engagements', 'Id')).rejects.toThrow('rattachement formateurs_id')
    },
  )
  test('deux participations sans cohorte ne peuvent toujours pas être archivées', async () => {
    globalThis.fetch = async () => Response.json({
      list: [
        { Id: 11, fusionne_vers: 12, etablissements_id: 7, cohortes_id: null },
        { Id: 12, etablissements_id: 7, cohortes_id: null },
      ],
      pageInfo: { isLastPage: true },
    })
    await expect(lireToutes('synthetic', 'participations', 'Id')).rejects.toThrow('rattachement cohortes_id')
  })
  test.each([
    { formateurs_id: 8, cohortes_id: 2 },
    { formateurs_id: 7, cohortes_id: 1 },
    { formateurs_id: null, cohortes_id: 2 },
  ])('un parcours ne s’archive pas vers un autre formateur ou une autre cohorte : %j', async (target) => {
    globalThis.fetch = async () => Response.json({
      list: [{ Id: 1, fusionne_vers: 2, formateurs_id: 7, cohortes_id: 2 }, { Id: 2, ...target }],
      pageInfo: { isLastPage: true },
    })
    await expect(lireToutes('synthetic', 'engagements', 'Id')).rejects.toThrow('rattachement')
  })
  test('sans métadonnées de pagination, une page courte ne coupe pas la lecture', async () => {
    const offsets = []
    globalThis.fetch = async (input) => {
      const offset = Number(new URL(input).searchParams.get('offset'))
      offsets.push(offset)
      return Response.json({ list: offset < 2 ? [{ Id: offset + 1 }] : [] })
    }
    expect(await lireToutes('synthetic', 'participations', 'Id')).toHaveLength(2)
    expect(offsets).toEqual([0, 1, 2])
  })
  test.each([
    [{ Id: 1, fusionne_vers: 9 }],
    [{ Id: 1, fusionne_vers: 2 }, { Id: 2, fusionne_vers: 1 }],
    [{ Id: 1, fusionne_vers: 0 }],
    [{ Id: 1, fusionne_vers: 1.5 }],
    [{ Id: 1 }, { Id: 1 }],
  ])('ne masque pas une incohérence issue de l’API : %j', async (...rows) => {
    globalThis.fetch = async () => Response.json({ list: rows, pageInfo: { isLastPage: true } })
    await expect(lireToutes('synthetic', 'participations', 'Id')).rejects.toThrow('incohérente')
  })
  test('refuse une page vide annoncée non terminale', async () => {
    globalThis.fetch = async () => Response.json({ list: [], pageInfo: { isLastPage: false } })
    await expect(lireToutes('synthetic', 'engagements', 'Id')).rejects.toThrow('interrompue')
  })
  test('une page répétée ne peut donner ni total ni cible canonique fiable', async () => {
    globalThis.fetch = async () => Response.json({ list: [{ Id: 1 }], pageInfo: { isLastPage: false } })
    await expect(lireToutes('synthetic', 'participations', 'Id')).rejects.toThrow('Pagination')
  })
  test('une panne après une archive ne produit pas de résultat partiel', async () => {
    globalThis.fetch = async (input) => new URL(input).searchParams.get('offset') === '0'
      ? Response.json({ list: [{ Id: 1, fusionne_vers: 2 }], pageInfo: { isLastPage: false } })
      : new Response('down', { status: 503 })
    await expect(lireToutes('synthetic', 'participations', 'Id')).rejects.toThrow('NocoDB 503')
  })
})
