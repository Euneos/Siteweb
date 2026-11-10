import assert from 'node:assert/strict'
import { readdir, mkdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import { boardCohorts, boardParticipations, boardSchools, boardTrainers } from '../tests/fixtures/board-dashboard.ts'
import { NC } from '../src/lib/nocodb.ts'

const output = process.env.CHECK_SCREENSHOTS
if (output) await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'board-local', alg: 'RS256', use: 'sig' }
const domain = 'board-compiled.cloudflareaccess.com'
const env = { INTERNAL_ACCESS_DOMAIN: domain, INTERNAL_ACCESS_AUD: 'team', RESOURCE_ACCESS_DOMAIN: domain, RESOURCE_ACCESS_AUD: 'trainers', BOARD_ACCESS_DOMAIN: domain, BOARD_ACCESS_AUD: 'board', NOCODB_TOKEN: 'synthetic-token', TEAM_WORKSPACE: {
  prepare: sql => {
    assert.equal(sql, 'SELECT title,category,description,url FROM workspace_resources WHERE published=1 ORDER BY category,title')
    return { bind: () => ({ all: async () => ({ results: [{ title: 'Support de démonstration', category: 'Programme', description: 'Exemple fictif pour la recette visuelle.', url: 'https://example.org/support', private: 'SECRET' }] }) }) }
  },
} }
const tokens = {}
let failVisual = false
let visualReads = 0
const visualBytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
env.CA_VISUALS = { get: async (key, type) => {
  visualReads++
  assert.match(key, /^deploiement-2026-11-07-[12]$/)
  assert.equal(type, 'arrayBuffer')
  if (failVisual) throw new Error('Storage unavailable')
  return visualBytes.buffer
} }
for (const role of ['board', 'team', 'trainers']) tokens[role] = await new SignJWT({ email: `${role}@example.test` }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject(role).setAudience(role).setIssuer(`https://${domain}`).setExpirationTime('30m').sign(privateKey)
const originalFetch = globalThis.fetch
let failBase = false
globalThis.fetch = async (input, options) => {
  const u = new URL(String(input))
  if (u.href === `https://${domain}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
  assert.equal(u.hostname, 'app.nocodb.com')
  assert.equal(options?.method, 'GET')
  if (failBase) return new Response('Unavailable', { status: 503 })
  assert(!/notes|email|telephone|adresse|motivation/.test(u.searchParams.get('fields')))
  const table = u.pathname.split('/')[4]
  const rows = { [NC.tables.cohortes]: boardCohorts, [NC.tables.participations]: boardParticipations, [NC.tables.etablissements]: boardSchools, [NC.tables.engagements]: boardTrainers, [NC.tables.formateurs]: [{ Id: 1, ville: 'Toulouse', cp: '31000' }, { Id: 3, ville: 'Paris', cp: '75001' }] }[table]
  assert(rows, `Unexpected table: ${table}`)
  // Simulate a server-clamped page size; verify the reader fetches every page.
  const offset = Number(u.searchParams.get('offset'))
  return Response.json({ list: rows.slice(offset, offset + 3), pageInfo: { isLastPage: offset + 3 >= rows.length } })
}
const worker = new URL('../dist/_worker.js/', import.meta.url)
const manifestName = (await readdir(worker)).find(n => n.startsWith('manifest_') && n.endsWith('.mjs'))
const { manifest } = await import(new URL(manifestName, worker))
const components = ['interne/ca.astro', 'api/interne/ca.ts', 'interne/index.astro', 'interne/ressources.astro', 'api/interne/ressources.ts', 'api/interne/calendrier.ts', 'api/interne/implantations.ts', 'api/interne/conventions-mission.ts']
const pageMap = new Map(components.map(path => [`src/pages/${path}`, () => import(new URL(`pages/${path.replace('/index.astro', '.astro').replace(/\.(ts|astro)$/, '.astro.mjs')}`, worker))]))
const app = new App({ ...manifest, sessionConfig: undefined, pageMap })
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.CHECK_PORT ?? 0), async fetch(request) {
  const path = new URL(request.url).pathname
  if (path.startsWith('/_astro/') || path.startsWith('/fonts/') || path.startsWith('/maps/')) return new Response(Bun.file(`dist${path}`))
  const headers = new Headers(request.headers)
  const role = headers.get('X-Fixture-Role') ?? 'board'
  if (tokens[role]) headers.set('Cf-Access-Jwt-Assertion', tokens[role])
  return app.render(new Request(request, { headers }), { locals: { runtime: { env } } })
} })
const base = `http://127.0.0.1:${server.port}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/interne/ca`)
  await expect(page.locator('#ca-data')).toBeVisible()
  await expect(page.locator('#ca-project dd')).toHaveText(['40', '30', '23', '7'])
  assert.equal(await page.locator('#ca-internal-pages a').count(), 0)
  await expect(page.locator('#ca-people')).toHaveText('2')
  await expect(page.locator('#ca-evaluation')).toHaveText('1')
  await page.locator('#ca-period').selectOption('2')
  await expect(page.locator('#ca-project dd')).toHaveText(['40', '30', '23', '7'])
  await expect(page.locator('#ca-map-count')).toContainText('1 établissement')
  assert(await page.locator('#ct-markers button').count() > 0)
  await expect(page.locator('#ca-people')).toHaveText('2')
  await page.locator('#ca-period').selectOption('all')
  assert.equal(await page.locator('a[href*="convention"]').count(), 0)
  assert.equal(await page.locator('a[href="/interne/ressources"]').count(), 0)
  assert.equal(await page.locator('form').count(), 0)
  await page.getByRole('button', { name: 'Martinique · 1', exact: true }).click()
  await expect(page.locator('#ca-map-image')).toHaveAttribute('src', '/maps/972.svg')
  await page.locator('#ca-markers .ca-map-marker').click()
  await expect(page.locator('#ca-map-schools')).toContainText('École Démonstration Martinique')
  await page.getByRole('button', { name: 'Tout le territoire', exact: true }).click()
  await page.locator('#ca-map-tabs').getByRole('button', { name: 'Métropole et Corse · 2', exact: true }).click()
  await page.evaluate(() => {
    const note = document.createElement('p'); note.textContent = 'APERÇU — DONNÉES FICTIVES DE DÉMONSTRATION'; note.style.cssText = 'background:#F8C702;color:black;padding:12px;text-align:center;font-weight:bold'; document.body.prepend(note)
  })
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => document.fonts.ready)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`)
    if (output && [390, 1440].includes(width)) await page.screenshot({ path: `${output}/ca-${width}.png`, fullPage: true })
  }
  const api = await originalFetch(`${base}/api/interne/ca`)
  assert.equal(api.status, 200); assert.match(api.headers.get('Cache-Control'), /no-store/)
  const body = await api.text(); assert(!body.includes('SECRET')); assert(!body.includes('example.test'))
  for (const visual of ['1', '2']) {
    const response = await originalFetch(`${base}/api/interne/ca?visual=${visual}`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Type'), 'image/webp')
    assert.match(response.headers.get('Cache-Control'), /no-store/)
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), visualBytes)
  }
  assert.equal((await originalFetch(`${base}/api/interne/ca?visual=other`)).status, 404)
  failVisual = true
  assert.equal((await originalFetch(`${base}/api/interne/ca?visual=1`)).status, 503)
  failVisual = false
  const beforeDeniedReads = visualReads
  for (const role of ['anonymous', 'trainers']) for (const path of ['/interne/ca', '/interne/ca/', '/api/interne/ca', '/api/interne/ca/', '/api/interne/ca?visual=1', '/api/interne/ca?visual=2']) {
    const r = await originalFetch(`${base}${path}`, { headers: { 'X-Fixture-Role': role } }); assert.equal(r.status, 403, `${role} ${path}`)
  }
  assert.equal(visualReads, beforeDeniedReads, 'Refused users must never read private storage')
  for (const path of ['/interne', '/interne/ressources', '/api/interne/ressources', '/api/interne/ressources?convention=1', '/api/interne/calendrier', '/api/interne/implantations', '/api/interne/conventions-mission']) {
    const r = await originalFetch(`${base}${path}`); assert.equal(r.status, 403, `CA denied: ${path}`)
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await originalFetch(`${base}/api/interne/ca`, { method, headers: { Origin: base, 'Content-Type': 'application/json' } }); assert.equal(r.status, 405); assert.equal(r.headers.get('Allow'), 'GET')
  }
  assert.equal((await originalFetch(`${base}/api/interne/ca`, { headers: { 'X-Fixture-Role': 'team' } })).status, 200)
  failBase = true
  await page.locator('#ca-refresh').click()
  await expect(page.locator('#ca-data')).toBeHidden()
  await expect(page.locator('#ca-state')).toContainText('Aucun total partiel')
  failBase = false
  await page.locator('#ca-refresh').click()
  await expect(page.locator('#ca-data')).toBeVisible()
  assert.deepEqual(errors, [])
  console.log('CA : page compilée, pagination, cartes, 7 largeurs, erreurs et cloisonnement vérifiés (données fictives).')
  if (process.env.CHECK_KEEP_OPEN === '1') {
    console.log(`Aperçu local fictif : ${base}/interne/ca`)
    await new Promise(() => {})
  }
} finally { await browser.close(); server.stop(true); globalThis.fetch = originalFetch }
