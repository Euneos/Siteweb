import assert from 'node:assert/strict'
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium } from '@playwright/test'
import * as compiledPage from '../dist/_worker.js/pages/interne/ressources.astro.mjs'

// Recette locale du vrai rendu compilé, avec identité fictive et aucun accès distant.
const output = process.env.CHECK_SCREENSHOTS
assert(output, 'Définir CHECK_SCREENSHOTS')
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'agenda-test', alg: 'RS256' }
const env = { INTERNAL_ACCESS_DOMAIN: 'agenda-test.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'test', TEAM_WORKSPACE: {} }
const token = await new SignJWT({ email: 'trainer@example.test' }).setSubject('test-user').setProtectedHeader({ alg: 'RS256', kid: 'agenda-test' }).setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`).setAudience('test').setExpirationTime('5m').sign(privateKey)
globalThis.fetch = async (input) => {
  assert.equal(new URL(String(input)).hostname, env.INTERNAL_ACCESS_DOMAIN)
  return Response.json({ keys: [jwk] })
}
const filename = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find((name) => name.startsWith('manifest_'))
const { manifest } = await import(new URL(`../dist/_worker.js/${filename}`, import.meta.url))
const app = new App({ ...manifest, sessionConfig: undefined, pageMap: new Map([['src/pages/interne/ressources.astro', async () => compiledPage]]) })
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.route('https://agenda.test/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/interne/ressources') {
      const response = await app.render(new Request(url, { headers: { 'Cf-Access-Jwt-Assertion': token } }), { locals: { runtime: { env } } })
      assert.equal(response.status, 200)
      return route.fulfill({ status: 200, contentType: 'text/html', body: await response.text() })
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { resources: [], identity: { email: 'trainer@example.test' } } })
    try {
      return route.fulfill({ body: await readFile(new URL(`../dist${url.pathname}`, import.meta.url)), contentType: url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : undefined })
    } catch { return route.fulfill({ status: 404, body: '' }) }
  })
  for (const width of [320, 390, 860, 861, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('https://agenda.test/interne/ressources?mois=2026-11#agenda')
    await page.locator('#agenda').scrollIntoViewIfNeeded()
    assert.equal(await page.locator('.trainer-agenda__date').innerText(), '3\n●')
    assert(await page.locator('#agenda').innerText().then((text) => text.includes('18 h 30') && text.includes('20 h 30')))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Débordement à ${width}px`)
    await page.locator('#agenda').screenshot({ path: `${output}/agenda-${width}.png` })
    await page.getByRole('link', { name: 'Mois suivant', exact: true }).click()
    assert.equal(await page.locator('.trainer-agenda__date').innerText(), '8\n●')
    await page.getByRole('link', { name: /mardi 8 décembre/ }).click()
    assert(new URL(page.url()).hash.includes('formation-ateliers'))
    console.log(`Agenda et navigation vérifiés à ${width}px`)
  }
} finally { await browser.close() }
