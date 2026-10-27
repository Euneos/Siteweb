import assert from 'node:assert/strict'
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'

// Compiled private page + real local SQL, synthetic accounts only.
const output = process.env.CHECK_SCREENSHOTS
if (output) await mkdir(output, { recursive: true })
const sql = new Database(':memory:')
for (const name of (await readdir('migrations/interne')).filter(n => n.endsWith('.sql')).sort()) sql.exec(await readFile(`migrations/interne/${name}`, 'utf8'))
const db = {
  batch: async statements => sql.transaction(() => statements.map(s => s.execute()))(),
  prepare: query => ({ bind: (...values) => ({
    first: async () => sql.query(query).get(...values),
    all: async () => ({ results: sql.query(query).all(...values) }),
    run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
    execute: () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
  }) }),
}
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'convention-local', alg: 'RS256', use: 'sig' }
const env = { INTERNAL_ACCESS_DOMAIN:'convention-local.cloudflareaccess.com', INTERNAL_ACCESS_AUD:'team', RESOURCE_ACCESS_DOMAIN:'convention-local.cloudflareaccess.com', RESOURCE_ACCESS_AUD:'trainers', INTERNAL_ADMIN_EMAILS:'manager@example.test', TEAM_WORKSPACE:db }
const token = await new SignJWT({ email:'trainer@example.test' }).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('synthetic').setAudience('trainers').setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`).setExpirationTime('30m').sign(privateKey)
const adminToken = await new SignJWT({email:'manager@example.test'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('synthetic-manager').setAudience('team').setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`).setExpirationTime('30m').sign(privateKey)
const originalFetch = globalThis.fetch
globalThis.fetch = async url => {
  assert.equal(String(url), `https://${env.INTERNAL_ACCESS_DOMAIN}/cdn-cgi/access/certs`)
  return Response.json({keys:[jwk]})
}
const worker = new URL('../dist/_worker.js/', import.meta.url)
const manifestName = (await readdir(worker)).find(n => n.startsWith('manifest_') && n.endsWith('.mjs'))
const { manifest } = await import(new URL(manifestName, worker))
const components = ['interne/ressources.astro','api/interne/ressources.ts','interne/convention-mission.astro','api/interne/conventions-mission.ts']
const pageMap = new Map(components.map(path => [`src/pages/${path}`, () => import(new URL(`pages/${path.replace(/\.(ts|astro)$/,'.astro.mjs')}`, worker))]))
const app = new App({...manifest, sessionConfig:undefined, pageMap})
const server = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
  const path = new URL(request.url).pathname
  if (path.startsWith('/_astro/') || path.startsWith('/fonts/')) return new Response(Bun.file(`dist${path}`))
  const headers = new Headers(request.headers); headers.set('Cf-Access-Jwt-Assertion',request.headers.get('X-Fixture-Role') === 'manager' ? adminToken : token)
  return app.render(new Request(request,{headers}),{locals:{runtime:{env}}})
}})
const id = crypto.randomUUID()
const mission = {etablissement:'Lycée fictif',groupe:'Année 2',adresse:'Adresse',direction:'Direction',referent:'Référent',contact:'contact@example.test',format:'presentiel',volume:8,sessions:Array.from({length:8},()=>({date:'',duree:1,modalite:'presentiel'})),cas1:'',classe:'',ateliers:'',cas2:'',periodeCas2:'',accordCas2:''}
const payload = {nom:'Camille Exemple',structure:'',identification:'',adresse:'',email:'trainer@example.test',telephone:'',frais:'',detailsFrais:'',missions:[mission]}
sql.query('INSERT INTO mission_convention_drafts(id,owner_email,payload,note,created_by) VALUES(?,?,?,?,?)').run(id,'trainer@example.test',JSON.stringify(payload),'Calendrier et coordonnées à compléter.','manager@example.test')
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage()
  const errors = []; page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.port}/interne/ressources?convention=1`)
  await expect(page.locator('#cm-overview')).toBeVisible()
  await expect(page.locator('#cm-form')).toBeHidden()
  await expect(page.locator('#cm-new')).toBeHidden()
  // Un ancien onglet ne peut pas créer une saisie parallèle au préremplissage.
  for (const body of [{action:'save-draft',id:crypto.randomUUID(),revision:0,payload,note:''},{action:'submit',payload}]) {
    const response = await page.evaluate(async body => {
      const r = await fetch('/api/interne/ressources?convention=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      return {status:r.status,body:await r.json()}
    },body)
    assert.equal(response.status,409)
    assert.match(response.body.error,/brouillon existe déjà/)
  }
  assert.equal(sql.query('SELECT count(*) AS n FROM mission_convention_drafts').get().n,1)
  await page.locator('#cm-index').getByRole('button',{name:'Compléter le brouillon',exact:true}).click()
  await expect(page.locator('[data-field="volume"]')).toHaveValue('8')
  await expect(page.locator('[data-session="duree"]').first()).toHaveValue('1')
  for (const width of [320,390,768,860,861,1440]) {
    await page.setViewportSize({width,height:900})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),true,`Overflow ${width}`)
    if (output && [390,1440].includes(width)) await page.locator('.cm-school').screenshot({path:`${output}/convention-${width}.png`})
  }
  await page.locator('#cm-save-draft').click()
  await expect(page.locator('#cm-state')).toContainText('Brouillon enregistré et relu')
  assert.equal(sql.query('SELECT revision FROM mission_convention_drafts WHERE id=?').get(id).revision,2)
  await page.locator('#cm-submit').click()
  assert.equal(sql.query('SELECT count(*) AS n FROM mission_conventions').get().n,0)
  for (const name of ['structure','identification','adresse','telephone']) await page.locator(`[name="${name}"]`).fill('Information fictive')
  await page.locator('[name="frais"]').selectOption('aucun')
  await page.locator('[data-field="cas1"]').selectOption('non')
  await page.locator('[data-field="cas2"]').selectOption('non')
  for (const input of await page.locator('[data-session="date"]').all()) await input.fill('2027-01-12')
  await page.locator('#cm-check').click()
  await expect(page.locator('#cm-feedback')).toContainText('Saisie complète')
  await page.locator('[data-field="volume"]').selectOption('16')
  await page.locator('.cm-pattern').selectOption('custom')
  for (const [i,input] of (await page.locator('[data-session="duree"]').all()).entries()) await input.fill(String([3,1.5,2.5,1,2,2,2,2][i]))
  await page.locator('#cm-check').click()
  await expect(page.locator('#cm-feedback')).toContainText('Saisie complète')
  // Outside funding accepts a distinct volume and excludes the standard fee.
  await page.locator('[data-field="financement"]').selectOption('externe')
  await page.locator('[data-field="financeur"]').fill('Organisme académique fictif')
  await page.locator('[data-field="volumeExterne"]').fill('18')
  await page.locator('[data-session="duree"]').first().fill('5')
  await page.locator('[data-field="cas1"]').selectOption('oui')
  await page.locator('[data-field="classe"]').fill('5e')
  await page.locator('[data-field="ateliers"]').fill('Dates à définir')
  await page.locator('#cm-check').click()
  await expect(page.locator('#cm-feedback')).toContainText('Saisie complète')
  await expect(page.locator('#cm-total')).toContainText('200,00')
  await expect(page.locator('#cm-total')).toContainText('0 € à la charge d’EUNEOS')
  for (const width of [390,860,861,1440]) {
    await page.setViewportSize({width,height:900})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),true,`Financement overflow ${width}`)
    if (output && [390,1440].includes(width)) await page.locator('.cm-school').screenshot({path:`${output}/financement-${width}.png`})
  }
  await page.locator('#cm-save-draft').click()
  await expect(page.locator('#cm-state')).toContainText('Il n’est pas encore soumis')
  await expect(page.locator('#cm-state')).not.toContainText('informations manquantes')
  await page.reload()
  await page.locator('#cm-index').getByRole('button',{name:'Compléter le brouillon',exact:true}).click()
  await expect(page.locator('[data-field="volumeExterne"]')).toHaveValue('18')
  await expect(page.locator('[data-field="financeur"]')).toHaveValue('Organisme académique fictif')
  await page.locator('#cm-check').click()
  await expect(page.locator('#cm-feedback')).toContainText('Saisie complète')
  page.on('dialog',dialog=>dialog.accept())
  await page.locator('#cm-submit').click()
  await expect(page.locator('#cm-state')).toContainText('Convention reçue')
  await expect(page.locator('#cm-form')).toBeHidden()
  await expect(page.locator('#cm-index')).toContainText('PDF non généré')
  assert.equal(sql.query('SELECT count(*) AS n FROM mission_conventions').get().n,1)
  assert.equal(sql.query('SELECT submitted_id FROM mission_convention_drafts WHERE id=?').get(id).submitted_id,id)
  const received = JSON.parse(sql.query('SELECT payload FROM mission_conventions WHERE id=?').get(id).payload)
  received.missions.push({...received.missions[0],etablissement:'Second collège fictif'})
  received.frais='demande'; received.detailsFrais='Impressions : 39,79 euros'
  sql.query('UPDATE mission_conventions SET payload=? WHERE id=?').run(JSON.stringify(received),id)
  const oldDraft=crypto.randomUUID()
  sql.query('INSERT INTO mission_convention_drafts(id,owner_email,payload,note,created_by) VALUES(?,?,?,?,?)').run(oldDraft,'trainer@example.test',JSON.stringify(received),'Ancien préremplissage','manager@example.test')
  await page.setExtraHTTPHeaders({'X-Fixture-Role':'manager'})
  await page.goto(`http://127.0.0.1:${server.port}/interne/convention-mission#convention-${id}`)
  const panel=page.locator(`#convention-${id}`)
  await expect(page.locator('#cm-form')).toBeHidden()
  await page.locator('#cm-filter').selectOption('submitted')
  await expect(page.locator('#cm-index [data-stage="draft"]')).toBeHidden()
  await expect(page.locator('#cm-results')).toHaveText('1 dossier(s) affiché(s).')
  await page.locator('#cm-search').fill('Second college')
  await expect(page.locator('#cm-results')).toHaveText('1 dossier(s) affiché(s).')
  await page.locator('#cm-search').fill('Absent')
  await expect(page.locator('#cm-results')).toHaveText('0 dossier(s) affiché(s).')
  await page.locator('#cm-search').fill('')
  await page.locator('#cm-filter').selectOption('')
  await page.locator(`#brouillon-${oldDraft}`).getByRole('button',{name:/Ouvrir la convention reçue/}).click()
  assert.equal(new URL(page.url()).hash,`#convention-${id}`)
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:900})
    if (output) await page.locator('#cm-overview').screenshot({path:`${output}/suivi-conventions-${width}.png`})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),true)
  }
  await expect(panel.locator(`#fees-details-${id}`)).toHaveValue('Impressions : 39,79 euros')
  await expect(panel.locator(`#fees-amount-${id}`)).toHaveValue('39.79')
  await expect(panel.locator(`#amount-${id}`)).toBeHidden()
  await panel.locator(`#fees-${id}`).selectOption('accord')
  await expect(panel.locator('.cm-review-total')).toContainText('439,79')
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:900})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),true,`Vérification overflow ${width}`)
    if (output) await panel.screenshot({path:`${output}/verification-${width}.png`})
  }
  await panel.getByRole('button',{name:'Enregistrer la vérification',exact:true}).click()
  await expect(page.locator('#cm-state')).toContainText('Vérification enregistrée et relue')
  await page.reload()
  await expect(panel.locator(`#fees-${id}`)).toHaveValue('accord')
  await expect(panel.locator(`#fees-amount-${id}`)).toHaveValue('39.79')
  await expect(panel.locator('.cm-review-total')).toContainText('439,79')
  await page.getByRole('button',{name:'Rattacher cet ancien brouillon à la convention reçue',exact:true}).click()
  await expect(page.locator('#cm-state')).toContainText('Ancien brouillon rattaché')
  assert.equal(sql.query('SELECT submitted_id FROM mission_convention_drafts WHERE id=?').get(oldDraft).submitted_id,id)
  assert.equal(sql.query('SELECT state FROM mission_conventions WHERE id=?').get(id).state,'submitted')
  received.missions[0]={...received.missions[0],financement:'euneos',volume:8,cas1:'non',sessions:[{date:'2027-01-12',duree:8,modalite:'presentiel'}]}
  sql.query("UPDATE mission_conventions SET state='changes_requested',payload=? WHERE id=?").run(JSON.stringify(received),id)
  await page.reload()
  await panel.locator(`#year2-${id}`).fill('500')
  await expect(panel.getByRole('button',{name:'Valider et générer le PDF',exact:true})).toHaveCount(0)
  await panel.getByRole('button',{name:'Enregistrer la vérification',exact:true}).click()
  await expect(page.locator('#cm-state')).toContainText('Vérification enregistrée et relue')
  await page.reload()
  await expect(panel.locator(`#year2-${id}`)).toHaveValue('500')
  assert.equal(sql.query('SELECT year2_euros FROM mission_conventions WHERE id=?').get(id).year2_euros,500)
  await panel.getByRole('button',{name:'Corriger la convention',exact:true}).click()
  await expect(page.locator('#cm-total')).toContainText('700,00')
  await expect(page.locator('#cm-total')).toContainText('500,00')
  await expect(page.locator('#cm-finance-link')).toBeVisible()
  await expect(page.locator('#cm-finance-link')).toHaveAttribute('href',`#year2-${id}`)
  await page.locator('[data-field="etablissement"]').first().fill('Autre lycée')
  await page.locator('[data-field="etablissement"]').first().blur()
  await expect(page.locator('#cm-total')).toContainText('rémunération à confirmer')
  await page.locator('#cm-close-form').click()
  for (const width of [390,860,861,1440]) {
    await page.setViewportSize({width,height:900})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),true)
    if (output && width===390) await panel.screenshot({path:`${output}/tarif-annee2-390.png`})
  }
  // Les PDF disponibles ont aussi un accès direct dans l'index, selon l'étape.
  sql.query("UPDATE mission_conventions SET state='approved' WHERE id=?").run(id)
  await page.reload()
  await expect(page.locator('#cm-index').getByRole('link',{name:'Télécharger le PDF validé',exact:true})).toHaveAttribute('href',`/api/interne/conventions-mission?id=${id}&kind=approved`)
  await page.locator('#cm-filter').selectOption('approved')
  await expect(page.locator('#cm-results')).toHaveText('1 dossier(s) affiché(s).')
  sql.query("UPDATE mission_conventions SET state='complete' WHERE id=?").run(id)
  await page.reload()
  await expect(page.locator('#cm-index').getByRole('link',{name:'Télécharger l’exemplaire contresigné',exact:true})).toHaveAttribute('href',`/api/interne/conventions-mission?id=${id}&kind=complete`)
  assert.deepEqual(errors,[])
  console.log('Conventions : brouillon incomplet, relecture, soumission, 8 h, durées libres et six largeurs vérifiés.')
} finally { await browser.close(); server.stop(true); sql.close(); globalThis.fetch = originalFetch }
