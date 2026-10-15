import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { parseMissionPayload, submitConvention, getConvention, requestChanges, listConventions, trainerAccountEmail } from '../src/lib/mission-convention'
import { contractText, generateContractPdf } from '../src/lib/mission-convention-pdf'

const owner = { email: 'formateur@example.test', admin: false }
const admin = { email: 'candice@example.test', admin: true }
const mission = () => ({
  etablissement: 'Collège fictif', adresse: 'Toulouse', direction: 'Direction', referent: 'Référent', contact: 'contact@example.test',
  format: 'hybride', sessions: Array.from({ length: 8 }, (_, i) => ({ date: '2027-01-12', heure: '09:00', modalite: i < 4 ? 'distance' : 'presentiel' })),
  cas1: 'oui', classe: '4e', ateliers: 'février', cas2: 'non', periodeCas2: '', accordCas2: '',
})
const payload = () => ({
  nom: 'Camille Test', structure: 'Indépendant', identification: '123', adresse: 'Toulouse',
  email: owner.email, telephone: '0102030405', frais: 'aucun', detailsFrais: '', missions: [mission()],
})
function fixture() {
  const sql = new Database(':memory:')
  sql.exec(readFileSync(new URL('../migrations/interne/0009_conventions_mission.sql', import.meta.url), 'utf8'))
  const db = {
    prepare: (query: string) => ({ bind: (...params: unknown[]) => ({
      run: async () => ({ meta: { changes: sql.query(query).run(...params as []).changes } }),
      first: async <T>() => sql.query(query).get(...params as []) as T | null,
      all: async <T>() => ({ results: sql.query(query).all(...params as []) as T[] }),
    }) }),
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      throw new Error('Test de batch distinct')
    },
  }
  return { sql, db: db as Parameters<typeof submitConvention>[0] }
}

describe('convention de mission privée', () => {
  test('validation serveur : identité, huit sessions, hybride, établissements distincts et frais', () => {
    expect(trainerAccountEmail('FORMATEUR@example.test')).toBe(owner.email)
    expect(() => trainerAccountEmail('invalide')).toThrow()
    expect(parseMissionPayload(payload()).missions[0].sessions).toHaveLength(8)
    expect(() => parseMissionPayload({ ...payload(), email: 'invalide' })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [mission(), mission()] })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: mission().sessions.slice(1) }] })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), format: 'presentiel' }] })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), frais: 'demande' })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: mission().sessions.map(s => ({ ...s, heure: '23:00' })) }] })).toThrow()
  })
  test('une saisie faite par EUNEOS reste réservée au compte formateur désigné', async () => {
    const { sql, db } = fixture()
    const form = { ...payload(), email: 'adresse-professionnelle@example.test' }
    const saved = await submitConvention(db, { email: trainerAccountEmail(owner.email), admin: false }, form)
    expect(saved.owner_email).toBe(owner.email)
    expect((await listConventions(db, owner, false)).map(row => row.id)).toEqual([saved.id])
    expect((await listConventions(db, admin, false))).toHaveLength(0)
    expect((await listConventions(db, admin, true)).map(row => row.id)).toEqual([saved.id])
    sql.close()
  })
  test('isolement des formateurs et retour à la vérification après correction', async () => {
    const { sql, db } = fixture()
    const row = await submitConvention(db, owner, payload())
    expect(row.state).toBe('submitted')
    expect(await listConventions(db, { email: 'autre@example.test', admin: false }, false)).toHaveLength(0)
    await expect(getConvention(db, row.id, { email: 'autre@example.test', admin: false }, false)).rejects.toMatchObject({ status: 404 })
    await expect(submitConvention(db, owner, payload(), row.id)).rejects.toMatchObject({ status: 409 })
    const requested = await requestChanges(db, row.id, admin, 'Corrigez le contact')
    expect(requested.state).toBe('changes_requested')
    await expect(submitConvention(db, { email: 'autre@example.test', admin: false }, { ...payload(), email: 'autre@example.test' }, row.id)).rejects.toMatchObject({ status: 409 })
    expect((await submitConvention(db, owner, payload(), row.id)).state).toBe('submitted')
    sql.close()
  })
  test('PDF complet : 14 articles du modèle, plusieurs établissements et montant validé', async () => {
    const data = parseMissionPayload({ ...payload(), missions: [mission(), { ...mission(), etablissement: 'Lycée fictif', cas1: 'non' }] })
    const text = contractText(data, 'Candice Marro — présidente', 0, 'Train 2e classe, plafond 90 €').join('\n')
    for (let i = 1; i <= 14; i++) expect(text).toContain(`ARTICLE ${i} —`)
    expect(text).toContain('2 formation(s) × 1 000 € = 2000 €')
    expect(text).toContain('TOTAL PRÉVISIONNEL : 2200 €')
    expect(text).toContain('Lycée fictif')
    expect(text).not.toContain('retournée par le/la Formateur·rice à wiseup@euneos.fr')
    expect(text).not.toContain('[ NOM DE L’ÉTABLISSEMENT ]')
    expect(text).not.toContain('[          ]')
    expect(text).not.toContain('[dates]')
    expect(text).not.toContain('[nom(s)')
    expect(text).toContain('Frais remboursables autorisés par EUNEOS : Train 2e classe, plafond 90 €')
    const bytes = await generateContractPdf(data, 'Candice Marro — présidente', 0, readFileSync('public/fonts/OpenSans-convention.ttf'))
    expect(bytes.byteLength).toBeLessThan(750_000)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1)
  })
  test('le catalogue équipe et l’espace formateur pointent vers le même formulaire privé', () => {
    const catalogue = readFileSync('src/components/internal/FormCatalog.astro', 'utf8')
    const resources = readFileSync('src/pages/interne/ressources.astro', 'utf8')
    expect(catalogue).toContain('data-private-form="convention-mission"')
    expect(catalogue).toContain('value="https://euneos.fr/interne/convention-mission"')
    expect(catalogue).toContain('href="/interne/convention-mission"')
    expect(resources).toContain('href="/interne/convention-mission"')
  })
})
