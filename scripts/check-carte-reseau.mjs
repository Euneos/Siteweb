import assert from 'node:assert/strict'
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import * as compiledPage from '../dist/_worker.js/pages/interne/ressources.astro.mjs'
import { GET as resourcesGet } from '../src/pages/api/interne/ressources'
import { construireReseauFormateurs } from '../src/lib/reseau-formateurs'

// Compiled page, signed local test identity and mocked base. Never sends email,
// changes records, weakens production auth or accesses any real external service.
const output = process.env.CHECK_SCREENSHOTS
assert(output, 'Définir CHECK_SCREENSHOTS')
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'network-test', alg: 'RS256' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'network-team.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'team',
  RESOURCE_ACCESS_DOMAIN: 'network-resource.cloudflareaccess.com', RESOURCE_ACCESS_AUD: 'resources',
  TEAM_WORKSPACE: {}, NOCODB_TOKEN: 'synthetic-not-a-real-secret',
}
const token = await new SignJWT({ email: 'trainer@example.test' }).setSubject('network-test')
  .setProtectedHeader({ alg: 'RS256', kid: 'network-test' })
  .setIssuer(`https://${env.RESOURCE_ACCESS_DOMAIN}`).setAudience('resources').setExpirationTime('2h').sign(privateKey)
const personnes = [
  { Id: 1, prenom: 'Camille', nom: 'Exemple', ville: 'Rennes', cp: '35000', email: 'PRIVATE-EMAIL' },
  { Id: 2, prenom: 'Sam', nom: 'Exemple', ville: 'Draguignan', cp: '83300' },
  { Id: 3, prenom: 'Alex', nom: 'Exemple', ville: 'Toulouse', cp: '31000' },
  { Id: 4, prenom: 'Alix', nom: 'Exemple', ville: 'Guadeloupe', cp: null },
  { Id: 5, prenom: 'Robin', nom: '<img src=x onerror=alert(1)>', ville: 'Ville non précisée', cp: null },
  { Id: 6, prenom: 'Lou', nom: 'Exemple', ville: 'Bruxelles', cp: null },
  { Id: 7, prenom: 'Charlie', nom: 'Exemple', ville: 'Anvers', cp: null },
]
const parcours = personnes.map((p, i) => ({ Id: p.Id, formateurs_id: p.Id, cohortes_id: null, fusionne_vers: null, promotion: i ? 'Avril 2026' : 'Septembre 2025', statut: i === 6 ? 'En cours de formation' : i === 2 ? 'Formateur en cours de validation' : 'Formateur validé' }))
const locations = { '4': { territory: '971' }, '6': { outside: 'Bruxelles, Belgique' }, '7': { place: 'BE-11002' } }
env.RESOURCE_NETWORK_LOCATIONS = JSON.stringify(locations)
env.RESOURCE_NETWORK_RESIDENCES = JSON.stringify({ '2': { commune: '35238' } })
let reads = 0
let failing = false
const tables = { mblganql53o34gm: personnes, mom9m2q83nainyz: parcours }
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input))
  if ([env.INTERNAL_ACCESS_DOMAIN, env.RESOURCE_ACCESS_DOMAIN].includes(url.hostname)) return Response.json({ keys: [jwk] })
  assert.equal(url.hostname, 'app.nocodb.com')
  assert(!options.method || options.method === 'GET')
  reads++
  if (failing) return new Response('PRIVATE-ERROR', { status: 503 })
  const table = Object.keys(tables).find(id => url.pathname.includes(id))
  assert(table)
  const offset = Number(url.searchParams.get('offset'))
  return Response.json({ list: tables[table].slice(offset, offset + 2), pageInfo: { isLastPage: offset + 2 >= tables[table].length } })
}
const request = auth => new Request('https://network.test/api/interne/ressources?reseau=1', { headers: auth ? { 'Cf-Access-Jwt-Assertion': auth } : {} })
const context = auth => ({ request: request(auth), locals: { runtime: { env } } })
assert.equal((await resourcesGet(context())).status, 403)
assert.equal(reads, 0)
const api = await resourcesGet(context(token))
assert.equal(api.status, 200)
assert.match(api.headers.get('Cache-Control'), /no-store/)
assert.match(api.headers.get('X-Robots-Tag'), /noindex/)
let data = await api.json()
assert.equal(data.members.length, 5)
assert(data.members.every(member => member.statut === 'Formateur validé'))
assert.equal(data.members.find(member => member.id === 2).location.name, 'Rennes')
assert(!JSON.stringify(data.members.find(member => member.id === 2)).includes('Draguignan'))
assert(data.members.every(member => !('annee' in member) && !('promotion' in member)))
assert(!JSON.stringify(data).includes('Alex Exemple'))
assert(!JSON.stringify(data).includes('Charlie Exemple'))
assert(reads >= 6, 'Pagination de toutes les pages')
assert(!JSON.stringify(data).includes('PRIVATE-EMAIL'))
assert(!JSON.stringify(data).includes(env.NOCODB_TOKEN))
failing = true
const unavailable = await resourcesGet(context(token))
assert.equal(unavailable.status, 503)
assert(!JSON.stringify(await unavailable.json()).includes('PRIVATE-ERROR'))
failing = false
const filename = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(name => name.startsWith('manifest_'))
const { manifest } = await import(new URL(`../dist/_worker.js/${filename}`, import.meta.url))
const app = new App({ ...manifest, sessionConfig: undefined, pageMap: new Map([['src/pages/interne/ressources.astro', async () => compiledPage]]) })
const rendered = await app.render(new Request('https://network.test/interne/ressources', { headers: { 'Cf-Access-Jwt-Assertion': token } }), { locals: { runtime: { env } } })
assert.equal(rendered.status, 200)
const html = await rendered.text()
assert(!html.includes('Camille Exemple'), 'Les identités viennent seulement de l’API privée')
let browserFailure = false
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://network.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/interne/ressources') return route.fulfill({ contentType: 'text/html', body: html })
    if (url.searchParams.get('reseau') === '1') return route.fulfill({ status: browserFailure ? 503 : 200, json: browserFailure ? { error: 'Indisponible' } : data })
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { resources: [], identity: { email: 'trainer@example.test' } } })
    try { return route.fulfill({ body: await readFile(new URL(`../dist${url.pathname}`, import.meta.url)), contentType: url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.svg') ? 'image/svg+xml' : undefined }) }
    catch { return route.fulfill({ status: 404, body: '' }) }
  })
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('https://network.test/interne/ressources')
    await expect(page.locator('.resource-section[open]')).toHaveCount(0)
    await expect(page.locator('iframe')).toHaveCount(0)
    for (const summary of await page.locator('.resource-section > summary').all()) {
      await summary.focus()
      await page.keyboard.press('Enter')
      await expect(summary.locator('..')).toHaveAttribute('open', '')
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Rubrique ouverte à ${width}px`)
      await page.keyboard.press('Enter')
      await expect(summary.locator('..')).not.toHaveAttribute('open', '')
    }
    await page.locator('#replay-intervision > summary').click()
    await expect(page.locator('#replay-intervision a')).toHaveCount(2)
    await expect(page.locator('#replay-intervision a').nth(1)).toHaveAttribute('href', 'https://vimeo.com/1245480346/d12a11fedf?share=copy&fl=sv&fe=ci')
    if ([390, 1440].includes(width)) {
      await page.evaluate(() => scrollTo(0, 0))
      await page.screenshot({ path: `${output}/ressources-videos-${width}.png`, fullPage: true })
    }
    await page.locator('#documents-signer > summary').click()
    await page.locator('#documents-signer a[href="#guides-pratiques"]').click()
    await expect(page.locator('#guides-pratiques')).toHaveAttribute('open', '')
    await page.goto('https://network.test/interne/ressources#carte-reseau')
    await page.reload()
    await expect(page.locator('[data-network-content]')).toBeVisible()
    await expect(page.getByLabel('Cohorte', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Statut', { exact: true })).toHaveCount(0)
    await expect(page.locator('#trainer-network')).not.toContainText('Cohorte')
    await expect(page.locator('#trainer-network')).not.toContainText('En cours de formation')
    await expect(page.locator('#trainer-network')).not.toContainText('Validation en attente')
    await expect(page.locator('#trainer-network')).not.toContainText('Alex Exemple')
    await expect(page.locator('#trainer-network')).not.toContainText('Charlie Exemple')
    const colors = await page.locator('[data-network-legend] .trainer-network__swatch').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor))
    assert.deepEqual(colors, ['rgb(0, 56, 45)'])
    await expect(page.locator('[data-network-legend] li')).toHaveText(['Formateurs validés'])
    const shapeColors = await page.locator('[data-network-territory="metropole"] > g').evaluate(node => ({ fill: getComputedStyle(node).fill, stroke: getComputedStyle(node).stroke }))
    assert.deepEqual(shapeColors, { fill: 'rgb(128, 155, 150)', stroke: 'rgb(0, 56, 45)' })
    await expect(page.locator('#network-territory')).toHaveValue('metropole')
    await expect(page.locator('[data-network-points] button:visible')).toHaveCount(1)
    await expect(page.locator('[data-network-panel="971"]')).toBeHidden()
    await expect(page.locator('[data-network-panel="metropole"]')).toBeVisible()
    const marker = page.getByRole('button', { name: 'Rennes : 2 formateurs', exact: true })
    await marker.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-network-selection]')).toContainText('Camille Exemple')
    await expect(page.locator('[data-network-selection]')).toContainText('Sam Exemple')
    await expect(marker).toBeFocused()
    const box = await marker.boundingBox()
    assert(box.width >= 44 && box.height >= 44)
    await page.selectOption('#network-territory', '971')
    await expect(page.locator('[data-network-panel="metropole"]')).toBeHidden()
    await expect(page.locator('[data-network-panel="971"]')).toBeVisible()
    await page.getByRole('button', { name: 'Guadeloupe : 1 formateur', exact: true }).click()
    await expect(page.locator('[data-network-selection]')).toContainText('repère territorial')
    await expect(page.locator('#network-territory option[value="BE"]')).toHaveCount(0)
    await page.selectOption('#network-territory', '')
    await page.locator('.trainer-network__directory summary').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-network-list]')).toContainText('Bruxelles, Belgique')
    await expect(page.locator('[data-network-list] img')).toHaveCount(0)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Débordement à ${width}px`)
    await page.selectOption('#network-territory', '')
    await page.locator('.trainer-network__directory summary').click()
    if ([390, 1440].includes(width)) await page.locator('#carte-reseau').screenshot({ path: `${output}/carte-test-${width}.png` })
    console.log(`Carte : clavier, filtres, territoires et largeur ${width}px vérifiés`)
  }
  browserFailure = true
  await page.reload()
  await expect(page.locator('[data-network-retry]')).toBeVisible()
  await expect(page.locator('[data-network-content]')).toBeHidden()
  browserFailure = false
  await page.locator('[data-network-retry]').click()
  await expect(page.locator('[data-network-content]')).toBeVisible()
  assert.deepEqual(errors, [])
  // Optional private snapshot from MCP reads. Not versioned, not uploaded.
  if (process.env.NETWORK_SNAPSHOT) {
    const snapshot = JSON.parse(await readFile(process.env.NETWORK_SNAPSHOT, 'utf8'))
    data = Array.isArray(snapshot.members)
      ? { members: snapshot.members.filter(member => member.statut === 'Formateur validé'), updatedAt: snapshot.updatedAt }
      : construireReseauFormateurs(snapshot.personnes, snapshot.parcours, snapshot.locations)
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.reload()
      await expect(page.locator('[data-network-content]')).toBeVisible()
      await page.getByRole('button', { name: /Toulouse/ }).click()
      await expect(page.locator('[data-network-selection]')).toContainText('Candice Marro')
      await expect(page.locator('[data-network-panel="971"]')).toBeHidden()
      await page.locator('#carte-reseau').screenshot({ path: `${output}/carte-reseau-${width}.png` })
      await page.selectOption('#network-territory', '971')
      await page.locator('[data-network-panel="971"] [data-network-points] button').first().click()
      await page.locator('#carte-reseau').screenshot({ path: `${output}/carte-guadeloupe-${width}.png` })
      await page.selectOption('#network-territory', '')
    }
    console.log(`Aperçu privé : ${data.members.length} formateurs, ${data.members.filter(m => !m.location).length} sans point`)
  }
} finally { await browser.close() }

if (process.env.PREVIEW_PORT) {
  assert(process.env.NETWORK_SNAPSHOT, 'Un aperçu nominatif utilise une capture privée explicite')
  const server = Bun.serve({
    hostname: '127.0.0.1', port: Number(process.env.PREVIEW_PORT),
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method !== 'GET') return new Response('Aperçu en lecture seule.', { status: 405 })
      if (url.pathname === '/interne/ressources') return new Response(html.replace('<body', '<body data-preview="true"').replace('<main', '<p style="padding:12px;background:#f8c702;color:black;text-align:center">Aperçu local — non publié</p><main'), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } })
      if (url.pathname === '/api/interne/ressources' && url.searchParams.get('reseau') === '1') return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
      if (url.pathname.startsWith('/api/')) return Response.json({ resources: [], identity: { email: 'trainer@example.test' } })
      if (decodeURIComponent(url.pathname).includes('..')) return new Response('', { status: 404 })
      const file = Bun.file(new URL(`../dist${url.pathname}`, import.meta.url))
      return await file.exists() ? new Response(file) : new Response('', { status: 404 })
    },
  })
  console.log(`Aperçu local : http://127.0.0.1:${server.port}/interne/ressources#carte-reseau`)
}
