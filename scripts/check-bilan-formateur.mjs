import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { chromium, expect } from '@playwright/test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { bilanFixture, bilanBody } from '../tests/fixtures/bilan-formateur'
import { bilanQuestions } from '../src/lib/bilan-formateur-definition'
import { NC } from '../src/lib/nocodb'
import * as pageModule from '../dist/_worker.js/pages/suivi/bilan-formateur.astro.mjs'
import * as apiModule from '../dist/_worker.js/pages/api/questionnaires/bilan-formateur.astro.mjs'
import * as catalogModule from '../dist/_worker.js/pages/interne/formulaires.astro.mjs'
import * as catalogApiModule from '../dist/_worker.js/pages/api/interne/formulaires.astro.mjs'
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-bilan-qa'
await mkdir(output, { recursive: true })
const manifestFile = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find((n) =>
  n.startsWith('manifest_'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestFile}`, import.meta.url))
const app = new App({
  ...manifest,
  sessionConfig: undefined,
  pageMap: new Map([
    ['src/pages/suivi/bilan-formateur.astro', async () => pageModule],
    ['src/pages/api/questionnaires/bilan-formateur.ts', async () => apiModule],
    ['src/pages/interne/formulaires.astro', async () => catalogModule],
    ['src/pages/api/interne/formulaires.ts', async () => catalogApiModule],
  ]),
})
const fixture = bilanFixture(),
  issuer = 'https://bilan-qa.cloudflareaccess.com'
const { privateKey, publicKey } = await generateKeyPair('RS256'),
  jwk = { ...(await exportJWK(publicKey)), kid: 'bilan-qa', alg: 'RS256' }
const jwt = await new SignJWT({ email: 'team@example.invalid' })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setIssuer(issuer)
  .setAudience('team')
  .setSubject('fixture')
  .setExpirationTime('30m')
  .sign(privateKey)
Object.assign(fixture.env, {
  TEAM_WORKSPACE: {},
  INTERNAL_ACCESS_DOMAIN: new URL(issuer).hostname,
  INTERNAL_ACCESS_AUD: 'team',
})
const realFetch = globalThis.fetch
// Entirely synthetic transport. Neither production credentials nor config files are loaded.
globalThis.fetch = async (input, init) => {
  if (String(input) === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
  const url = new URL(String(input)),
    table = url.pathname.split('/')[4]
  assert.equal(url.origin, 'https://app.nocodb.com')
  if ([NC.tables.etablissements, NC.tables.participations, NC.tables.cohortes].includes(table)) {
    assert.equal(init?.method ?? 'GET', 'GET')
    return Response.json({
      list:
        table === NC.tables.cohortes
          ? [{ Id: 1, active: true, annee_debut: 2026, annee_fin: 2027 }]
          : [],
      pageInfo: { isLastPage: true },
    })
  }
  return fixture.fetch(input, init)
}
const render = (path, { method = 'GET', body, preview = false, authenticated = false } = {}) =>
  app.render(
    new Request(`${preview ? 'http://localhost' : 'https://euneos.fr'}${path}`, {
      method,
      headers: {
        ...(method === 'POST'
          ? {
              Origin: preview ? 'http://localhost' : 'https://euneos.fr',
              'Content-Type': 'application/json',
            }
          : {}),
        ...(authenticated ? { 'Cf-Access-Jwt-Assertion': jwt } : {}),
      },
      ...(body ? { body } : {}),
    }),
    { locals: { runtime: { env: fixture.env } } },
  )
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url),
      path = url.pathname
    if (path === '/suivi/bilan-formateur')
      return render(path, { preview: url.searchParams.has('demo') })
    if (path === '/api/questionnaires/bilan-formateur')
      return render(path, { method: 'POST', body: await request.text() })
    if (path === '/interne/formulaires' || path === '/api/interne/formulaires')
      return render(path, { authenticated: true })
    if (/^\/(?:_astro|fonts)\//.test(path) || path === '/favicon.svg')
      return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
    return new Response('Not found', { status: 404 })
  },
})
const origin = `http://127.0.0.1:${server.port}`,
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH }),
  measurements = [],
  errors = []
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  await context.route('**/*', (r) => {
    assert.equal(new URL(r.request().url()).origin, origin, 'Browser external request forbidden')
    return r.continue()
  })
  const page = await context.newPage()
  await page.addInitScript(() => sessionStorage.setItem('euneos-study-dismissed', '1'))
  page.on('pageerror', (e) => errors.push(e.message))
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + '/suivi/bilan-formateur')
    await expect(page.locator('#bilan-formateur-form')).toBeVisible()
    assert.equal(await page.locator('#bilan-formateur-form input:checked').count(), 0)
    for (const q of bilanQuestions) {
      assert.equal(
        (await page.locator(`#bilan-formateur-form [name="${q.key}"]`).count()) > 0,
        true,
      )
      assert((await page.locator('#bilan-formateur-form').innerText()).includes(q.label))
    }
    const size = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    assert(size.scroll <= width + 1)
    measurements.push(size)
    if ([390, 1440].includes(width)) {
      await page.screenshot({ path: `${output}/bilan-${width}.png` })
      await page.locator('[name="contractReturned"]').first().scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${output}/bilan-end-${width}.png` })
    }
  }
  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload()
  const body = bilanBody()
  for (const q of bilanQuestions) {
    const field = page.locator(`#bilan-formateur-form [name="${q.key}"]`),
      value = body.answers[q.key]
    if (q.type === 'checkbox') await field.filter({ has: undefined }).first().check()
    else if (q.type === 'choice')
      await page
        .locator(`#bilan-formateur-form [name="${q.key}"]`)
        .filter({ visible: true })
        .evaluateAll((els, v) => {
          const el = els.find((e) => e.value === v)
          el.click()
        }, value)
    else await field.fill(value)
  }
  fixture.behavior = 'readback-fails'
  await page.locator('#bilan-formateur-form button').click()
  await expect(page.locator('#bilan-formateur-form button')).toHaveText('Vérifier la réception')
  assert.equal(fixture.proof().state, 'writing')
  assert.equal(fixture.sources.length, 1)
  fixture.blockMissionReads = false
  fixture.behavior = ''
  fixture.sql.exec('UPDATE public_bilan_formateur_projections SET lease_until=0')
  await page.locator('#bilan-formateur-form button').click()
  await expect(page.locator('#bilan-formateur-feedback')).toHaveText(
    'Votre réponse a bien été enregistrée. Merci.',
  )
  assert.equal(fixture.proof().state, 'complete')
  assert.equal(fixture.calls.filter((c) => c.method === 'PATCH').length, 1)
  assert.equal(fixture.missions[0].bilan_recu, true)
  assert.equal(JSON.parse(fixture.proof().fields_json).bilan_recu, true)
  assert.equal(fixture.missions[0].statut, 'En cours')
  assert.equal(fixture.missions[0].convention_signee, false)
  await page.screenshot({ path: `${output}/bilan-received-mobile.png` })
  const catalog = await (await render('/api/interne/formulaires', { authenticated: true })).json()
  assert.equal(catalog.publicResponses[0].participationId, 31)
  assert.equal(catalog.publicResponses[0].state, 'Bilan — report partiel vérifié')
  assert.equal(catalog.publicResponses[0].details.length, 29)
  await page.goto(origin + '/interne/formulaires')
  await expect(page.locator('[data-public-form="bilan-formateur"] input')).toHaveValue(
    'https://euneos.fr/suivi/bilan-formateur',
  )
  await page.locator('[data-public-form="bilan-formateur"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${output}/bilan-catalogue-mobile.png` })
  const denied = await render('/api/interne/formulaires')
  assert(denied.status >= 400)
  const before = fixture.calls.length
  assert.equal(
    (
      await (
        await render('/api/questionnaires/bilan-formateur', {
          method: 'POST',
          body: JSON.stringify(body),
          preview: true,
        })
      ).json()
    ).preview,
    true,
  )
  assert.equal(fixture.calls.length, before)
  delete fixture.env.BILAN_FORMATEUR_PROJECTION
  assert.equal((await render('/suivi/bilan-formateur')).status, 503)
  assert.equal(errors.length, 0)
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        measurements,
        browserErrors: errors,
        sourceRows: fixture.sources.length,
        businessPatches: fixture.calls.filter((c) => c.method === 'PATCH').length,
        network: 'All transports mocked, no production secrets',
        verified: [
          '28 exact questions',
          'no preset answers/year/date',
          'own checkbox choices',
          'uncertain write replay read-only',
          'empty mission fields readback',
          'status and contract unchanged',
          'private catalogue dispatch and URL',
          'auth and configuration guards',
        ],
      },
      null,
      2,
    ),
  )
  console.log('Compiled bilan QA passed: ' + output)
} finally {
  await browser.close()
  server.stop(true)
  globalThis.fetch = realFetch
  fixture.sql.close()
}
