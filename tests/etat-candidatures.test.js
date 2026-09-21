import { afterEach, describe, expect, test } from 'bun:test'
import { lireEtatCohorte, progression } from '../src/lib/etat-candidatures'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('Progression fondée sur des éléments renseignés', () => {
  test('une date absente et un statut avancé ne prouvent pas la réception ou l’envoi d’un email', () => {
    const cells = progression({ Id: 1, statut: 'Engage' }, [])
    expect(cells).toHaveLength(10)
    expect(cells[0].etat).toBe('inconnu')
    expect(cells[1].etat).toBe('inconnu')
    expect(cells[3].texte).toBe('Acceptée · date non renseignée')
    expect(cells[9].etat).toBe('inconnu')
  })
  test('un abandon reste visible même avec une ancienne date de validation', () => {
    const cells = progression({ Id: 1, statut: 'Abandonne', date_validation: '2026-03-01' }, [])
    expect(cells[2].etat).toBe('abandon')
    expect(cells[3].etat).toBe('abandon')
  })
  test('une mission annulée ne désigne pas un formateur actif', () => {
    const cells = progression({ Id: 1 }, [{ Id: 9, statut: 'Annulée', formateurs_id: 7 }])
    expect(cells[6].etat).toBe('inconnu')
  })
  test('une mission renseignée documente l’affectation sans inventer la fin du suivi', () => {
    const cells = progression({ Id: 1 }, [{ Id: 9, statut: 'Terminee', formateurs_id: 7, nb_adultes_formes: 12 }])
    expect(cells[6].etat).toBe('fait')
    expect(cells[8].etat).toBe('en-cours')
    expect(cells[8].texte).toContain('12 adulte(s)')
  })
})

