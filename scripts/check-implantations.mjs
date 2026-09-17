import assert from 'node:assert/strict'
import { mkdir, readdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import * as compiledPage from '../dist/_worker.js/pages/interne/implantations.astro.mjs'
import * as compiledApi from '../dist/_worker.js/pages/api/interne/implantations.astro.mjs'
import { cohorts, establishments, participations } from '../tests/fixtures/implantations.js'

// Actual compiled SSR and API, locally signed Access JWTs, paginated synthetic Noco data.
// No production credentials or auth bypass; every network dependency is intercepted here.
const output = process.env.CHECK_SCREENSHOTS ?? '/private/tmp/euneos-map-qa/screenshots'
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'map-test', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'map-fixture.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'team-fixture',
  RESOURCE_ACCESS_DOMAIN: 'map-fixture.cloudflareaccess.com',
  RESOURCE_ACCESS_AUD: 'resource-fixture',
  NOCODB_TOKEN: 'synthetic-token',
}
const sign = (audience, expiration = '5m') =>
  new SignJWT({ email: 'member@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'map-test' })
    .setSubject('synthetic-user')
    .setAudience(audience)
    .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
    .setExpirationTime(expiration)
    .sign(privateKey)
const jwt = await sign(env.INTERNAL_ACCESS_AUD)
const resourceJwt = await sign(env.RESOURCE_ACCESS_AUD)
const expired = await sign(env.INTERNAL_ACCESS_AUD, '-1m')
let reads = 0,
  failData = false,
  empty = false,
  dangerous = false,
  delay = 0
const realFetch = globalThis.fetch
const tables = {
  m5ayop8ul8s040l: cohorts,
  mbunbu0f1zztce4: participations,
  mg12klh5zv7b5n5: establishments,
}
const unsafeName = '<img src=x onerror="window.injected=true">'
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input))
  if (url.hostname === env.INTERNAL_ACCESS_DOMAIN) return Response.json({ keys: [jwk] })
  assert.equal(url.hostname, 'app.nocodb.com', 'Unexpected third party')
  assert.equal(options.method, 'GET', 'No mutations permitted')
  assert.equal(options.headers['xc-token'], 'synthetic-token')
  assert.doesNotMatch(url.searchParams.get('fields'), /adresse|email|lat|lng|contact/)
  reads++
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  const table = Object.keys(tables).find((id) => url.pathname.includes(id))
  assert(table, 'Only the three allowlisted tables')
  const offset = Number(url.searchParams.get('offset'))
  if (failData && table === 'mbunbu0f1zztce4' && offset > 0)
    return new Response('PRIVATE-UPSTREAM-DETAILS', { status: 503 })
  let source = empty && table === 'mbunbu0f1zztce4' ? [] : tables[table]
  if (dangerous && table === 'mg12klh5zv7b5n5')
    source = source.map((r, i) => (i === 0 ? { ...r, nom: unsafeName } : r))
  const list = source.slice(offset, offset + 4)
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
  pageMap: new Map([
    ['src/pages/interne/implantations.astro', async () => compiledPage],
    ['src/pages/api/interne/implantations.ts', async () => compiledApi],
  ]),
})
const paths = ['/interne/implantations', '/api/interne/implantations']
const render = (path, environment = env, token = jwt, method = 'GET') =>
  app.render(
    new Request(`https://euneos.fr${path}`, {
      method,
      headers: {
        ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}),
        'Cf-Access-Authenticated-User-Email': 'spoof@example.test',
      },
    }),
    { locals: { runtime: { env: environment } } },
  )
