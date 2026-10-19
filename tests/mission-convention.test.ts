import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { parseMissionPayload, submitConvention, getConvention, requestChanges, listConventions, normalizeStoredPayload, trainerAccountEmail } from '../src/lib/mission-convention'
import { contractText, generateContractPdf } from '../src/lib/mission-convention-pdf'
import { saveDraft, submitDraft, listDrafts } from '../src/lib/mission-convention-drafts'

const owner = { email: 'formateur@example.test', admin: false }
const admin = { email: 'candice@example.test', admin: true }
const mission = () => ({
  etablissement: 'Collège fictif', adresse: 'Toulouse', direction: 'Direction', referent: 'Référent', contact: 'contact@example.test',
  format: 'hybride', sessions: Array.from({ length: 8 }, (_, i) => ({ date: '2027-01-12', duree: 2, modalite: i < 4 ? 'distance' : 'presentiel' })),
  cas1: 'oui', classe: '4e', ateliers: 'février', cas2: 'non', periodeCas2: '', accordCas2: '',
})
const payload = () => ({
  nom: 'Camille Test', structure: 'Indépendant', identification: '123', adresse: 'Toulouse',
  email: owner.email, telephone: '0102030405', frais: 'aucun', detailsFrais: '', missions: [mission()],
})
function fixture() {
  const sql = new Database(':memory:')
  sql.exec(readFileSync(new URL('../migrations/interne/0009_conventions_mission.sql', import.meta.url), 'utf8'))
  sql.exec(readFileSync('migrations/interne/0012_mission_convention_drafts.sql', 'utf8'))
  const db = {
    prepare: (query: string) => ({ bind: (...params: unknown[]) => ({
      run: async () => ({ meta: { changes: sql.query(query).run(...params as []).changes } }),
      first: async <T>() => sql.query(query).get(...params as []) as T | null,
      all: async <T>() => ({ results: sql.query(query).all(...params as []) as T[] }),
    }) }),
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      sql.exec('BEGIN')
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results }
      catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  return { sql, db: db as Parameters<typeof submitConvention>[0] }
}

