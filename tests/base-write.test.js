import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { commandes } from '../scripts/base.mjs'
import { NC } from '../src/lib/nocodb'
import { valeurStatutCandidature } from '../src/lib/statut-candidature'

const originalFetch = globalThis.fetch
const originalToken = process.env.NOCODB_TOKEN
let rows, requests, patches, log, reread
beforeEach(() => {
  process.env.NOCODB_TOKEN = 'test-only'
  rows = [
    { Id: 1, fusionne_vers: 2, etablissements_id: 7, cohortes_id: 2, statut: 'Candidature recue', code: 'ANCIEN', historique_fusion: 'Historique synthétique', etablissement: { nom: 'École archive' } },
    { Id: 2, fusionne_vers: null, etablissements_id: 7, cohortes_id: 2, statut: 'Candidature recue', code: 'DOS-2', etablissement: { nom: 'École canonique' } },
  ]
  requests = []
  patches = []
  reread = null
  log = spyOn(console, 'log').mockImplementation(() => {})
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input))
    const method = options.method ?? 'GET'
    requests.push({ method, url })
    expect(url.origin).toBe('https://app.nocodb.com')
    expect(url.pathname).toContain(`/tables/${NC.tables.participations}/records`)
    if (method === 'PATCH') {
      patches.push(JSON.parse(options.body))
      for (const patch of patches.at(-1)) Object.assign(rows.find((r) => r.Id === patch.Id), patch)
      return Response.json(patches.at(-1))
    }
    expect(method).toBe('GET')
    const id = Number(url.pathname.split('/')[6])
    if (id) return Response.json(reread ?? rows.find((row) => row.Id === id))
    expect(url.searchParams.get('where')).toBeNull()
    expect(url.searchParams.get('fields')).not.toMatch(/email|contact|historique|etablissement,/)
    const offset = Number(url.searchParams.get('offset'))
    return Response.json({ list: rows.slice(offset, offset + 1), pageInfo: { isLastPage: offset + 1 >= rows.length } })
  }
})
afterEach(() => {
  globalThis.fetch = originalFetch
  log.mockRestore()
  if (originalToken == null) delete process.env.NOCODB_TOKEN
  else process.env.NOCODB_TOKEN = originalToken
})

test('la fiche archive reste consultable avec sa cible et son historique, sans redirection', async () => {
  await commandes.etablissement('1')
  const output = log.mock.calls.flat().join('\n')
  expect(output).toContain('Dossier #1 — ARCHIVÉ vers le dossier canonique #2')
  expect(output).toContain('École archive')
  expect(output).toContain('Historique synthétique')
  expect(output).not.toContain('École canonique')
  expect(requests).toHaveLength(1)
  expect(requests[0].url.pathname).toEndWith('/records/1')
  expect(patches).toEqual([])
})

test('statut refuse une archive, indique le canonique et ne PATCH aucun des deux', async () => {
  await expect(commandes.statut('1', 'Candidature acceptée')).rejects.toThrow('archivé vers le dossier canonique #2')
  expect(patches).toEqual([])
  expect(requests.every((r) => r.method === 'GET')).toBe(true)
})

test.each(['Candidature recue', 'Candidature reçue', 'Candidature acceptée', 'Engage', 'Établissement engagé', 'Abandonne', 'Abandon', 'Refuse', 'Refus'])(
  'un dossier canonique unique accepte le statut %s sans toucher son archive', async (statut) => {
    rows[1].statut = 'Retenu'
    rows[1].fiche_contact_recue = true
    rows[1].lettre_interet_signee = true
    await commandes.statut('2', statut)
    expect(patches).toEqual([[{ Id: 2, statut: valeurStatutCandidature(statut) }]])
    expect(rows[0].statut).toBe('Candidature recue')
    expect(requests.filter((r) => r.url.searchParams.has('offset')).map((r) => r.url.searchParams.get('offset'))).toEqual(['0', '1'])
    expect(requests.at(-3).url.pathname).toEndWith('/records/2')
    expect(requests.at(-2).method).toBe('PATCH')
    expect(requests.at(-1).method).toBe('GET')
  },
)

test.each([2, null])('un autre dossier actif de même identité avec cohorte %j bloque le PATCH', async (cohortes_id) => {
  rows.push({ Id: 3, etablissements_id: 7, cohortes_id: cohortes_id })
  await expect(commandes.statut('2', 'Candidature acceptée')).rejects.toThrow('ambigu')
  expect(patches).toEqual([])
})

