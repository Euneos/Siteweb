import { afterEach, describe, expect, test } from 'bun:test'
import {
  lireEtatCohorte,
  progression,
  lireSourceContact,
  verifierDates,
  commenceDans30Jours,
  selectionnerDossiers,
  dateFormationFr,
} from '../src/lib/etat-candidatures'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

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
    const cells = progression({ Id: 1 }, [
      { Id: 9, statut: 'Terminee', formateurs_id: 7, nb_adultes_formes: 12 },
    ])
    expect(cells[6].etat).toBe('fait')
    expect(cells[8].etat).toBe('en-cours')
    expect(cells[8].texte).toContain('12 adulte(s)')
  })
})

describe('Lecture NocoDB', () => {
  test('lit les pages plafonnées par le serveur et conserve les doublons signalés', async () => {
    const offsets = []
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      expect(init?.method).toBeUndefined()
      expect(url.searchParams.get('fields')).not.toContain('email')
      let list = []
      let isLastPage = true
      if (url.pathname.includes('m5ayop8ul8s040l'))
        list = [{ Id: 2, annee_debut: 2026, annee_fin: 2027 }]
      else if (url.pathname.includes('mbunbu0f1zztce4')) {
        expect(url.searchParams.get('where')).toBe('(cohortes_id,eq,2)')
        const offset = Number(url.searchParams.get('offset'))
        offsets.push(offset)
        list = [
          { Id: offset + 1, etablissements_id: 7, cohortes_id: 2, statut: 'Candidature recue' },
        ]
        isLastPage = offset === 1
      } else if (url.pathname.includes('mg12klh5zv7b5n5'))
        list = [{ Id: 7, nom: 'Établissement de test' }]
      else if (url.pathname.includes('merrsayuq3xb3uk'))
        list = [{ Id: 1, participations_id: 1, formateurs_id: 42 }]
      else if (url.pathname.includes('mzbpzuikti6h3pz')) list = []
      else if (url.pathname.includes('mblganql53o34gm'))
        list = [{ Id: 42, prenom: 'Camille', nom: 'Exemple' }]
      else throw new Error('Unexpected table')
      return Response.json({ list, pageInfo: { isLastPage } })
    }
    const etat = await lireEtatCohorte('test-token')
    expect(offsets).toEqual([0, 1])
    expect(etat.lignes).toHaveLength(2)
    expect(etat.etablissementsDistincts).toBe(1)
    expect(etat.lignesAVerifier).toBe(2)
    expect(etat.lignes[0].progression[6].etat).toBe('fait')
    expect(etat.lignes[1].progression[6].etat).toBe('inconnu')
  })
  test('refuse de choisir arbitrairement entre deux cohortes', async () => {
    globalThis.fetch = async () =>
      Response.json({ list: [{ Id: 2 }, { Id: 3 }], pageInfo: { isLastPage: true } })
    await expect(lireEtatCohorte('test')).rejects.toThrow('ambiguë')
  })
  test('une panne de la base ne devient pas un tableau vide', async () => {
    globalThis.fetch = async () => new Response('down', { status: 503 })
    await expect(lireEtatCohorte('test')).rejects.toThrow('NocoDB 503')
  })
  test('une page répétée est une erreur explicite', async () => {
    globalThis.fetch = async () =>
      Response.json({ list: [{ Id: 2 }], pageInfo: { isLastPage: false } })
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
        const list =
          offset === 0
            ? [
                {
                  Id: 1,
                  fusionne_vers: 2,
                  etablissements_id: 7,
                  cohortes_id: 2,
                  code: 'CODE-ARCHIVE',
                },
              ]
            : [
                {
                  Id: 2,
                  fusionne_vers: null,
                  etablissements_id: 7,
                  cohortes_id: 2,
                  code: 'CANONIQUE',
                },
              ]
        return Response.json({ list, pageInfo: { isLastPage: offset === 1 } })
      }
      if (url.pathname.includes('mg12klh5zv7b5n5'))
        return Response.json({ list: [{ Id: 7, nom: 'École' }], pageInfo: { isLastPage: true } })
      expect(['merrsayuq3xb3uk', 'mzbpzuikti6h3pz'].some((t) => url.pathname.includes(t))).toBe(
        true,
      )
      expect(url.searchParams.get('where')).toBe('(participations_id,in,1,2)')
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
    [
      'cycle',
      [
        { Id: 1, fusionne_vers: 2, cohortes_id: 2 },
        { Id: 2, fusionne_vers: 1, cohortes_id: 2 },
      ],
    ],
    ['cible non entière', [{ Id: 1, fusionne_vers: 2.5, cohortes_id: 2 }]],
    ['cible zéro', [{ Id: 1, fusionne_vers: 0, cohortes_id: 2 }]],
    [
      'autre cohorte renvoyée',
      [
        { Id: 1, fusionne_vers: 2, cohortes_id: 2 },
        { Id: 2, cohortes_id: 3 },
      ],
    ],
    [
      'cohorte inconnue renvoyée',
      [
        { Id: 1, fusionne_vers: 2, cohortes_id: 2 },
        { Id: 2, cohortes_id: null },
      ],
    ],
    [
      'autre établissement',
      [
        { Id: 1, fusionne_vers: 2, cohortes_id: 2 },
        { Id: 2, cohortes_id: 2, etablissements_id: 8 },
      ],
    ],
  ])('%s : aucun résultat de suivi partiel', async (_, rows) => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input))
      if (url.pathname.includes('m5ayop8ul8s040l'))
        return Response.json({ list: [{ Id: 2 }], pageInfo: { isLastPage: true } })
      expect(url.pathname).toContain('mbunbu0f1zztce4')
      return Response.json({
        list: rows.map((p) => ({ etablissements_id: 7, ...p })),
        pageInfo: { isLastPage: true },
      })
    }
    await expect(lireEtatCohorte('synthetic')).rejects.toThrow('incohérente')
  })
})

