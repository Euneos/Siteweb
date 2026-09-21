import { afterEach, beforeEach, test, expect, spyOn } from 'bun:test'
import { commandes, lire } from '../scripts/base.mjs'
import { NC } from '../src/lib/nocodb'

const savedFetch = globalThis.fetch
const savedToken = process.env.NOCODB_TOKEN
beforeEach(() => { process.env.NOCODB_TOKEN = 'test-only' })
afterEach(() => {
  globalThis.fetch = savedFetch
  if (savedToken == null) delete process.env.NOCODB_TOKEN
  else process.env.NOCODB_TOKEN = savedToken
})

test('NocoDB pagination includes the second page despite a server-clamped page size', async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.NOCODB_TOKEN
  process.env.NOCODB_TOKEN = 'test-only'
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(url)
    const offset = Number(new URL(url).searchParams.get('offset'))
    return Response.json({
      list: Array.from({ length: offset === 0 ? 100 : 5 }, (_, i) => ({ Id: offset + i + 1 })),
      pageInfo: { isLastPage: offset !== 0, totalRows: 105 },
    })
  }
  try {
    const { lire } = await import('../scripts/base.mjs')
    const rows = await lire('engagements', '&fields=Id,statut')
    expect(rows).toHaveLength(105)
    expect(rows.at(-1).Id).toBe(105)
    expect(new URL(urls[1]).searchParams.get('offset')).toBe('100')
    expect(new URL(urls[1]).searchParams.get('fields').split(',')).toEqual(
      ['Id', 'statut', 'fusionne_vers', 'formateurs_id', 'cohortes_id'],
    )
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken == null) delete process.env.NOCODB_TOKEN
    else process.env.NOCODB_TOKEN = originalToken
  }
})

test('réconcilie toutes les pages avant le filtre statut, préserve sort et la projection demandée', async () => {
  const rows = [
    { Id: 1, fusionne_vers: 2, etablissements_id: 7, cohortes_id: 2, statut: 'Candidature recue', code: 'ARCHIVE' },
    { Id: 2, etablissements_id: 7, cohortes_id: 2, statut: 'Engage', code: 'DOS-2' },
    { Id: 3, etablissements_id: 8, cohortes_id: 2, statut: 'En cours d’analyse', code: 'DOS-3' },
  ]
  const offsets = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    expect(url.pathname).toBe(`/api/v2/tables/${NC.tables.participations}/records`)
    expect(init.method ?? 'GET').toBe('GET')
    expect(url.searchParams.get('where')).toBeNull()
    expect(url.searchParams.get('sort')).toBe('-Id')
    expect(url.searchParams.get('fields').split(',').sort()).toEqual(
      ['code', 'Id', 'fusionne_vers', 'etablissements_id', 'cohortes_id', 'statut'].sort(),
    )
    const offset = Number(url.searchParams.get('offset'))
    offsets.push(offset)
    return Response.json({ list: rows.slice(offset, offset + 1), pageInfo: { isLastPage: offset === 2 } })
  }
  const where = encodeURIComponent('(statut,neq,Engage)~and(statut,neq,Refuse)')
  expect(await lire('participations', `&where=${where}&fields=code&sort=-Id`)).toEqual([rows[2]])
  expect(offsets).toEqual([0, 1, 2])
})

test('les parcours de même formateur avec cohortes nulles utilisent la réconciliation partagée', async () => {
  const rows = [
    { Id: 1, fusionne_vers: 2, formateurs_id: 7, cohortes_id: null, statut: 'Refuse' },
    { Id: 2, formateurs_id: 7, cohortes_id: null, statut: 'Candidature validée' },
  ]
  globalThis.fetch = async () => Response.json({ list: rows, pageInfo: { isLastPage: true } })
  expect(await lire('engagements', '&where=' + encodeURIComponent('(statut,eq,Candidature validée)'))).toEqual([rows[1]])
})

test.each([
  ['cible absente', [{ Id: 1, fusionne_vers: 2 }]],
  ['cycle', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, fusionne_vers: 1 }]],
  ['cohorte différente', [{ Id: 1, fusionne_vers: 2 }, { Id: 2, cohortes_id: 3 }]],
  ['cohortes nulles d’établissement', [{ Id: 1, fusionne_vers: 2, cohortes_id: null }, { Id: 2, cohortes_id: null }]],
  ['cible zéro', [{ Id: 1, fusionne_vers: 0 }]],
])('%s reste une erreur même si le statut exclurait le dossier', async (_, rows) => {
  globalThis.fetch = async () => Response.json({
    list: rows.map((row) => ({ etablissements_id: 7, cohortes_id: 2, statut: 'Engage', ...row })),
    pageInfo: { isLastPage: true },
  })
  await expect(lire('participations', '&where=' + encodeURIComponent('(statut,neq,Engage)'))).rejects.toThrow('incohérente')
})