describe('Lecture NocoDB', () => {
  test('lit les pages plafonnées par le serveur et conserve les doublons signalés', async () => {
    const offsets = []
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      expect(init?.method).toBeUndefined()
      expect(url.searchParams.get('fields')).not.toContain('email')
      let list = []
      let isLastPage = true
      if (url.pathname.includes('m5ayop8ul8s040l')) list = [{ Id: 2, annee_debut: 2026, annee_fin: 2027 }]
      else if (url.pathname.includes('mbunbu0f1zztce4')) {
        expect(url.searchParams.get('where')).toBe('(cohortes_id,eq,2)')
        const offset = Number(url.searchParams.get('offset')); offsets.push(offset)
        list = [{ Id: offset + 1, etablissements_id: 7, cohortes_id: 2, statut: 'Candidature recue' }]
        isLastPage = offset === 1
      } else if (url.pathname.includes('mg12klh5zv7b5n5')) list = [{ Id: 7, nom: 'Établissement de test' }]
      else if (url.pathname.includes('merrsayuq3xb3uk')) list = [{ Id: 1, participations_id: 1, formateurs_id: 42 }]
      else throw new Error('Unexpected table')
      return Response.json({ list, pageInfo: { isLastPage } })
    })
    const etat = await lireEtatCohorte('test-token')
    expect(offsets).toEqual([0, 1])
    expect(etat.lignes).toHaveLength(2)
    expect(etat.etablissementsDistincts).toBe(1)
    expect(etat.lignesAVerifier).toBe(2)
    expect(etat.lignes[0].progression[6].etat).toBe('fait')
    expect(etat.lignes[1].progression[6].etat).toBe('inconnu')
  })
  test('refuse de choisir arbitrairement entre deux cohortes', async () => {
    globalThis.fetch = (async () => Response.json({ list: [{ Id: 2 }, { Id: 3 }], pageInfo: { isLastPage: true } }))
    await expect(lireEtatCohorte('test')).rejects.toThrow('ambiguë')
  })
  test('une panne de la base ne devient pas un tableau vide', async () => {
    globalThis.fetch = (async () => new Response('down', { status: 503 }))
    await expect(lireEtatCohorte('test')).rejects.toThrow('NocoDB 503')
  })
  test('une page répétée est une erreur explicite', async () => {
    globalThis.fetch = (async () => Response.json({ list: [{ Id: 2 }], pageInfo: { isLastPage: false } }))
    await expect(lireEtatCohorte('test')).rejects.toThrow('Pagination')
  })
  test('valide les archives après toutes les pages de la cohorte et ignore leurs anciens codes', async () => {
    const offsets = []
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname.includes('m5ayop8ul8s040l'))
        return Response.json({ list: [{ Id: 2 }], pageInfo: { isLastPage: true } })
      if (url.pathname.includes('mbunbu0f1zztce4')) {
        const fields = url.searchParams.get('fields').split(',')
        expect(fields).toContain('fusionne_vers')
        expect(fields).toContain('cohortes_id')
        expect(fields).not.toContain('email')
        expect(url.searchParams.get('where')).toBe('(cohortes_id,eq,2)')
        const offset = Number(url.searchParams.get('offset'))
        offsets.push(offset)
        const list = offset === 0
          ? [{ Id: 1, fusionne_vers: 2, etablissements_id: 7, cohortes_id: 2, code: 'CODE-ARCHIVE' }]
          : [{ Id: 2, fusionne_vers: null, etablissements_id: 7, cohortes_id: 2, code: 'CANONIQUE' }]
        return Response.json({ list, pageInfo: { isLastPage: offset === 1 } })
      }
      if (url.pathname.includes('mg12klh5zv7b5n5'))
        return Response.json({ list: [{ Id: 7, nom: 'École' }], pageInfo: { isLastPage: true } })
      expect(url.pathname).toContain('merrsayuq3xb3uk')
      expect(url.searchParams.get('where')).toBe('(participations_id,in,2)')
      return Response.json({ list: [], pageInfo: { isLastPage: true } })
    }
    const etat = await lireEtatCohorte('synthetic')
    expect(offsets).toEqual([0, 1])
    expect(etat.lignes.map((p) => [p.id, p.code])).toEqual([[2, 'CANONIQUE']])
    expect(etat.etablissementsDistincts).toBe(1)
    expect(etat.lignesAVerifier).toBe(0)
    expect(JSON.stringify(etat)).not.toContain('CODE-ARCHIVE')
  })
  test.each([
    ['cible absente ou hors cohorte', [{ Id: 1, fusionne_vers: 99, cohortes_id: 2 }]],
    ['cycle', [{ Id: 1, fusionne_vers: 2, cohortes_id: 2 }, { Id: 2, fusionne_vers: 1, cohortes_id: 2 }]],
    ['cible non entière', [{ Id: 1, fusionne_vers: 2.5, cohortes_id: 2 }]],
    ['cible zéro', [{ Id: 1, fusionne_vers: 0, cohortes_id: 2 }]],
    ['autre cohorte renvoyée', [{ Id: 1, fusionne_vers: 2, cohortes_id: 2 }, { Id: 2, cohortes_id: 3 }]],
    ['cohorte inconnue renvoyée', [{ Id: 1, fusionne_vers: 2, cohortes_id: 2 }, { Id: 2, cohortes_id: null }]],
    ['autre établissement', [{ Id: 1, fusionne_vers: 2, cohortes_id: 2 }, { Id: 2, cohortes_id: 2, etablissements_id: 8 }]],
  ])('%s : aucun résultat de suivi partiel', async (_, rows) => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname.includes('m5ayop8ul8s040l'))
        return Response.json({ list: [{ Id: 2 }], pageInfo: { isLastPage: true } })
      expect(url.pathname).toContain('mbunbu0f1zztce4')
      return Response.json({ list: rows.map((p) => ({ etablissements_id: 7, ...p })), pageInfo: { isLastPage: true } })
    }
    await expect(lireEtatCohorte('synthetic')).rejects.toThrow('incohérente')
  })
})
