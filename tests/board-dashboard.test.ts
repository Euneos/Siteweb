import { describe, expect, test } from 'bun:test'
import { generateKeyPair, SignJWT } from 'jose'
import { readBoardIdentity } from '../src/lib/board-access'
import { requireInternalAccess } from '../src/lib/internal-access'
import { buildBoardDashboard, boardResources } from '../src/lib/board-dashboard'
import { boardCohorts, boardParticipations, boardSchools, boardTrainers } from './fixtures/board-dashboard'

const now = new Date('2026-11-05T12:00:00Z')
const build = (rows: Parameters<typeof buildBoardDashboard>[1] = boardParticipations) => buildBoardDashboard(boardCohorts, rows, boardSchools, boardTrainers, now).periods.find(p => p.cohort === '2026–2027')!
describe('Synthèse CA : compteurs et projection privée', () => {
  test('conserve les formateurs au niveau régional quand la commune ne peut être placée', () => {
    const trainers = [1, 2, 3].map(Id => ({ Id, formateurs_id: Id, statut: 'Formateur validé' }))
    const people = [
      { Id: 1, ville: 'Guadeloupe', cp: '97129', region: 'Guadeloupe' },
      { Id: 2, ville: 'Lamentin', cp: '97129', region: 'Guadeloupe' },
      { Id: 3, ville: 'Morne-à-l’Eau', cp: '97129', region: 'Guadeloupe' },
    ]
    const d = buildBoardDashboard(boardCohorts, boardParticipations, boardSchools, trainers, now, people)
    expect(d.trainerLocations.filter(p => p.location?.territory === '971')).toHaveLength(3)
    expect(d.trainerLocations.filter(p => p.city.includes('repère régional'))).toHaveLength(2)
  })
  test('exclut archives et autre cohorte, distingue personnes, parcours et demandes', () => {
    const d = build()
    expect(d.total).toBe(8)
    expect(d.engaged).toBe(4)
    expect(d.trainers).toMatchObject({ people: 2, dossiers: 2, agreements: 2, unscoped: 1, inTraining: 1 })
    expect(d.evaluation).toEqual({ requested: 1, total: 4 })
    expect(d.schedule).toEqual({ pastStart: 1, futureStart: 2, unknownStart: 1 })
    expect(d.upcoming.map(s => s.date)).toEqual(['2026-11-19', '2026-11-20'])
    expect(d.attention).toEqual({ missingDocuments: 1, missingLocations: 1, duplicateSchools: 0, applicationsOver30Days: 1 })
    expect(d.locations.find(s => s.city === 'Fort-de-France')?.location?.territory).toBe('972')
  })
  test('ne compte pas deux fois une école avec deux dossiers engagés', () => {
    const d = build([...boardParticipations, { ...boardParticipations[0], Id: 11 }])
    expect(d.engaged).toBe(4)
    expect(d.engagedDossiers).toBe(5)
    expect(d.attention.duplicateSchools).toBe(1)
  })
  test('inclut les deux années sans compter deux fois une école, conserve les anciens formateurs sans cohorte', () => {
    const all = buildBoardDashboard(boardCohorts, boardParticipations, boardSchools, boardTrainers, now)
    expect(all.total).toBe(9)
    expect(all.engaged).toBe(4)
    expect(all.engagedDossiers).toBe(5)
    expect(all.attention.duplicateSchools).toBe(0)
    expect(all.periods.find(p => p.cohort === '2025–2026')?.engaged).toBe(1)
    expect(all.trainers.people).toBe(2)
    expect(all.trainers.promotions).toContainEqual({ label: 'Septembre 2025', count: 1 })
  })
  test('ne déduit aucun engagement d’un ancien statut ni d’une date', () => {
    const d = build([{ Id: 20, cohortes_id: 1, etablissements_id: 1, statut: '', statut_origine: 'Établissement engagé', date_debut_formation: '2026-10-01' }])
    expect(d.engaged).toBe(0)
    expect(d.unqualified).toBe(1)
  })
  test('ne transmet pas de notes, emails ou champs inconnus, même ajoutés à la source', () => {
    const d = build(boardParticipations.map(p => ({ ...p, notes: 'SECRET-NOTE', email: 'SECRET-EMAIL', extra: 'SECRET-EXTRA' })))
    expect(JSON.stringify(d)).not.toContain('SECRET')
    expect(d.locations.every(s => !('Id' in s))).toBe(true)
  })
  test('carte formateurs : toutes promotions validées, une seule fois par personne et sans identité', () => {
    const d = buildBoardDashboard(boardCohorts, boardParticipations, boardSchools, boardTrainers, now, [
      { Id: 1, ville: 'Toulouse', cp: '31000', nom: 'SECRET', email: 'SECRET' },
      { Id: 2, ville: 'Paris', cp: '75001' },
      { Id: 3, ville: 'Paris', cp: '75001' },
    ])
    expect(d.trainerLocations).toHaveLength(2)
    expect(d.trainerLocations.filter(p => p.location)).toHaveLength(2)
    expect(JSON.stringify(d.trainerLocations)).not.toContain('SECRET')
    expect(d.trainerLocations.some(p => p.name === 'Septembre 2025')).toBe(true)
  })
  test('refuse les cohortes ambiguës et les archives orphelines', () => {
    expect(() => buildBoardDashboard([...boardCohorts, { ...boardCohorts[0], Id: 3 }], [], [], [], now)).toThrow()
    expect(() => build([{ Id: 30, fusionne_vers: 99 }])).toThrow()
  })
  test('dates invalides et chaînes false ne deviennent pas des confirmations', () => {
    const d = build([{ ...boardParticipations[0], date_debut_formation: '2026-02-30', evaluation_jeunes_demandee: 'false', fiche_contact_recue: 'false' }])
    expect(d.schedule.unknownStart).toBe(1)
    expect(d.evaluation.requested).toBe(0)
    expect(d.attention.missingDocuments).toBe(1)
  })
  test('une école orpheline reste signalée sans gonfler l’objectif, une base vide reste vide', () => {
    const orphan = build([{ ...boardParticipations[0], etablissements_id: 999 }])
    expect(orphan.engaged).toBe(0)
    expect(orphan.engagedDossiers).toBe(1)
    expect(orphan.attention.duplicateSchools).toBe(1)
    const empty = buildBoardDashboard(boardCohorts, [], [], [], now)
    expect(empty.engaged).toBe(0)
    expect(empty.total).toBe(0)
    expect(empty.upcoming).toEqual([])
  })
  test('catalogue : uniquement projection explicite et liens HTTPS non opérationnels', () => {
    const rows = ['https://example.org/support', 'javascript:alert(1)', 'https://user:secret@example.org', 'https://euneos.fr/interne/convention-mission'].map(url => ({ title: 'Ressource', url, secret: 'NE-PAS-TRANSMETTRE' }))
    expect(boardResources(rows)).toEqual([{ title: 'Ressource', category: '', description: '', url: 'https://example.org/support' }])
  })
})