// All data here is invented; no client identities or source rows.
const source = () => ({
  version: 1,
  source: { spreadsheetId: 'synthetic-sheet', rows: [2], readAt: '2026-09-22T12:00:00.000Z' },
  receivedAt: '2026-09-21',
  formation: {
    start: '2026-10-01',
    end: '2027-03-01',
    kind: 'previsionnelle',
    format: 'Présentiel',
    planning: 'Les jeudis',
    issues: [],
  },
  declaredTrainers: [{ name: 'Dominique Déclaration', email: 'hidden@example.test' }],
  participants: { declared: 'Deux adultes', unresolved: ['Mme Exemple'], importedCount: 1 },
})
const note = (c) =>
  `Note privée antérieure.\n[EUNEOS_CONTACT_V1]\n${JSON.stringify(c)}\n[/EUNEOS_CONTACT_V1]\nNote privée postérieure.`

describe('Contrat de provenance contact V1', () => {
  test('projette uniquement les données autorisées, conserve déclaré distinct d’affecté', () => {
    const parsed = lireSourceContact(note(source()))
    expect(parsed.invalide).toBe(false)
    expect(parsed.contact.declaredTrainers).toEqual(['Dominique Déclaration'])
    expect(parsed.contact.formation.kind).toBe('previsionnelle')
    expect(parsed.contact.participants.unresolved).toEqual(['Mme Exemple'])
    expect(JSON.stringify(parsed)).not.toMatch(/hidden@example|Note privée|synthetic-sheet/)
  })
  test('masque également les emails accidentels dans les champs libres', () => {
    const c = source()
    c.formation.planning = 'Écrire à hidden@example.test'
    c.participants.declared = 'person@example.test'
    expect(JSON.stringify(lireSourceContact(note(c)))).not.toContain('@')
  })
  test.each([
    ['JSON tronqué', '[EUNEOS_CONTACT_V1] { [/EUNEOS_CONTACT_V1]'],
    ['deux blocs', note(source()) + note(source())],
    ['fin sans début', '[/EUNEOS_CONTACT_V1]'],
    ['marqueurs inversés', '[/EUNEOS_CONTACT_V1][EUNEOS_CONTACT_V1]'],
    ['version inconnue', note({ ...source(), version: 2 })],
    ['date impossible', note({ ...source(), receivedAt: '2026-02-31' })],
    [
      'effectif négatif',
      note({ ...source(), participants: { ...source().participants, importedCount: -1 } }),
    ],
    [
      'formateur sans nom',
      note({ ...source(), declaredTrainers: [{ email: 'hidden@example.test' }] }),
    ],
    ['lignes non entières', note({ ...source(), source: { ...source().source, rows: [2.5] } })],
    [
      'source sans fuseau',
      note({ ...source(), source: { ...source().source, readAt: '2026-09-22T12:00:00' } }),
    ],
  ])('%s reste une anomalie explicite', (_, notes) => {
    expect(lireSourceContact(notes)).toEqual({ contact: null, invalide: true })
  })
  test('accepte les timestamps du producteur Python et ignore les extensions privées', () => {
    const c = source()
    c.receivedAt = '2026-09-02T13:01:00+02:00'
    c.source.readAt = '2026-09-22T19:00:00.123456+00:00'
    c.sourceResponses = [{ email: 'private@example.test' }]
    c.participants.identityNotes = ['Note privée']
    c.formation.validationSource = 'Source détaillée privée'
    const parsed = lireSourceContact(note(c))
    expect(parsed.invalide).toBe(false)
    expect(parsed.contact.receivedAt).toBe('2026-09-02')
    expect(parsed.contact.readAt).toBe('2026-09-22T19:00:00.123456+00:00')
    expect(JSON.stringify(parsed)).not.toMatch(
      /sourceResponses|identityNotes|validationSource|private@example|Note privée/,
    )
  })
  test.each(['2026-09-22T24:00:00Z', '2026-02-31T00:00:00Z', '2026-09-22T13:00:00'])(
    'refuse le timestamp invalide %s',
    (readAt) => {
      const c = source()
      c.source.readAt = readAt
      expect(lireSourceContact(note(c)).invalide).toBe(true)
    },
  )
  test('une note humaine ordinaire ne devient pas une fiche contact', () => {
    expect(lireSourceContact('Formatrice citée dans un email')).toEqual({
      contact: null,
      invalide: false,
    })
  })
})

