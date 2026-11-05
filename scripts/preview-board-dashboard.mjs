// Local-only review of a dated, private snapshot obtained through the NocoDB tools.
// No real records or credentials belong in this script or in the public repository.
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { buildBoardDashboard, boardResources } from '../src/lib/board-dashboard.ts'
import { readBoardReport } from '../src/lib/board-report.ts'
const snapshot = JSON.parse(await readFile(process.env.BOARD_SNAPSHOT_FILE, 'utf8'))
const report = readBoardReport(await readFile(process.env.BOARD_REPORT_FILE, 'utf8'))
const data = { ...buildBoardDashboard(snapshot.cohorts, snapshot.participations, snapshot.schools, snapshot.trainers, new Date(snapshot.readAt), snapshot.trainerPeople ?? []), report, resources: snapshot.resources ? boardResources(snapshot.resources) : null }
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'private-review', alg: 'RS256', use: 'sig' }
const domain = 'board-review.cloudflareaccess.com'
const env = { INTERNAL_ACCESS_DOMAIN: domain, INTERNAL_ACCESS_AUD: 'team', BOARD_ACCESS_DOMAIN: domain, BOARD_ACCESS_AUD: 'board', RESOURCE_ACCESS_AUD: 'trainers' }
const jwt = await new SignJWT({ email: 'apercu-local@example.test' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('local-review').setAudience('board').setIssuer(`https://${domain}`).setExpirationTime('8h').sign(privateKey)
const originalFetch = globalThis.fetch
globalThis.fetch = async input => { assert.equal(String(input), `https://${domain}/cdn-cgi/access/certs`); return Response.json({ keys: [jwk] }) }
const worker = new URL('../dist/_worker.js/', import.meta.url)
const name = (await readdir(worker)).find(n => n.startsWith('manifest_') && n.endsWith('.mjs'))
const { manifest } = await import(new URL(name, worker))
const app = new App({ ...manifest, sessionConfig: undefined, pageMap: new Map([['src/pages/interne/ca.astro', () => import(new URL('pages/interne/ca.astro.mjs', worker))]]) })
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.CHECK_PORT ?? 4338), async fetch(request) {
  const path = new URL(request.url).pathname
  if (path.startsWith('/_astro/') || path.startsWith('/fonts/') || path.startsWith('/maps/')) return new Response(Bun.file(`dist${path}`))
  if (path === '/api/interne/ca' && request.method === 'GET') return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
  if (path !== '/interne/ca' || request.method !== 'GET') return new Response('Aperçu local uniquement.', { status: 404 })
  const headers = new Headers(request.headers); headers.set('Cf-Access-Jwt-Assertion', jwt)
  const response = await app.render(new Request(request, { headers }), { locals: { runtime: { env } } })
  const html = (await response.text()).replace(/(<body[^>]*>)/, '$1<div style="background:#F8C702;color:black;padding:12px;text-align:center;font-weight:600">APERÇU PRIVÉ — POINT D’ÉTAPE DU 3 NOVEMBRE & DONNÉES DE LA BASE DU 5 NOVEMBRE 2026 — NON PUBLIÉ</div>')
  return new Response(html, { status: response.status, headers: response.headers })
} })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.port}/interne/ca`)
  await expect(page.locator('#ca-data')).toBeVisible()
   await expect(page.locator('#ca-project dd')).toHaveText(['30', '23', '7'])
  await expect(page.locator('#ca-report-professionals')).toHaveText(String(report.review?.professionals ?? report.professionals))
  await expect(page.locator('#ca-people')).toHaveText(String(data.trainers.people))
  const current = data.periods.find(p => p.cohort === '2026–2027')
  for (const period of data.periods) {
    await page.locator('#ca-period').selectOption(period.key)
     await expect(page.locator('#ca-project dd')).toHaveText(['30', '23', '7'])
    await expect(page.locator('#ca-report-professionals')).toHaveText(String(report.review?.professionals ?? report.professionals))
  }
  await page.locator('#ca-period').selectOption('all')
   await expect(page.locator('#ca-project dd')).toHaveText(['30', '23', '7'])
  assert(await page.locator('#ct-markers button').count() > 0, 'Carte formateurs absente')
  await page.locator('#ct-map-tabs').getByRole('button', { name: 'Guadeloupe · 3', exact: true }).click()
  await expect(page.locator('#ct-map-count')).toContainText('3 formateur(s)')
  await page.locator('#ct-markers button').first().click()
  await expect(page.locator('#ct-map-count')).toContainText('formateur(s) validé(s)')
  const output = process.env.CHECK_SCREENSHOTS
  if (output) await mkdir(output, { recursive: true })
  for (const width of [320, 390, 768, 860, 861, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow ${width}`)
    if (output && [390, 1440].includes(width)) await page.screenshot({ path: `${output}/ca-reel-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ preview: `http://127.0.0.1:${server.port}/interne/ca`, reportDate: report.asOf, applications: report.applications, reportedSites: report.engagedSites, distinctSchools: data.engaged, periods: data.periods.map(p => ({ year: p.cohort, schools: p.engaged })), validatedTrainers: data.trainers.people }))
} finally { await browser.close() }
if (process.env.CHECK_KEEP_OPEN === '1') await new Promise(() => {})
server.stop(true); globalThis.fetch = originalFetch
