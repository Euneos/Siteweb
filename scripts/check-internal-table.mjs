import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium } from '@playwright/test'
import * as compiledPage from '../dist/_worker.js/pages/etat-candidatures.astro.mjs'

// Render the actual compiled page, with synthetic data and a local signing key.
// No credentials, external requests or production bypass are used.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-internal-table'
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }
const env = { INTERNAL_ACCESS_DOMAIN: 'euneos-fixture.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'fixture-app', NOCODB_TOKEN: 'synthetic-token' }
const jwt = await new SignJWT({ email: 'member@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject('fixture-user')
  .setAudience(env.INTERNAL_ACCESS_AUD).setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`).setExpirationTime('5m').sign(privateKey)
let dataReads = 0
let failData = false
let empty = false
const realFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.hostname === env.INTERNAL_ACCESS_DOMAIN) return Response.json({ keys: [jwk] })
  assert.equal(url.hostname, 'app.nocodb.com', 'No unexpected network call')
  dataReads++
  if (failData) return new Response('unavailable', { status: 503 })
  let list = []
  if (url.pathname.includes('m5ayop8ul8s040l')) list = [{ Id: 2, nom: '2026–2027', annee_debut: 2026, annee_fin: 2027 }]
  else if (url.pathname.includes('mbunbu0f1zztce4')) list = empty ? [] : [
    { Id: 1, code: 'DEMO-01', statut: 'Engage', date_candidature: '2026-09-02', etablissements_id: 1, lettre_interet_signee: true, fiche_contact_recue: true },
    { Id: 2, code: 'DEMO-02', statut: 'Abandonne', etablissements_id: 2 },
  ]
  else if (url.pathname.includes('mg12klh5zv7b5n5')) list = [{ Id: 1, nom: 'Collège de démonstration', ville: 'Ville de test' }, { Id: 2, nom: 'Lycée de démonstration', ville: 'Ville de test' }]
  else if (url.pathname.includes('merrsayuq3xb3uk')) list = [{ Id: 1, participations_id: 1, formateurs_id: 1, statut: 'Terminee', nb_adultes_formes: 12 }]
  else throw new Error('Unexpected table')
  return Response.json({ list, pageInfo: { isLastPage: true } })
}
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(f => f.startsWith('manifest_') && f.endsWith('.mjs'))
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({ ...manifest, sessionConfig: undefined, pageMap: new Map([['src/pages/etat-candidatures.astro', async () => compiledPage]]) })
const render = (environment, token) => app.render(
  new Request('https://euneos.fr/etat-candidatures', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }),
  { locals: { runtime: { env: environment } } },
)
let response = await render({}, undefined)
assert.equal(response.status, 503)
response = await render(env, undefined)
assert.equal(response.status, 403)
assert.equal(dataReads, 0, 'Unauthorized requests must not read NocoDB')
response = await render(env, jwt)
assert.equal(response.status, 200)
assert.match(response.headers.get('Cache-Control'), /no-store/)
let html = await response.text()
assert.match(html, /Collège de démonstration/)
assert.match(html, /Envoi non documenté/)
assert.doesNotMatch(html, /synthetic-token|member@example.test/)
failData = true
const errorHtml = await (await render(env, jwt)).text()
assert.match(errorHtml, /Données momentanément indisponibles/)
assert.doesNotMatch(errorHtml, /0<\/strong>/)
failData = false; empty = true
assert.match(await (await render(env, jwt)).text(), /Aucun dossier dans cette cohorte/)
globalThis.fetch = realFetch

await writeFile(`${output}/tableau-demo.html`, html)
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/') return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  if (path.includes('..')) return new Response('not found', { status: 404 })
  return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
} })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
try {
  const tab = await browser.newPage({ reducedMotion: 'reduce' })
  for (const width of [320, 390, 768, 860, 861, 1024, 1440, 1920]) {
    await tab.setViewportSize({ width, height: 1000 })
    await tab.goto(`http://127.0.0.1:${server.port}/`)
    await tab.evaluate(() => document.fonts.ready)
    assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`)
    assert.equal(await tab.locator('thead tr').count(), 2)
    assert.equal(await tab.locator('thead tr').last().locator('th').count(), 10)
    assert.equal(await tab.locator('tbody tr').first().locator('td').count(), 10)
    if (width <= 860) assert.equal(await tab.locator('.etat__mobile-label:visible').count(), 20)
    if ([390, 1440].includes(width)) await tab.locator('.etat').screenshot({ path: `${output}/tableau-${width}.png` })
    console.log(`Tableau compilé : ${width}px OK`)
  }
} finally { await browser.close(); server.stop() }
console.log('Accès anonyme refusé avant toute lecture, accès signé, erreur source, état vide et responsive vérifiés.')
