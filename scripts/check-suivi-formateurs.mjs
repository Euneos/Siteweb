import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import * as compiledPage from '../dist/_worker.js/pages/interne/formateurs.astro.mjs'

// Actual compiled page, synthetic records, local JWT: no real mail or base access.
const output = process.env.CHECK_SCREENSHOTS
assert(output, 'Set CHECK_SCREENSHOTS to a local output directory')
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'fixture.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'fixture',
  NOCODB_TOKEN: 'synthetic-token',
}
const jwt = await new SignJWT({ email: 'demo@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
  .setSubject('demo')
  .setAudience('fixture')
  .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
  .setExpirationTime('10y')
  .sign(privateKey)
const tables = {
  mblganql53o34gm: [
    {
      Id: 1,
      prenom: 'Camille',
      nom: 'Démonstration',
      ville: 'Toulouse',
      email: 'demo@example.test',
      profession: 'Enseignante',
      telephone: 'Numéro de démonstration',
    },
  ],
  mom9m2q83nainyz: [
    {
      Id: 1,
      formateurs_id: 1,
      cohortes_id: 2,
      fusionne_vers: null,
      date_candidature: new Date().toISOString().slice(0, 10),
      statut: 'Candidature recue',
      motivation: 'Accompagner les jeunes et les équipes éducatives. <script>INJECTED</script>',
      interventions_animees: 'Ateliers de démonstration',
      accord_signe: false,
    },
    { Id: 2, formateurs_id: 1, cohortes_id: 2, fusionne_vers: 1, statut: 'ARCHIVE-HIDDEN' },
    {
      Id: 3,
      formateurs_id: 1,
      cohortes_id: 1,
      date_candidature: '2025-09-01',
      statut: 'Candidature validée',
      accord_signe: true,
      promotion: 'Septembre 2025',
    },
  ],
}
let reads = 0
let unavailable = false
const realFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.hostname === env.INTERNAL_ACCESS_DOMAIN) return Response.json({ keys: [jwk] })
  assert.equal(url.hostname, 'app.nocodb.com')
  reads++
  if (unavailable) return new Response('PRIVATE ERROR', { status: 503 })
  const table = Object.keys(tables).find((id) => url.pathname.includes(id))
  assert(table)
  const offset = Number(url.searchParams.get('offset'))
  return Response.json({
    list: tables[table].slice(offset, offset + 1),
    pageInfo: { isLastPage: offset + 1 >= tables[table].length },
  })
}
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(
  (f) => f.startsWith('manifest_') && f.endsWith('.mjs'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({
  ...manifest,
  sessionConfig: undefined,
  pageMap: new Map([['src/pages/interne/formateurs.astro', async () => compiledPage]]),
})
const render = (token, query = '') =>
  app.render(
    new Request(`https://www.euneos.fr/interne/formateurs${query}`, {
      headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
    }),
    { locals: { runtime: { env } } },
  )
assert.equal((await render()).status, 403)
assert.equal(reads, 0)
const response = await render(jwt)
assert.match(response.headers.get('Cache-Control'), /no-store/)
const html = await response.text()
assert.match(html, /Camille Démonstration/)
assert.match(html, /Ateliers de démonstration/)
assert.doesNotMatch(html, /ARCHIVE-HIDDEN|synthetic-token|<script>INJECTED/)
assert.match(await (await render(jwt, '?nom=inexistant')).text(), /Aucun parcours/)
unavailable = true
const failed = await (await render(jwt)).text()
assert.match(failed, /Données momentanément indisponibles/)
assert.doesNotMatch(failed, /Camille Démonstration|PRIVATE ERROR/)
globalThis.fetch = realFetch
await writeFile(`${output}/demo.html`, html)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/interne/formateurs')
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (path.includes('..')) return new Response('', { status: 404 })
    return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
  },
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const width of [320, 390, 768, 860, 861, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`http://127.0.0.1:${server.port}/interne/formateurs`)
    await page.locator('details summary').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('details').first()).toHaveAttribute('open', '')
    assert(
      await page
        .locator('body')
        .evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    )
    if ([390, 1440].includes(width))
      await page.screenshot({ path: `${output}/formateurs-${width}.png`, fullPage: true })
  }
} finally {
  await browser.close()
  server.stop()
}
console.log('Suivi formateurs: access, pagination, archives, errors and 6 widths verified.')