const { privateKey, publicKey } = await generateKeyPair('RS256')
const domain = 'board-fixture.cloudflareaccess.com'
const env = { INTERNAL_ACCESS_DOMAIN: domain, INTERNAL_ACCESS_AUD: 'team', RESOURCE_ACCESS_DOMAIN: domain, RESOURCE_ACCESS_AUD: 'trainers', BOARD_ACCESS_DOMAIN: domain, BOARD_ACCESS_AUD: 'board' }
const locals = { runtime: { env } }
const keys = async () => publicKey
const request = async (aud: string, expiration = '5m') => new Request('https://direct.pages.dev/interne/ca', { headers: { 'Cf-Access-Jwt-Assertion': await new SignJWT({ email: 'member@example.test' }).setProtectedHeader({ alg: 'RS256' }).setSubject('member').setAudience(aud).setIssuer(`https://${domain}`).setExpirationTime(expiration).sign(privateKey) } })
describe('Audience CA cloisonnée', () => {
  test('CA et équipe autorisés, sans rôle administrateur', async () => {
    for (const role of ['board', 'team']) expect(await readBoardIdentity(await request(role), locals, keys)).toEqual({ email: 'member@example.test' })
  })
  test('formateur, visiteur et jeton expiré refusés', async () => {
    for (const r of [await request('trainers'), await request('board', '-1m'), new Request('https://euneos.fr/interne/ca')]) {
      const result = await readBoardIdentity(r, locals, keys)
      expect(result instanceof Response && result.status).toBe(403)
    }
  })
  test('le JWT CA ne donne accès ni à l’équipe ni à la bibliothèque/conventions', async () => {
    const r = await request('board')
    expect((await requireInternalAccess(r, env, keys))?.status).toBe(403)
    expect((await requireInternalAccess(r, { INTERNAL_ACCESS_DOMAIN: domain, INTERNAL_ACCESS_AUD: 'trainers' }, keys))?.status).toBe(403)
  })
  test('configuration absente ou réutilisant une audience fermée par défaut', async () => {
    for (const aud of ['', 'trainers', 'team']) {
      const result = await readBoardIdentity(await request('board'), { runtime: { env: { ...env, BOARD_ACCESS_AUD: aud } } }, keys)
      expect(result instanceof Response && result.status).toBe(503)
    }
  })
})