describe('Dates et filtre opérationnel', () => {
  const now = new Date('2026-09-22T12:00:00Z')
  test.each([
    ['2026-09-22', true],
    ['2026-10-22', true],
    ['2026-10-23', false],
    ['2026-09-21', false],
    [null, false],
    ['2026-02-31', false],
  ])('%s est ou non dans les 30 jours calendaires', (date, attendu) => {
    expect(commenceDans30Jours({ date_debut_formation: date }, now)).toBe(attendu)
  })
  test('la date locale de Paris et le changement d’heure ne déplacent pas les bornes', () => {
    const midnight = new Date('2026-10-24T22:30:00Z') // 25 octobre à Paris
    expect(commenceDans30Jours({ date_debut_formation: '2026-10-24' }, midnight)).toBe(false)
    expect(commenceDans30Jours({ date_debut_formation: '2026-11-24' }, midnight)).toBe(true)
    expect(commenceDans30Jours({ date_debut_formation: '2026-11-25' }, midnight)).toBe(false)
  })
  test.each(['Abandonne', 'Refusé'])('ne compte pas un dossier %s', (statut) => {
    expect(commenceDans30Jours({ statut, date_debut_formation: '2026-10-01' }, now)).toBe(false)
  })
  test.each(['Terminée', 'Annulée'])('ne compte pas une formation %s', (statut_formation) => {
    expect(commenceDans30Jours({ statut_formation, date_debut_formation: '2026-10-01' }, now)).toBe(
      false,
    )
  })
  test('signale les dates impossibles, inversées et les conflits source sans les corriger', () => {
    expect(
      verifierDates({ date_debut_formation: '2026-10-10', date_fin_formation: '2026-03-15' }),
    ).toContain('La fin précède le début dans le dossier.')
    expect(verifierDates({ date_debut_formation: '2029-10-10' })).toContain(
      'Date hors des années de cette cohorte : à confirmer.',
    )
    expect(verifierDates({ date_fin_formation: '2026-02-31' })).toContain(
      'Date de fin invalide dans le dossier.',
    )
    const c = lireSourceContact(note(source())).contact
    expect(verifierDates({ date_debut_formation: '2026-10-02' }, c)).toContain(
      'Les dates du dossier et de la fiche source diffèrent : à confirmer.',
    )
    expect(dateFormationFr(null)).toBe('Non renseignée')
    expect(dateFormationFr('2026-02-31')).toContain('invalide')
  })
  test('trie sans muter et place les dates manquantes à la fin', () => {
    const rows = [
      {
        id: 1,
        etablissement: 'Alpha',
        dateDebutFormation: null,
        anomaliesDates: [],
        commenceBientot: false,
      },
      {
        id: 2,
        etablissement: 'Zeta',
        dateDebutFormation: '2026-10-05',
        anomaliesDates: [],
        commenceBientot: true,
      },
      {
        id: 3,
        etablissement: 'Beta',
        dateDebutFormation: '2026-10-01',
        anomaliesDates: ['Conflit source'],
        commenceBientot: false,
      },
    ]
    expect(selectionnerDossiers(rows).map((l) => l.id)).toEqual([3, 2, 1])
    expect(selectionnerDossiers(rows, 'bientot').map((l) => l.id)).toEqual([2])
    expect(selectionnerDossiers(rows, 'dates').map((l) => l.id)).toEqual([3])
    expect(selectionnerDossiers(rows, 'sans-date').map((l) => l.id)).toEqual([1])
    expect(selectionnerDossiers(rows, 'tous', 'nom').map((l) => l.id)).toEqual([1, 3, 2])
    expect(rows[0].id).toBe(1)
  })
})

