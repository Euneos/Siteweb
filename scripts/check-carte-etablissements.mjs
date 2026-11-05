import assert from 'node:assert/strict'
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import * as compiledPage from '../dist/_worker.js/pages/etat-candidatures.astro.mjs'
import { GET } from '../src/pages/api/interne/implantations'
import { construireReseauEtablissements } from '../src/lib/reseau-etablissements'
import { tables } from '../tests/fixtures/etat-candidatures.js'

// Signed synthetic identity, no external services or record writes.
const output = process.env.CHECK_SCREENSHOTS
assert(output)
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'schools-test', alg: 'RS256' }
const env = { INTERNAL_ACCESS_DOMAIN: 'schools.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'team', RESOURCE_ACCESS_DOMAIN: 'resources.cloudflareaccess.com', RESOURCE_ACCESS_AUD: 'resources', NOCODB_TOKEN: 'synthetic-token' }
const sign = (domain, audience) => new SignJWT({ email: 'test@example.test' }).setSubject('test').setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(`https://${domain}`).setAudience(audience).setExpirationTime('2h').sign(privateKey)
const token = await sign(env.INTERNAL_ACCESS_DOMAIN, 'team')
const resourceToken = await sign(env.RESOURCE_ACCESS_DOMAIN, 'resources')
tables.m5ayop8ul8s040l.unshift({ Id: 1, nom: '2025-2026', annee_debut: 2025, annee_fin: 2026 })
tables.mg12klh5zv7b5n5.push({ Id: 900, nom: 'École de démonstration', ville: 'Rennes', cp: '35000', email: 'PRIVATE-CONTACT' })
tables.mbunbu0f1zztce4.push({ Id: 900, code: 'DOS-TEST', etablissements_id: 900, cohortes_id: 1, statut_formation: 'Terminé', fusionne_vers: null })
for (const [index, statut_formation] of ['En cours', 'À préciser', 'Prévisionnelle', '', 'Programmée'].entries()) {
  tables.mbunbu0f1zztce4.push({ Id: 901 + index, code: `DOS-STATE-${index}`, etablissements_id: 900, cohortes_id: 2, statut_formation, fusionne_vers: null })
}
let reads = 0, failing = false
globalThis.fetch = async input => {
  const url = new URL(String(input))
  if ([env.INTERNAL_ACCESS_DOMAIN, env.RESOURCE_ACCESS_DOMAIN].includes(url.hostname)) return Response.json({ keys: [jwk] })
  assert.equal(url.hostname, 'app.nocodb.com')
  reads++
  if (failing) return new Response('PRIVATE-ERROR', { status: 503 })
  const table = Object.keys(tables).find(id => url.pathname.includes(id))
  assert(table)
  const offset = Number(url.searchParams.get('offset'))
  let source = tables[table]
  const where = url.searchParams.get('where') ?? ''
  if (table === 'm5ayop8ul8s040l' && where.includes('annee_debut,eq,2026')) source = source.filter(r => r.annee_debut === 2026)
  if (table === 'mbunbu0f1zztce4' && where.includes('cohortes_id,eq,2')) source = source.filter(r => r.cohortes_id === 2)
  return Response.json({ list: source.slice(offset, offset + 2), pageInfo: { isLastPage: offset + 2 >= source.length } })
}
const context = auth => ({ request: new Request('https://schools.test/api/interne/implantations?formes=1', { headers: auth ? { 'Cf-Access-Jwt-Assertion': auth } : {} }), locals: { runtime: { env } } })
assert.equal((await GET(context())).status, 403)
assert.equal((await GET(context(resourceToken))).status, 403)
assert.equal(reads, 0, 'Resource-only identities cannot read establishment data')
const response = await GET(context(token))
assert.equal(response.status, 200)
assert.match(response.headers.get('Cache-Control'), /private, no-store/)
let data = await response.json()
assert.equal(data.members.filter(m => m.etats.includes('terminee')).length, 1)
assert(data.members.some(m => m.dossiers.includes('DOS-TEST')))
assert(!JSON.stringify(data).includes('PRIVATE-CONTACT'))
assert(reads > 3, 'Full pagination')
failing = true
const unavailable = await GET(context(token))
assert.equal(unavailable.status, 503)
assert(!(await unavailable.text()).includes('PRIVATE-ERROR'))
failing = false
const filename = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(name => name.startsWith('manifest_'))
const { manifest } = await import(new URL(`../dist/_worker.js/${filename}`, import.meta.url))
const app = new App({ ...manifest, sessionConfig: undefined, pageMap: new Map([['src/pages/etat-candidatures.astro', async () => compiledPage]]) })
const rendered = await app.render(new Request('https://schools.test/etat-candidatures', { headers: { 'Cf-Access-Jwt-Assertion': token } }), { locals: { runtime: { env } } })
assert.equal(rendered.status, 200)
const html = await rendered.text()
assert(html.indexOf('id="carte-etablissements"') < html.indexOf('id="suivi"'))
const asset = async pathname => {
  if (decodeURIComponent(pathname).includes('..')) return new Response('', { status: 404 })
  const file = Bun.file(new URL(`../dist${pathname}`, import.meta.url))
  return await file.exists() ? new Response(file) : new Response('', { status: 404 })
}
let browserFailure = false
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://schools.test/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/etat-candidatures') return route.fulfill({ contentType: 'text/html', body: html })
    if (url.pathname === '/api/interne/implantations') return route.fulfill({ status: browserFailure ? 503 : 200, json: data })
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} })
    const response = await asset(url.pathname)
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
  })
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('https://schools.test/etat-candidatures#carte-etablissements')
    await expect(page.locator('[data-network-content]')).toBeVisible()
    await page.selectOption('#network-training', 'terminee')
    await expect(page.locator('#network-cohort option')).toHaveText(['Toutes les cohortes', 'Cohorte 2025-2026', 'Cohorte 2026–2027'])
    const marker = page.getByRole('button', { name: 'Rennes : 1 établissement', exact: true })
    await marker.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-network-selection]')).toContainText('DOS-TEST')
    await expect(marker).toBeFocused()
    const box = await marker.boundingBox()
    assert(box.width >= 44 && box.height >= 44)
    await page.selectOption('#network-cohort', '2')
    await expect(page.locator('[data-network-points] button')).toHaveCount(0)
    await expect(page.locator('[data-network-selection]')).toContainText('Aucun établissement')
    for (const [state, dossier] of [['en_cours', 'DOS-STATE-0'], ['a_programmer', 'DOS-STATE-1'], ['programmee', 'DOS-STATE-4']]) {
      await page.selectOption('#network-training', state)
      await page.getByRole('button', { name: 'Rennes : 1 établissement', exact: true }).click()
      await expect(page.locator('[data-network-selection]')).toContainText(dossier)
      const color = await page.getByRole('button', { name: 'Rennes : 1 établissement', exact: true }).locator('.trainer-network__swatch').evaluate(node => getComputedStyle(node).backgroundColor)
      assert.equal(color, { en_cours: 'rgb(252, 94, 39)', a_programmer: 'rgb(248, 199, 2)', programmee: 'rgb(242, 179, 240)' }[state])
      await expect(page.locator('[data-network-selection]')).not.toContainText('DOS-TEST')
      if (state === 'a_programmer') {
        await expect(page.locator('[data-network-selection]')).toContainText('DOS-STATE-2')
        await expect(page.locator('[data-network-selection]')).toContainText('DOS-STATE-3')
        await expect(page.locator('[data-network-selection]')).not.toContainText('DOS-STATE-4')
      }
    }
    await page.selectOption('#network-training', '')
    const mixed = await page.getByRole('button', { name: 'Rennes : 1 établissement', exact: true }).locator('.trainer-network__swatch').evaluate(node => getComputedStyle(node).backgroundImage)
    assert(mixed.includes('conic-gradient') && mixed.includes('rgb(252, 94, 39)') && mixed.includes('rgb(248, 199, 2)') && mixed.includes('rgb(242, 179, 240)'))
    await page.selectOption('#network-training', 'terminee')
    await page.selectOption('#network-cohort', '1')
    await expect(page.locator('[data-network-points] button')).toHaveCount(1)
    const colors = await page.locator('[data-network-legend] .trainer-network__swatch').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).backgroundColor))
    assert.deepEqual(colors, ['rgb(0, 56, 45)', 'rgb(252, 94, 39)', 'rgb(248, 199, 2)', 'rgb(242, 179, 240)'])
    await expect(page.locator('[data-network-legend] li')).toHaveText(['Formation terminée', 'Formation en cours', 'Formation à programmer', 'Formation programmée'])
    await page.locator('.trainer-network__directory summary').click()
    await expect(page.locator('[data-network-list]')).toContainText('DOS-TEST')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow ${width}`)
    console.log(`Établissements : filtres, clavier et placement vérifiés à ${width}px`)
  }
  browserFailure = true
  await page.reload()
  await expect(page.locator('[data-network-retry]')).toBeVisible()
  await expect(page.locator('[data-network-content]')).toBeHidden()
  browserFailure = false
  await page.locator('[data-network-retry]').click()
  await expect(page.locator('[data-network-content]')).toBeVisible()
  assert.deepEqual(errors, [])
  if (process.env.SCHOOL_SNAPSHOT) {
    const snapshot = JSON.parse(await readFile(process.env.SCHOOL_SNAPSHOT, 'utf8'))
    data = construireReseauEtablissements(snapshot.cohorts, snapshot.participations, snapshot.establishments)
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.reload()
      await expect(page.locator('[data-network-content]')).toBeVisible()
      await page.locator('[data-network-points] button').first().click()
      await page.locator('#carte-etablissements').screenshot({ path: `${output}/etablissements-${width}.png` })
    }
    console.log(`Aperçu réel : ${data.members.length} participations, ${data.members.filter(m => !m.location).length} sans point`)
  }
} finally { await browser.close() }
if (process.env.PREVIEW_PORT) {
  assert(process.env.SCHOOL_SNAPSHOT)
  Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PREVIEW_PORT), async fetch(request) {
    if (request.method !== 'GET') return new Response('', { status: 405 })
    const url = new URL(request.url)
    if (url.pathname === '/etat-candidatures') return new Response(html.replace('<main', '<p style="padding:12px;background:#f8c702;color:black;text-align:center">Aperçu local — non publié. Seule la carte utilise les données réelles ; le tableau reste une démonstration.</p><main'), { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store' } })
    if (url.pathname === '/api/interne/implantations') return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
    if (url.pathname.startsWith('/api/')) return Response.json({})
    return asset(url.pathname)
  } })
  console.log(`Aperçu http://127.0.0.1:${process.env.PREVIEW_PORT}/etat-candidatures#carte-etablissements`)
}