test('une autre cohorte valide ou un autre établissement ne crée pas d’ambiguïté', async () => {
  rows.push({ Id: 3, etablissements_id: 7, cohortes_id: 1 }, { Id: 4, etablissements_id: 8, cohortes_id: 2 })
  await commandes.statut('2', 'Candidature acceptée')
  expect(patches).toEqual([[{ Id: 2, statut: 'Candidature acceptée' }]])
})

test('une archive apparue à la relecture bloque le PATCH et indique sa cible', async () => {
  reread = { ...rows[1], fusionne_vers: 3 }
  await expect(commandes.statut('2', 'Engage')).rejects.toThrow('archivé vers le dossier canonique #3')
  expect(patches).toEqual([])
})

test.each([{ cohortes_id: 3 }, { etablissements_id: 9 }, { statut: 'Abandonne' }])(
  'un changement concurrent du dossier %j exige une relecture', async (change) => {
    reread = { ...rows[1], ...change }
    await expect(commandes.statut('2', 'Engage')).rejects.toThrow('modifié pendant la lecture')
    expect(patches).toEqual([])
  },
)

test('une archive incohérente empêche une écriture sur un dossier actif', async () => {
  rows[0].fusionne_vers = 99
  await expect(commandes.statut('2', 'Engage')).rejects.toThrow('cible de fusion absente')
  expect(patches).toEqual([])
})

test('un dossier actif sans cohorte exige une vérification avant écriture', async () => {
  rows = [{ ...rows[1], cohortes_id: null }]
  await expect(commandes.statut('2', 'Engage')).rejects.toThrow('indéterminé')
  expect(patches).toEqual([])
})

test.each(['0', '-1', '1.5', '1?fields=Id', '9007199254740992'])(
  'identifiant invalide %s : aucune requête', async (id) => {
    await expect(commandes.statut(id, 'Engage')).rejects.toThrow('Identifiant')
    expect(requests).toEqual([])
  },
)

test('un statut inconnu ne provoque aucune requête', async () => {
  await expect(commandes.statut('2', 'Inventé')).rejects.toThrow('Statut inconnu')
  expect(requests).toEqual([])
})

test.each(['En cours d’analyse', 'Retenu', 'Accuse reception', 'Invite', 'En discussion'])(
  'le choix ancien ou le libellé %s ne crée pas une nouvelle valeur stockée', async (statut) => {
    await expect(commandes.statut('2', statut)).rejects.toThrow('Statut inconnu ou historique')
    expect(requests).toEqual([])
  },
)

test.each([
  {}, { fiche_contact_recue: true }, { lettre_interet_signee: true },
  { fiche_contact_recue: 'true', lettre_interet_signee: true },
  { fiche_contact_recue: true, lettre_interet_signee: 'false' },
])('Engagé sans les deux preuves %j ne produit aucun PATCH', async (preuves) => {
  Object.assign(rows[1], preuves)
  await expect(commandes.statut('2', 'Engage')).rejects.toThrow('fiche contact reçue ET lettre d’intérêt signée')
  expect(patches).toEqual([])
  expect(requests.at(-1).url.searchParams.get('fields')).toContain('fiche_contact_recue,lettre_interet_signee')
})

test('la preuve relue juste avant écriture prévaut sur l’ancienne valeur', async () => {
  rows[1].fiche_contact_recue = true
  rows[1].lettre_interet_signee = true
  reread = { ...rows[1], lettre_interet_signee: false }
  await expect(commandes.statut('2', 'Engage')).rejects.toThrow('lettre d’intérêt signée')
  expect(patches).toEqual([])
})

test.each(['Candidature acceptée', 'Engage'])('rechoisir %s ne réécrit pas le dossier ni ses preuves', async (statut) => {
  rows[1].statut = statut
  await commandes.statut('2', statut)
  expect(patches).toEqual([])
  expect(log.mock.calls.flat().join('\n')).toContain('déjà enregistré, aucune modification')
})

test('un accusé HTTP de PATCH ne suffit pas si le statut relu est différent', async () => {
  reread = { ...rows[1] }
  await expect(commandes.statut('2', 'Candidature acceptée')).rejects.toThrow('pas confirmé par la relecture')
  expect(patches).toHaveLength(1)
})

test('un ancien code équivalent au statut canonique est sans effet', async () => {
  rows[1].statut = 'Établissement engagé'
  await commandes.statut('2', 'Engage')
  expect(patches).toHaveLength(0)
})
