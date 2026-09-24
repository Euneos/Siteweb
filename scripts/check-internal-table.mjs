import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium } from '@playwright/test'
import { tables } from '../tests/fixtures/etat-candidatures.js'
import * as compiledPage from '../dist/_worker.js/pages/etat-candidatures.astro.mjs'

// Render the actual compiled page, with synthetic data and a local signing key.
// No credentials, external requests or production bypass are used.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-internal-table'
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'euneos-fixture.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'fixture-app',
  NOCODB_TOKEN: 'synthetic-token',
}
const jwt = await new SignJWT({ email: 'member@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .setSubject('fixture-user')
  .setAudience(env.INTERNAL_ACCESS_AUD)
  .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
  .setExpirationTime('10y')
  .sign(privateKey)
let dataReads = 0
let failData = false
let empty = false
let failTable = null
const RealDate = Date
// Freeze only the compiled page clock; the JWT is locally signed for this test.
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : ['2026-09-22T12:00:00Z']))
  }
  static now() {
    return RealDate.parse('2026-09-22T12:00:00Z')
  }
}
const realFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.hostname === env.INTERNAL_ACCESS_DOMAIN) return Response.json({ keys: [jwk] })
  assert.equal(url.hostname, 'app.nocodb.com', 'No unexpected network call')
  dataReads++
  if (failData) return new Response('unavailable', { status: 503 })
  const table = Object.keys(tables).find((id) => url.pathname.includes(id))
  assert(table, 'Known table only')
  if (table === failTable) return new Response('PRIVATE-UPSTREAM-DETAIL', { status: 503 })
  assert.doesNotMatch(url.searchParams.get('fields'), /email|telephone/)
  const source = empty && table === 'mbunbu0f1zztce4' ? [] : tables[table]
  const offset = Number(url.searchParams.get('offset'))
  const list = source.slice(offset, offset + 1) // server clamps even below requested size
  return Response.json({
    list,
    pageInfo: { isLastPage: offset + list.length >= source.length, totalRows: source.length },
  })
}
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(
  (f) => f.startsWith('manifest_') && f.endsWith('.mjs'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({
  ...manifest,
  sessionConfig: undefined,
  pageMap: new Map([['src/pages/etat-candidatures.astro', async () => compiledPage]]),
})
const render = (environment, token, query = '') =>
  app.render(
    new Request(`https://euneos.fr/etat-candidatures${query}`, {
      headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
    }),
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
assert.doesNotMatch(html, /synthetic-token/)
assert.doesNotMatch(html, /ARCHIVE-NON-COURANTE/)
assert.match(html, /member@example.test/)
assert.match(html, /Participants recensés/)
assert.match(html, /débuts dans les 30 jours · dates cohérentes/)
assert.match(html, /1 dossier aux\s+dates à confirmer/)
assert.doesNotMatch(html, /3 dossiers aux\s+dates à confirmer/)
assert.match(html, /Fiche contact reçue le 21\/09\/2026/)
assert.doesNotMatch(html, /Réponse du 21\/09\/2026/)
assert.match(html, /01\/10\/2026/)
assert.match(html, /01\/03\/2027/)
assert.match(html, /Prévisionnelle/)
assert.match(html, /Camille Affectation/)
assert.match(html, /Dominique Déclaration/)
assert.match(html, /Alex Exemple/)
assert.match(html, /Voir les 2 participants/)
assert.match(html, /1 identité\(s\) à compléter/)
assert.match(html, /12 adulte\(s\) déclaré\(s\) formé\(s\)/)
assert.match(html, /Deux dates contradictoires/)
assert.doesNotMatch(html, /secret@example|DO-NOT-EXPOSE|synthetic-sheet|<img src=x/)
for (const table of ['mzbpzuikti6h3pz', 'mblganql53o34gm']) {
  failTable = table
  const failed = await (await render(env, jwt)).text()
  assert.match(failed, /Données momentanément indisponibles/)
  assert.doesNotMatch(failed, /0<\/strong>|PRIVATE-UPSTREAM-DETAIL|Alex Exemple/)
}
failTable = null
const filtered = {}
for (const query of ['?filtre=bientot', '?filtre=dates', '?filtre=sans-date', '?tri=nom'])
  filtered[query] = await (await render(env, jwt, query)).text()
assert.match(filtered['?filtre=bientot'], /1 dossier\(s\) affiché\(s\)/)
assert.match(filtered['?filtre=dates'], /1 dossier\(s\) affiché\(s\)/)
assert.match(filtered['?filtre=sans-date'], /2 dossier\(s\) affiché\(s\)/)
failData = true
const errorHtml = await (await render(env, jwt)).text()
assert.match(errorHtml, /Données momentanément indisponibles/)
assert.doesNotMatch(errorHtml, /0<\/strong>/)
failData = false
empty = true
assert.match(await (await render(env, jwt)).text(), /Aucun dossier dans cette cohorte/)
globalThis.fetch = realFetch
globalThis.Date = RealDate

await writeFile(`${output}/tableau-demo.html`, html)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/' || path === '/etat-candidatures')
      return new Response(filtered[new URL(request.url).search.replace('&tri=debut', '')] ?? html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    if (path.includes('..')) return new Response('not found', { status: 404 })
    return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
  },
})
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
try {
  const tab = await browser.newPage({ reducedMotion: 'reduce' })
  for (const width of [320, 390, 768, 860, 861, 1024, 1440, 1920]) {
    await tab.setViewportSize({ width, height: 1000 })
    await tab.goto(`http://127.0.0.1:${server.port}/`)
    await tab.evaluate(() => document.fonts.ready)
    assert(
      await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    )
    assert(await tab.getByRole('banner').isVisible(), `Shared header at ${width}`)
    const navigation = tab.getByRole('navigation', { name: 'Espace interne' })
    assert(await navigation.isVisible(), `Internal navigation at ${width}`)
    assert.equal(
      await navigation
        .getByRole('link', { name: 'Suivi des établissements' })
        .getAttribute('aria-current'),
      'page',
    )
    assert.equal(
      await navigation.getByRole('link', { name: 'Calendriers de l’équipe' }).getAttribute('href'),
      '/interne',
    )
    assert.equal(
      await navigation.getByRole('link', { name: 'Implantations' }).getAttribute('href'),
      '/interne/implantations',
    )
    assert.equal(
      await navigation.getByRole('link', { name: 'Ressources formateurs' }).getAttribute('href'),
      '/interne/ressources',
    )
    const card = tab
      .locator('.etat__dossier')
      .filter({ has: tab.getByRole('heading', { name: 'Collège de démonstration', exact: true }) })
    assert(await card.getByText('01/10/2026', { exact: true }).isVisible())
    assert(await card.getByText('01/03/2027', { exact: true }).isVisible())
    assert(await card.getByText('Camille Affectation', { exact: true }).isVisible())
    assert(await card.getByText('Dominique Déclaration', { exact: true }).isVisible())
    await card.getByText('Voir les 2 participants', { exact: true }).click()
    assert(await card.getByText('Alex Exemple', { exact: false }).isVisible())
    assert.equal(await tab.evaluate(() => window.injected), undefined)
    assert(
      await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Expanded overflow at ${width}`,
    )
    const uncertain = tab
      .locator('.etat__dossier')
      .filter({
        has: tab.getByRole('heading', { name: 'École des dates à confirmer', exact: true }),
      })
    assert(
      await uncertain
        .getByText('Début déclaré (à confirmer) : 08/10/2026', { exact: true })
        .isVisible(),
    )
    assert(
      await uncertain
        .getByText('Fin déclarée (à confirmer) : 08/04/2026', { exact: true })
        .isVisible(),
    )
    assert.deepEqual(
      (await uncertain.locator('.etat__dates dd').allTextContents())
        .slice(0, 2)
        .map((t) => t.trim()),
      ['Non renseignée', 'Non renseignée'],
    )
    assert.equal(await uncertain.getByText('Début dans les 30 jours', { exact: true }).count(), 0)
    await tab.locator('.etat__progression > summary').click()
    assert.equal(
      await tab
        .getByRole('link', { name: '1 dossier aux dates à confirmer', exact: true })
        .getAttribute('href'),
      '/etat-candidatures?filtre=dates#formations',
    )
    assert.equal(await tab.locator('thead tr').count(), 2)
    assert.equal(await tab.locator('thead tr').last().locator('th').count(), 10)
    assert.equal(await tab.locator('tbody tr').first().locator('td').count(), 10)
    if (width <= 860) assert.equal(await tab.locator('.etat__mobile-label:visible').count(), 30)
    if ([390, 1440].includes(width)) {
      await tab.evaluate(() => window.scrollTo(0, 0))
      await tab.screenshot({ path: `${output}/page-${width}.png` })
      await tab.locator('.etat').screenshot({ path: `${output}/tableau-${width}.png` })
      await card.screenshot({ path: `${output}/dossier-${width}.png` })
      await uncertain.screenshot({ path: `${output}/dates-a-confirmer-${width}.png` })
    }
    await tab.getByRole('combobox', { name: /Afficher/ }).selectOption('bientot')
    await tab.getByRole('button', { name: 'Appliquer', exact: true }).click()
    await tab.waitForURL('**/?filtre=bientot&tri=debut#formations')
    // The form requests the same GET page; fixture server answers both orderings.
    assert.equal(await tab.locator('.etat__dossier').count(), 1)
    assert(
      await tab
        .locator('.etat__dossier')
        .getByText('Collège de démonstration', { exact: true })
        .isVisible(),
    )
    await tab.getByRole('link', { name: '1 dossier aux dates à confirmer', exact: true }).click()
    await tab.waitForURL('**/etat-candidatures?filtre=dates#formations')
    assert.equal(await tab.locator('.etat__dossier').count(), 1)
    assert(
      await tab
        .locator('.etat__dossier')
        .getByText('École des dates à confirmer', { exact: true })
        .isVisible(),
    )
    console.log(`Tableau compilé : ${width}px OK`)
  }
} finally {
  await browser.close()
  if (!process.env.KEEP_PREVIEW) server.stop()
}
if (process.env.KEEP_PREVIEW) console.log(`Rendu synthétique : http://127.0.0.1:${server.port}/`)
console.log(
  'Accès anonyme refusé avant toute lecture, accès signé, erreur source, état vide et responsive vérifiés.',
)