let scenarios = 0
async function check(name, run) {
  await run()
  scenarios++
  console.log(`OK ${scenarios} · ${name}`)
}
await check(
  'SSR et API fermées sans configuration, sans JWT, JWT expiré ou audience formateurs',
  async () => {
    for (const path of paths) {
      assert.equal((await render(path, {}, '')).status, 503)
      for (const token of ['', expired, resourceJwt, 'invalid'])
        assert.equal((await render(path, env, token)).status, 403)
    }
    assert.equal(reads, 0)
  },
)
await check(
  'équipe signée, sans base calendriers D1, données privées non mises en cache',
  async () => {
    const page = await render(paths[0])
    assert.equal(page.status, 200)
    assert.match(page.headers.get('Cache-Control'), /private, no-store/)
    const html = await page.text()
    assert.doesNotMatch(html, /synthetic-token|DEMO-01/)
    assert.match(html, /Localisation à la commune/)
    const api = await render(paths[1])
    assert.equal(api.status, 200)
    assert.match(api.headers.get('Cache-Control'), /private, no-store/)
    const result = await api.json()
    assert.equal(result.totals.participations, 17)
    assert.equal(result.totals.groups, 16)
    assert.equal(result.totals.establishments, 12)
    assert.doesNotMatch(JSON.stringify(result), /synthetic-token|member@example.test/)
  },
)
await check(
  'jeton Noco absent et lecture partielle en échec : 503 sans détails privés',
  async () => {
    const missing = { ...env }
    delete missing.NOCODB_TOKEN
    assert.equal((await render(paths[1], missing)).status, 503)
    failData = true
    const result = await render(paths[1])
    assert.equal(result.status, 503)
    const body = await result.text()
    assert.doesNotMatch(body, /PRIVATE-UPSTREAM|DEMO-|"totals"/)
    failData = false
  },
)
await check('aucune route de mutation', async () => {
  const before = reads
  for (const method of ['POST', 'PATCH', 'DELETE'])
    assert.notEqual((await render(paths[1], env, jwt, method)).status, 200)
  assert.equal(reads, before)
})
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (paths.includes(url.pathname)) {
      const routed = new Request(`https://euneos.fr${url.pathname}`, request)
      return app.render(routed, { locals: { runtime: { env } } })
    }
    if (
      !url.pathname.startsWith('/_astro/') &&
      !url.pathname.startsWith('/maps/') &&
      !url.pathname.startsWith('/fonts/') &&
      url.pathname !== '/favicon.svg'
    )
      return new Response('Not found', { status: 404 })
    const file = Bun.file(new URL(`../dist${url.pathname}`, import.meta.url))
    return new Response(file)
  },
})
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
try {
  const tab = await browser.newPage({
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: { 'Cf-Access-Jwt-Assertion': jwt },
  })
  const errors = [],
    outside = []
  tab.on('pageerror', (e) => errors.push(e.message))
  await tab.route('**/*', (route) => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      outside.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  const ready = () => expect(tab.locator('#im-data')).toBeVisible()
  const count = (id, text) => expect(tab.locator(`#im-${id}`)).toHaveText(String(text))
  await check(
    'chargement puis cohorte active factuelle, totaux paginés et regroupement',
    async () => {
      delay = 80
      await tab.goto(`http://127.0.0.1:${server.port}${paths[0]}`)
      await expect(tab.getByRole('heading', { name: 'Chargement des implantations' })).toBeVisible()
      await expect(tab.locator('#im-cohort')).toBeDisabled()
      await ready()
      delay = 0
      await expect(tab.locator('#im-cohort')).toHaveValue('2')
      await count('records', 14)
      await count('schools', 11)
      await count('located', 9)
      await count('unlocated', 4)
      await expect(tab.locator('.im-row')).toHaveCount(13)
      await expect(tab.locator('.im-row').filter({ hasText: 'dossiers' })).toHaveCount(0)
      await expect(
        tab.getByText('2 dossier(s) affiché(s) sur 2 regroupés · à rapprocher'),
      ).toBeVisible()
    },
  )
  await check('toutes cohortes, abandons et cohortes inconnues : aucun dossier perdu', async () => {
    await tab.locator('#im-reset').click()
    await count('records', 17)
    await count('schools', 12)
    await expect(tab.locator('.im-row')).toHaveCount(16)
    await tab.locator('#im-status').selectOption('Abandonne')
    await count('records', 2)
    await expect(tab.locator('.im-row')).toHaveCount(2)
    await expect(
      tab.getByText('1 dossier(s) affiché(s) sur 2 regroupés · à rapprocher'),
    ).toBeVisible()
    await tab.locator('#im-status').selectOption('')
    await tab.locator('#im-cohort').selectOption('unknown')
    await count('records', 2)
    await expect(tab.locator('.im-row')).toHaveCount(2)
    await tab.locator('#im-reset').click()
  })
  await check('sources incomplètes visibles dans la liste sans faux repère', async () => {
    await tab.locator('#im-location').selectOption('unlocated')
    await count('records', 4)
    await count('located', 0)
    await count('unlocated', 4)
    await expect(tab.locator('.im-marker')).toHaveCount(0)
    await expect(tab.getByText('Sans repère', { exact: true })).toHaveCount(4)
    await tab.locator('#im-reset').click()
  })
  await check('métropole, Corse et chacun des cinq DROM, détails et accès au clavier', async () => {
    for (const area of ['971', '972', '973', '974', '976']) {
      await tab.locator(`[data-area="${area}"]`).click()
      await expect(tab.locator('#im-map-background')).toHaveAttribute('src', `/maps/${area}.svg`)
      await expect(tab.locator('.im-marker')).toHaveCount(1)
      await tab.locator('.im-marker').focus()
      await tab.keyboard.press('Enter')
      await expect(tab.locator('#im-detail-title')).toBeFocused()
      await expect(tab.locator('.im-detail-item')).toHaveCount(1)
      await expect(tab.locator('#im-frame-summary')).toContainText('autres territoires')
    }
    await tab.locator('.im-row').filter({ hasText: 'Ajaccio' }).getByRole('button').click()
    await expect(tab.locator('#im-detail-title')).toHaveText('Ajaccio')
    await expect(tab.locator('[data-area="metropole"]')).toHaveAttribute('aria-pressed', 'true')
    await tab.locator('#im-zoom-in').click()
    await expect(tab.locator('#im-map-background')).toHaveCSS('width', /px$/)
    const before = await tab.locator('#im-map-background').getAttribute('style')
    await tab.locator('#im-map').focus()
    await tab.keyboard.press('ArrowLeft')
    assert.notEqual(await tab.locator('#im-map-background').getAttribute('style'), before)
    await tab.locator('#im-map-reset').click()
    await expect(tab.locator('#im-zoom-out')).toBeDisabled()
  })
  await check(
    'erreur réseau après pagination : aucun zéro, réessai conservant les filtres',
    async () => {
      await tab.locator('#im-status').selectOption('Abandonne')
      failData = true
      await tab.locator('#im-refresh').click()
      await expect(
        tab.getByRole('heading', { name: 'Les implantations n’ont pas pu être chargées' }),
      ).toBeVisible()
      await expect(tab.locator('#im-data')).toBeHidden()
      await expect(tab.locator('#im-updated')).toHaveText(
        'Données indisponibles · aucun total confirmé',
      )
      failData = false
      await tab.getByRole('button', { name: 'Réessayer', exact: true }).click()
      await ready()
      await expect(tab.locator('#im-status')).toHaveValue('Abandonne')
      await count('records', 2)
      await tab.locator('#im-reset').click()
    },
  )
  await check('texte source échappé, aucune requête cartographique externe', async () => {
    dangerous = true
    await tab.locator('#im-refresh').click()
    await ready()
    await expect(tab.locator('.im-row h3').filter({ hasText: unsafeName })).toHaveCount(2)
    assert.equal(await tab.locator('.im-row img').count(), 0)
    assert.equal(await tab.evaluate(() => window.injected), undefined)
    dangerous = false
    await tab.locator('#im-refresh').click()
    await ready()
    assert.deepEqual(outside, [])
  })
  await check('état vide distinct des erreurs', async () => {
    empty = true
    await tab.locator('#im-refresh').click()
    await ready()
    await count('records', 0)
    await expect(tab.locator('.im-empty')).toBeVisible()
    empty = false
    await tab.locator('#im-refresh').click()
    await ready()
  })
  await check('responsive de 320 à 1920 px, repères 44 px et captures', async () => {
    await tab.locator('#im-cohort').selectOption('2')
    await tab.locator('[data-area="metropole"]').click()
    await expect(tab.locator('[data-area="metropole"]')).toHaveCSS(
      'background-color',
      'rgb(0, 50, 41)',
    )
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await tab.setViewportSize({ width, height: 1200 })
      await tab.evaluate(() => document.fonts.ready)
      assert(
        await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Overflow ${width}`,
      )
      await expect
        .poll(() =>
          tab.locator('.im-marker').evaluateAll(
            (buttons) =>
              buttons.length > 0 &&
              buttons.every((button) => {
                const box = button.getBoundingClientRect()
                return box.width >= 44 && box.height >= 44
              }),
          ),
        )
        .toBe(true)
      if ([390, 1440].includes(width)) {
        await tab.evaluate(() => window.scrollTo(0, 0))
        await tab.screenshot({ path: `${output}/implantations-${width}.png` })
        await tab.locator('.im-map-panel').screenshot({ path: `${output}/carte-${width}.png` })
      }
    }
    await tab.setViewportSize({ width: 1440, height: 1200 })
    await tab.locator('[data-area="974"]').click()
    await tab.locator('.im-marker').click()
    await tab.locator('.im-workspace').screenshot({ path: `${output}/reunion-detail.png` })
    assert.deepEqual(errors, [])
    assert.deepEqual(outside, [])
  })
} finally {
  await browser.close()
  server.stop()
  globalThis.fetch = realFetch
}
console.log(`${scenarios} scénarios SSR/JWT/API/navigateur compilés validés. Captures : ${output}`)