function mockOperations({
  adults = [],
  missions = [],
  dossiers,
  failTable,
  corruptTotal = false,
} = {}) {
  const data = {
    m5ayop8ul8s040l: [{ Id: 2 }],
    mbunbu0f1zztce4: dossiers ?? [
      {
        Id: 1,
        etablissements_id: 7,
        cohortes_id: 2,
        date_debut_formation: '2026-10-01',
        date_fin_formation: '2027-03-01',
        statut_formation: 'Prévisionnelle',
        notes: note(source()),
      },
    ],
    mg12klh5zv7b5n5: [{ Id: 7, nom: 'Établissement synthétique' }],
    merrsayuq3xb3uk: missions,
    mzbpzuikti6h3pz: adults,
    mblganql53o34gm: [{ Id: 10, prenom: 'Camille', nom: 'Affectation' }],
  }
  const requests = []
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input)),
      table = url.pathname.split('/')[4]
    expect(options.method).toBeUndefined()
    expect(options.cache).toBe('no-store')
    expect(url.searchParams.get('fields')).not.toMatch(/email|telephone/)
    requests.push({ table, offset: Number(url.searchParams.get('offset')) })
    if (table === failTable) return new Response('PRIVATE ERROR', { status: 503 })
    const rows = data[table]
    if (!rows) throw new Error('Unknown table')
    const offset = Number(url.searchParams.get('offset')),
      list = rows.slice(offset, offset + 1)
    return Response.json({
      list,
      pageInfo: {
        isLastPage: offset + list.length >= rows.length,
        totalRows: rows.length + (corruptTotal && table === 'mzbpzuikti6h3pz' ? 1 : 0),
      },
    })
  }
  return requests
}

describe('Lecture opérationnelle complète', () => {
  test('pagine les adultes, affiche les vrais noms reliés, distingue inscrits, formés et déclarés', async () => {
    const requests = mockOperations({
      adults: [
        { Id: 20, participations_id: 1, prenom: 'Alex', nom: 'Test', fonction: 'Enseignant' },
        { Id: 21, participations_id: 1, prenom: 'Lou', nom: 'Exemple' },
      ],
      missions: [
        { Id: 30, participations_id: 1, formateurs_id: 10, nb_adultes_formes: 9 },
        { Id: 31, participations_id: 1, formateurs_id: 99, statut: 'Annulée' },
      ],
    })
    const {
      lignes: [l],
    } = await lireEtatCohorte('synthetic', new Date('2026-09-22T12:00:00Z'))
    expect(l.adultesInscrits.map((a) => a.nom)).toEqual(['Alex Test', 'Lou Exemple'])
    expect(l.formateurs).toEqual([{ id: 10, nom: 'Camille Affectation' }])
    expect(l.contact.declaredTrainers).toEqual(['Dominique Déclaration'])
    expect(l.progression[8].texte).toContain('9 adulte(s)')
    expect(l.dateDebutFormation).toBe('2026-10-01')
    expect(l.dateFinFormation).toBe('2027-03-01')
    expect(l.statutFormation).toBe('Prévisionnelle')
    expect(l.commenceBientot).toBe(true)
    expect(requests.filter((r) => r.table === 'mzbpzuikti6h3pz').map((r) => r.offset)).toEqual([
      0, 1,
    ])
    expect(JSON.stringify(l)).not.toMatch(/hidden@example|Note privée/)
  })
  test.each(['mzbpzuikti6h3pz', 'merrsayuq3xb3uk', 'mblganql53o34gm'])(
    'une erreur %s ne produit pas un faux zéro',
    async (failTable) => {
      mockOperations({ failTable, missions: [{ Id: 30, participations_id: 1, formateurs_id: 10 }] })
      await expect(lireEtatCohorte('synthetic')).rejects.toThrow('503')
    },
  )
  test('un total serveur incomplet est refusé', async () => {
    mockOperations({ corruptTotal: true })
    await expect(lireEtatCohorte('synthetic')).rejects.toThrow('Pagination NocoDB incomplète')
  })
  test.each(['adults', 'missions'])(
    'des enfants %s restés sur une archive ne sont pas masqués',
    async (field) => {
      mockOperations({
        dossiers: [
          { Id: 1, etablissements_id: 7, cohortes_id: 2 },
          { Id: 2, etablissements_id: 7, cohortes_id: 2, fusionne_vers: 1 },
        ],
        [field]: [{ Id: 20, participations_id: 2 }],
      })
      await expect(lireEtatCohorte('synthetic')).rejects.toThrow('archive ou hors périmètre')
    },
  )
  test('une source contradictoire est visible mais exclue du filtre imminent', async () => {
    const c = source()
    c.formation.issues = ['Deux réponses contradictoires']
    mockOperations({
      dossiers: [
        {
          Id: 1,
          etablissements_id: 7,
          cohortes_id: 2,
          date_debut_formation: '2026-10-01',
          notes: note(c),
        },
      ],
    })
    const {
      lignes: [l],
    } = await lireEtatCohorte('synthetic', new Date('2026-09-22T12:00:00Z'))
    expect(l.anomaliesDates).toEqual(['Deux réponses contradictoires'])
    expect(l.commenceBientot).toBe(false)
  })
})
