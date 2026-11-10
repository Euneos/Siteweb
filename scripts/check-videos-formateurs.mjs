import assert from 'node:assert/strict'
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium } from '@playwright/test'
import * as compiledPage from '../dist/_worker.js/pages/interne/ressources.astro.mjs'

// Recette locale du rendu compilé : identité fictive, aucun appel métier réel.
const output = process.env.CHECK_SCREENSHOTS
assert(output, 'Définir CHECK_SCREENSHOTS')
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'videos-test', alg: 'RS256' }
const env = { INTERNAL_ACCESS_DOMAIN: 'videos-test.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'test', TEAM_WORKSPACE: {} }
const token = await new SignJWT({ email: 'trainer@example.test' }).setSubject('test-user').setProtectedHeader({ alg: 'RS256', kid: 'videos-test' }).setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`).setAudience('test').setExpirationTime('2h').sign(privateKey)
globalThis.fetch = async input => {
  assert.equal(new URL(String(input)).hostname, env.INTERNAL_ACCESS_DOMAIN)
  return Response.json({ keys: [jwk] })
}
const filename = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(name => name.startsWith('manifest_'))
const { manifest } = await import(new URL(`../dist/_worker.js/${filename}`, import.meta.url))
const app = new App({ ...manifest, middleware: () => import('../dist/_worker.js/_astro-internal_middleware.mjs'), sessionConfig: undefined, pageMap: new Map([['src/pages/interne/ressources.astro', async () => compiledPage]]) })
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'videos.test') return route.fulfill({ contentType: 'text/html', body: '<p>Lecteur Vimeo — aperçu de mise en page</p>' })
    if (url.pathname === '/interne/ressources') {
      const response = await app.render(new Request(url, { headers: { 'Cf-Access-Jwt-Assertion': token } }), { locals: { runtime: { env } } })
      assert.equal(response.status, 200)
      return route.fulfill({ headers: Object.fromEntries(response.headers), contentType: 'text/html', body: await response.text() })
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { resources: [], members: [], identity: { email: 'trainer@example.test' } } })
    try {
      return route.fulfill({ body: await readFile(new URL(`../dist${url.pathname}`, import.meta.url)), contentType: url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : undefined })
    } catch { return route.fulfill({ status: 404, body: '' }) }
  })
  for (const width of [320, 390, 860, 861, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('https://videos.test/interne/ressources#replay-intervision')
    const panel = page.locator('#replay-intervision')
    await panel.scrollIntoViewIfNeeded()
    assert.equal(await panel.locator('iframe').count(), 0)
    const links = panel.locator('a')
    assert.equal(await links.count(), 2)
    assert.equal(await links.nth(0).getAttribute('href'), 'https://vimeo.com/1243737710/aaf23ddfa2?share=copy&fl=sv&fe=ci')
    assert.equal(await links.nth(1).getAttribute('href'), 'https://vimeo.com/1245480346/d12a11fedf?share=copy&fl=sv&fe=ci')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Débordement à ${width}px`)
    for (const link of await links.all()) {
      assert.equal(await link.getAttribute('target'), '_blank')
      const box = await link.boundingBox()
      assert(box.width > 0 && box.height > 0 && box.x >= 0 && box.x + box.width <= width)
    }
    await panel.screenshot({ path: `${output}/videos-${width}.png` })
    console.log(`Deux liens Vimeo sans lecteur intégré vérifiés à ${width}px.`)
  }
} finally { await browser.close() }