test('les autres tables conservent leur WHERE, sort et fields', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    expect(url.searchParams.get('where')).toBe('(code,eq,TEST)')
    expect(url.searchParams.get('fields')).toBe('Id,code')
    expect(url.searchParams.get('sort')).toBe('code')
    return Response.json({ list: [{ Id: 1, code: 'TEST' }], pageInfo: { isLastPage: true } })
  }
  expect(await lire('templates_emails', '&fields=Id,code&sort=code&where=' + encodeURIComponent('(code,eq,TEST)'))).toEqual([{ Id: 1, code: 'TEST' }])
})

test('un filtre de dossiers non supporté est refusé avant toute requête', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected request') }
  await expect(lire('participations', '&where=' + encodeURIComponent('(code,eq,TEST)'))).rejects.toThrow('Filtre de dossiers')
  expect(calls).toBe(0)
})

test('une page répétée est refusée et une page courte sans métadonnées est poursuivie', async () => {
  globalThis.fetch = async () => Response.json({ list: [{ Id: 1 }], pageInfo: { isLastPage: false } })
  await expect(lire('participations')).rejects.toThrow('Pagination')
  const offsets = []
  globalThis.fetch = async (input) => {
    const offset = Number(new URL(input).searchParams.get('offset'))
    offsets.push(offset)
    return Response.json({ list: offset < 2 ? [{ Id: offset + 1 }] : [] })
  }
  expect(await lire('participations')).toHaveLength(2)
  expect(offsets).toEqual([0, 1, 2])
})

test.each([
  ['candidatures', /en cours — 0/],
  ['formateurs', /en cours — 1 \(sur 1\)/],
  ['campagne', /Etablissements engages : 1 \/ 30/],
  ['nouveautes', /École canonique/],
  ['dormants', /— 0/],
  ['chiffres', /1\s+participations \(non archivés\)/],
])('%s compte et affiche uniquement les dossiers actifs', async (command, expected) => {
  const date = new Date().toISOString().slice(0, 10)
  const part = [
    { Id: 1, fusionne_vers: 2, etablissements_id: 7, cohortes_id: 2, statut: 'Candidature recue', date_candidature: '2000-01-01', etablissement: { nom: 'ARCHIVE-ETAB' } },
    { Id: 2, etablissements_id: 7, cohortes_id: 2, statut: 'Engage', date_candidature: date, etablissement: { nom: 'École canonique' } },
  ]
  const eng = [
    { Id: 11, fusionne_vers: 12, formateurs_id: 7, cohortes_id: null, statut: 'Candidature recue', formateur: { nom: 'ARCHIVE-FORM' } },
    { Id: 12, formateurs_id: 7, cohortes_id: null, statut: 'Candidature recue', date_candidature: date, formateur: { nom: 'Formateur synthétique' } },
  ]
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input))
    expect(options.method ?? 'GET').toBe('GET')
    const table = url.pathname.split('/')[4]
    const source = table === NC.tables.participations ? part : table === NC.tables.engagements ? eng
      : table === NC.tables.cohortes ? [{ Id: 2, nom: 'Cohorte synthétique', active: true }] : []
    const offset = Number(url.searchParams.get('offset'))
    return Response.json({ list: source.slice(offset, offset + 1), pageInfo: { isLastPage: offset + 1 >= source.length, totalRows: source.length } })
  }
  const log = spyOn(console, 'log').mockImplementation(() => {})
  try {
    await commandes[command]()
    const output = log.mock.calls.flat().join('\n')
    expect(output).toMatch(expected)
    expect(output).not.toMatch(/ARCHIVE-ETAB|ARCHIVE-FORM/)
    if (command === 'chiffres') expect(output).toMatch(/1\s+engagements \(non archivés\)/)
  } finally {
    log.mockRestore()
  }
})

test('campagne distingue deux cohortes de même nom et isole les cohortes inconnues', async () => {
  globalThis.fetch = async (input) => {
    const table = new URL(String(input)).pathname.split('/')[4]
    const list = table === NC.tables.cohortes
      ? [{ Id: 1, nom: 'Même nom', active: false }, { Id: 2, nom: 'Même nom', active: true }]
      : table === NC.tables.participations ? [
        { Id: 1, etablissements_id: 7, cohortes_id: 1, cohorte: { nom: 'Même nom' }, statut: 'Engage' },
        { Id: 2, etablissements_id: 7, cohortes_id: 2, cohorte: { nom: 'Même nom' }, statut: 'Engage' },
        { Id: 3, etablissements_id: 7, cohortes_id: null, statut: 'Engage' },
        { Id: 4, etablissements_id: 7, cohortes_id: 999, statut: 'Engage' },
      ] : []
    return Response.json({ list, pageInfo: { isLastPage: true } })
  }
  const log = spyOn(console, 'log').mockImplementation(() => {})
  try {
    await commandes.campagne()
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('Etablissements engages : 1 / 30')
    expect(output).toContain('cohorte indéterminée, hors de ce total : 2')
  } finally {
    log.mockRestore()
  }
})