describe('convention de mission privée', () => {
  test('durées libres, fractions, formats courts et groupes distincts', () => {
    const year2 = {...payload(),missions:[{...mission(),volume:8,cas1:'non',format:'presentiel',sessions:Array.from({length:8},()=>({date:'2027-01-12',duree:1,modalite:'presentiel'}))}]}
    const parsedYear2 = parseMissionPayload(year2)
    expect(parsedYear2.missions[0].volume).toBe(8)
    const year2Text = contractText(parsedYear2,'Direction',300).join('\n')
    expect(year2Text).toContain('Animation des ateliers jeunes année 2 : 8 h')
    expect(year2Text).toContain('TOTAL PRÉVISIONNEL : 300 €')
    expect(year2Text).not.toContain('animer les 16 heures prévues')
    expect(year2Text).not.toContain('l’exécution complète des 16 heures')
    expect(year2Text).toContain('animer le volume prévu pour chaque mission à l’article 3')
    expect(() => parseMissionPayload({...year2,missions:[{...year2.missions[0],volume:16}]})).toThrow()
    expect(() => parseMissionPayload({...year2,missions:[{...year2.missions[0],volume:10}]})).toThrow()
    for (const durations of [[3,3,3,3,4], [1.5,2.5,3,4,5], [8,8], Array(16).fill(1)]) {
      const sessions = durations.map(duree => ({date:'2027-01-12',duree,modalite:'presentiel'}))
      expect(parseMissionPayload({...payload(),missions:[{...mission(),format:'presentiel',sessions}]}).missions[0].sessions).toHaveLength(durations.length)
    }
    for (const duree of [0,-1,NaN,Infinity,17]) expect(() => parseMissionPayload({...payload(),missions:[{...mission(),sessions:[{date:'2027-01-12',duree,modalite:'presentiel'}]}]})).toThrow()
    const groups = parseMissionPayload({...payload(),missions:[{...mission(),groupe:'Groupe 1'},{...mission(),groupe:'Groupe 2'}]})
    expect(contractText(groups,'Direction',0).join('\n')).toContain('Collège fictif — Groupe 2')
  })
  test('brouillon incomplet, contrôle de version, soumission unique et conservation', async () => {
    const {sql,db} = fixture()
    const id = crypto.randomUUID()
    const partial = {...payload(),structure:'',frais:'',missions:[{...mission(),sessions:[{date:'',duree:0,modalite:'presentiel'}],cas1:'',cas2:''}]}
    const draft = await saveDraft(db,owner,admin,id,0,partial,'Dates à compléter')
    expect(draft.revision).toBe(1)
    expect(await listDrafts(db,{email:'autre@example.test',admin:false},false)).toHaveLength(0)
    await expect(submitDraft(db,owner,id,1,partial)).rejects.toMatchObject({status:400})
    await saveDraft(db,owner,owner,id,1,partial,'Note revue')
    await expect(saveDraft(db,owner,owner,id,1,payload(),'')).rejects.toMatchObject({status:409})
    const submitted = await submitDraft(db,owner,id,2,payload())
    expect(submitted.state).toBe('submitted')
    expect(await listDrafts(db,owner,false)).toHaveLength(0)
    await expect(submitDraft(db,owner,id,2,payload())).rejects.toMatchObject({status:409})
    expect((sql.query('SELECT COUNT(*) AS n FROM mission_conventions').get() as {n:number}).n).toBe(1)
    expect((sql.query('SELECT COUNT(*) AS n FROM mission_convention_drafts').get() as {n:number}).n).toBe(1)
    sql.close()
  })
  test('validation serveur : calendrier de 16 h, hybride, établissements distincts et frais', () => {
    expect(trainerAccountEmail('FORMATEUR@example.test')).toBe(owner.email)
    expect(() => trainerAccountEmail('invalide')).toThrow()
    expect(parseMissionPayload(payload()).missions[0].sessions).toHaveLength(8)
    expect(() => parseMissionPayload({ ...payload(), email: 'invalide' })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [mission(), mission()] })).toThrow()
    const fourByFour = Array.from({length: 4}, (_, i) => ({date: '2027-01-12', duree: 4, modalite: i < 2 ? 'distance' : 'presentiel'}))
    const mixed = [4, 4, 2, 2, 2, 2].map((duree, i) => ({date: '2027-01-12', duree, modalite: i < 2 ? 'distance' : 'presentiel'}))
    const twelveFour = Array.from({length:4}, (_, i) => ({date:'2027-01-12',duree:4,modalite:i === 3 ? 'distance' : 'presentiel'}))
    expect(parseMissionPayload({ ...payload(), missions: [{...mission(), sessions: fourByFour}] }).missions[0].sessions).toHaveLength(4)
    expect(parseMissionPayload({ ...payload(), missions: [{...mission(), sessions: mixed}] }).missions[0].sessions).toHaveLength(6)
    expect(parseMissionPayload({ ...payload(), missions: [{...mission(), sessions: twelveFour}] }).missions[0].sessions).toHaveLength(4)
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: mission().sessions.slice(1) }] })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), format: 'presentiel' }] })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), frais: 'demande' })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: fourByFour.map(s => ({...s, duree: 3})) }] })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: fourByFour.map(s => ({...s, modalite: 'distance'})) }] })).toThrow()
    expect(() => parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: fourByFour.slice(1) }] })).toThrow()
  })
  test('une ancienne convention 8 × 2 h reste lisible et corrigeable sans les anciennes heures', () => {
    const stored = {...payload(), missions: [{...mission(), sessions: mission().sessions.map(({duree, ...s}) => ({...s, heure: '09:00'}))}]}
    const normalized = normalizeStoredPayload(JSON.stringify(stored))
    expect(normalized.missions[0].sessions).toHaveLength(8)
    expect(normalized.missions[0].sessions[0]).toEqual({date:'2027-01-12',duree:2,modalite:'distance'})
    expect(parseMissionPayload(normalized).missions[0].sessions).toHaveLength(8)
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
    expect(text).toContain('maximum 8 sessions d’environ 2 heures (autres modalités possibles, les préciser)')
    expect(text).not.toContain('09:00')
    expect(text).not.toContain('retournée par le/la Formateur·rice à wiseup@euneos.fr')
    expect(text).not.toContain('[ NOM DE L’ÉTABLISSEMENT ]')
    expect(text).not.toContain('[          ]')
    expect(text).not.toContain('[dates]')
    expect(text).not.toContain('[nom(s)')
    expect(text).toContain('Frais remboursables autorisés par EUNEOS : Train 2e classe, plafond 90 €')
    expect(text).toContain('SIREN : 105 557 425')
    expect(text).toContain('SIRET : 105 557 425 00011')
    expect(text).toContain('RNA : W313042230')
    expect(text).toContain('APE : 94.99Z - Autres organisations fonctionnant par adhésion volontaire')
    expect(text).toContain('ESS : Oui')
    expect(text).toContain('Fondée en avril 2026 — active au SIRENE depuis le 19 mai 2026')
    expect(text).toContain('FICHE RÉCAPITULATIVE DE LA MISSION')
    expect(text).not.toContain('VISA DE L’ÉTABLISSEMENT')
    expect(text).not.toContain('Date / cachet')
    expect(text).toContain('POUR EUNEOS — Candice Marro — présidente')
    expect(text).toContain('LE/LA FORMATEUR·RICE — Camille Test')
    expect(text).toContain('Période des séances : du 2027-01-12 au 2027-01-12')
    expect(text).toContain('Référent : Référent ; contact : contact@example.test')
    expect(text).toContain('Frais autorisés : Train 2e classe, plafond 90 €')
    const compact = parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: [
      {date:'2027-01-12',duree:4,modalite:'distance'}, {date:'2027-01-19',duree:4,modalite:'distance'},
      {date:'2027-02-02',duree:4,modalite:'presentiel'}, {date:'2027-02-09',duree:4,modalite:'presentiel'},
    ] }] })
    const compactText = contractText(compact, 'Candice Marro — présidente', 0).join('\n')
    expect(compactText).toContain('Séance 4 : 2027-02-09 ; 4 h ; présentiel')
    expect(compactText).not.toContain('Séance 5 :')
    const twelveFour = parseMissionPayload({ ...payload(), missions: [{ ...mission(), sessions: [
      {date:'2027-01-12',duree:4,modalite:'presentiel'}, {date:'2027-01-19',duree:4,modalite:'presentiel'},
      {date:'2027-02-02',duree:4,modalite:'presentiel'}, {date:'2027-02-09',duree:4,modalite:'distance'},
    ] }] })
    expect(contractText(twelveFour, 'Candice Marro — présidente', 0).join('\n')).toContain('12 h sur site + 4 h en visioconférence')
    const bytes = await generateContractPdf(data, 'Candice Marro — présidente', 0, readFileSync('public/fonts/OpenSans-convention.ttf'))
    expect(bytes.byteLength).toBeLessThan(750_000)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1)
  })
  test('le catalogue équipe et l’espace formateur pointent vers le même formulaire privé', () => {
    const catalogue = readFileSync('src/components/internal/FormCatalog.astro', 'utf8')
    const resources = readFileSync('src/pages/interne/ressources.astro', 'utf8')
    expect(catalogue).toContain('data-private-form="convention-mission"')
    expect(catalogue).toContain('value="https://euneos.fr/interne/ressources?convention=1"')
    expect(catalogue).toContain('href="/interne/convention-mission"')
    expect(resources).toContain('href="/interne/ressources?convention=1"')
    const resourceApi = readFileSync('src/pages/api/interne/ressources.ts', 'utf8')
    expect(resourceApi).toContain('conventionPost(context)')
    expect(resourceApi).toContain('conventionPut(context)')
  })
  test('aucun lien vers le Word modifiable ne figure dans le formulaire partagé', () => {
    const form = readFileSync('src/components/internal/MissionConvention.astro', 'utf8')
    expect(form).not.toContain('docs.google.com/document/d/')
    expect(form).toContain('Les 14 articles figurent dans le PDF finalisé')
  })
})
