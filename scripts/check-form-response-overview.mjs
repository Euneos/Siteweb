import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import * as pageModule from '../dist/_worker.js/pages/interne/formulaires.astro.mjs'

// Compiled page, synthetic responses only; no production transport.
const output = process.env.CHECK_SCREENSHOTS
if (!output) throw new Error('Set CHECK_SCREENSHOTS to the evidence directory')
await mkdir(output, { recursive: true })
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(n => n.startsWith('manifest_'))
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({ ...manifest, sessionConfig: undefined, pageMap: new Map([
  ['src/pages/interne/formulaires.astro', async () => pageModule],
]) })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'overview', alg: 'RS256', use: 'sig' }
const env = { INTERNAL_ACCESS_DOMAIN: 'overview.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'team', TEAM_WORKSPACE: {} }
const jwt = await new SignJWT({ email: 'team@example.test' }).setProtectedHeader({ alg: 'RS256', kid: 'overview' })
  .setSubject('fixture').setAudience('team').setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`).setExpirationTime('5m').sign(privateKey)
const realFetch = globalThis.fetch
let html
try {
  globalThis.fetch = async url => {
    assert.equal(new URL(String(url)).hostname, env.INTERNAL_ACCESS_DOMAIN)
    return Response.json({ keys: [jwk] })
  }
  const response = await app.render(new Request('https://euneos.fr/interne/formulaires', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), { locals: { runtime: { env } } })
  assert.equal(response.status, 200)
  html = await response.text()
} finally { globalThis.fetch = realFetch }
const fixture = { groups: { contact: { note: 'Démonstration : personnes et établissements fictifs.', rows: [
  { id: 'Réponse #3', name: 'Marie Dupont', school: 'Lycée Victor-Hugo', role: 'Référente', receivedAt: '2026-10-22T12:00:00Z', dossierId: 901 },
  { id: 'Réponse #2', name: 'Paul Martin', school: 'Collège Jean-Moulin', role: 'Référent', receivedAt: '2026-10-21T12:00:00Z', dossierId: 902 },
  { id: 'Réponse #1', name: '<img src=x onerror=alert(1)>', school: 'École Test', role: 'Référent', receivedAt: '2026-10-20T12:00:00Z' },
] }, 'bilan-formateur': { note: 'Démonstration fictive.', rows: [] } }, unavailable: { newsletter: 'Inscriptions suivies dans Brevo.' } }
let failure = false
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname
  if (path === '/interne/formulaires') return new Response(html, { headers: { 'Content-Type': 'text/html' } })
  if (path === '/api/interne/apercu-reponses') return failure ? new Response('', { status: 503 }) : Response.json(fixture)
  if (path === '/api/interne/formulaires') return Response.json({ enabled: true, dossiers: [], submissions: [], kinds: ['contact', 'deploiement', 'participants', 'activites-jeunes'] })
  if (/^\/(?:_astro|fonts)\//.test(path) || path === '/favicon.svg') return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
  return new Response('', { status: 404 })
} })
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  for (const width of [320, 390, 768, 860, 861, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`http://127.0.0.1:${server.port}/interne/formulaires`)
    const overview = page.locator('[data-response-kind="contact"]')
    await expect(overview.locator('summary')).toContainText('3 réponses reçues')
    await expect(overview.locator('.fc-responses-preview li')).toHaveCount(2)
    await expect(overview.locator('.fc-responses-preview li').first()).toContainText('Marie Dupont')
    await expect(page.locator('[data-response-kind="bilan-formateur"] summary')).toContainText('0 réponse reçue')
    await expect(page.locator('[data-response-kind="newsletter"]')).toContainText('Brevo')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`)
    if ([390, 1440].includes(width)) await page.locator('[data-catalog-kind="contact"]').screenshot({ path: `${output}/apercu-${width}.png` })
    await overview.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(overview.locator('details')).toHaveAttribute('open', '')
    await expect(overview.locator('.fc-responses-preview')).toBeHidden()
    await expect(overview.locator('.fc-responses-all li')).toHaveCount(3)
    await expect(overview.locator('.fc-responses-all li').first()).toContainText('Réponse #1')
    await expect(overview.locator('img')).toHaveCount(0)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Expanded overflow at ${width}`)
    await page.keyboard.press('Enter')
    await expect(overview.locator('.fc-responses-preview')).toBeVisible()
  }
  failure = true
  await page.locator('#links-refresh').click()
  await expect(page.locator('[data-response-kind="contact"]')).toContainText('momentanément indisponibles')
  await expect(page.locator('[data-response-kind="contact"] summary')).toHaveCount(0)
  assert.deepEqual(errors, [])
  console.log(`Response overview: 6 widths, keyboard expansion, full list order, empty/error states and escaped names verified. Screenshots: ${output}`)
} finally { await browser.close(); server.stop(true) }
