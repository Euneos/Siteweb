import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { chromium, expect } from '@playwright/test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { accordFixture, accordBody } from '../tests/fixtures/accord-formateur'
import { accordTerms, accordQuestions } from '../src/lib/accord-formateur-definition'
import * as pageModule from '../dist/_worker.js/pages/suivi/accord-formateur.astro.mjs'
import * as endpointModule from '../dist/_worker.js/pages/api/questionnaires/accord-formateur.astro.mjs'
import * as proofModule from '../dist/_worker.js/pages/api/interne/accords-formateurs.astro.mjs'
// Compiled Astro + D1 SQLite + synthetic NocoDB. Never load .dev.vars or real secrets.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-accord-qa'
await mkdir(output, { recursive: true })
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find((n) =>
  n.startsWith('manifest_'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({
  ...manifest,
  sessionConfig: undefined,
  pageMap: new Map([
    ['src/pages/suivi/accord-formateur.astro', async () => pageModule],
    ['src/pages/api/questionnaires/accord-formateur.ts', async () => endpointModule],
    ['src/pages/api/interne/accords-formateurs.ts', async () => proofModule],
  ]),
})
const fixture = accordFixture()
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'accord-qa', alg: 'RS256' },
  issuer = 'https://accord-qa.cloudflareaccess.com'
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
const realFetch = globalThis.fetch,
  errors = []
globalThis.fetch = async (input, init) =>
  String(input) === `${issuer}/cdn-cgi/access/certs`
    ? Response.json({ keys: [jwk] })
    : fixture.fetch(input, init)
const render = (path, { method = 'GET', body, authenticated = false, preview = false } = {}) =>
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
    if (path === '/suivi/accord-formateur')
      return render(path, { preview: url.searchParams.has('demo') })
    if (path === '/api/questionnaires/accord-formateur')
      return render(path, { method: 'POST', body: await request.text() })
    if (/^\/(?:_astro|fonts)\//.test(path) || path === '/favicon.svg')
      return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
    return new Response('Not found', { status: 404 })
  },
})
const origin = `http://127.0.0.1:${server.port}`
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH }),
  measurements = []
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  await context.route('**/*', (route) => {
    assert.equal(
      new URL(route.request().url()).origin,
      origin,
      'External browser request forbidden',
    )
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin + '/suivi/accord-formateur')
    await expect(page.locator('#accord-formateur-form')).toBeVisible()
    assert.equal(
      await page.locator('#accord-formateur-form input[type="radio"]:checked').count(),
      0,
    )
    assert.equal(await page.locator('#accord-formateur-form [name="signature"]').inputValue(), '')
    assert.equal(
      await page.locator('#accord-formateur-form [name="agreementDate"]').inputValue(),
      '',
    )
    assert.equal(await page.locator('.af-clause').count(), 8)
    for (const section of accordTerms)
      for (const block of section.blocks)
        assert((await page.locator('.af-contract').innerText()).includes(block.text))
    for (const question of accordQuestions)
      assert.equal(
        await page
          .locator(`#accord-formateur-form [name="${question.key}"]`)
          .first()
          .getAttribute('required'),
        '',
      )
    const size = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    assert(size.scroll <= width + 1, `Horizontal overflow ${width}`)
    measurements.push(size)
    if ([390, 1440].includes(width)) {
      await page.screenshot({ path: `${output}/accord-${width}.png` })
      await page.locator('.af-choice').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${output}/accord-validation-${width}.png` })
    }
  }
  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload()
  for (const [key, value] of Object.entries(accordBody().answers)) {
    if (key === 'agreement')
      await page.locator(`#accord-formateur-form [name="agreement"][value="${value}"]`).check()
    else await page.locator(`#accord-formateur-form [name="${key}"]`).fill(value)
  }
  fixture.behavior = 'source-lost-after'
  await page.locator('#accord-formateur-form button').click()
  await expect(page.locator('#accord-formateur-form button')).toHaveText('Vérifier la réception')
  assert.equal(fixture.sources.length, 1)
  assert.equal(fixture.calls.filter((c) => c.method === 'PATCH').length, 0)
  const fixedSignature = await page
    .locator('#accord-formateur-form [name="signature"]')
    .inputValue()
  await expect(page.locator('#accord-formateur-form [name="signature"]')).toHaveAttribute(
    'readonly',
    '',
  )
  fixture.behavior = ''
  await page.locator('#accord-formateur-form button').click()
  await expect(page.locator('#accord-formateur-feedback')).toHaveText(
    'Votre réponse a bien été enregistrée. Merci.',
  )
  assert.equal(fixture.proof().state, 'complete')
  assert.equal(fixture.journeys[0].cohortes_id, null)
  assert.equal(fixture.journeys[0].accord_signe, true)
  assert.equal(fixture.sources.length, 1)
  assert.equal(fixture.calls.filter((c) => c.method === 'PATCH').length, 1)
  assert.equal(
    await page.locator('#accord-formateur-form [name="signature"]').inputValue(),
    fixedSignature,
  )
  await page.screenshot({ path: `${output}/accord-received-mobile.png` })
  const denied = await render('/api/interne/accords-formateurs')
  assert(denied.status >= 400)
  const proof = await (
    await render('/api/interne/accords-formateurs', { authenticated: true })
  ).json()
  assert.equal(proof.responses[0].verifiedProjection.journeyId, 21)
  assert.equal(proof.responses[0].source.contract.sections.length, 8)
  const bad = await render('/api/interne/accords-formateurs?receipt=bad', { authenticated: true })
  assert.equal(bad.status, 400)
  const body = accordBody()
  body.answers.email = 'not-known@example.invalid'
  await render('/api/questionnaires/accord-formateur', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const reviews = await (
    await render('/api/interne/accords-formateurs', { authenticated: true })
  ).json()
  assert(reviews.responses.some((r) => r.state === 'review' && r.verifiedProjection === null))
  const before = fixture.calls.length
  await page.goto(origin + '/suivi/accord-formateur?demo')
  await expect(page.locator('.of-preview')).toContainText('Démonstration')
  const demo = await (
    await render('/api/questionnaires/accord-formateur', {
      method: 'POST',
      body: JSON.stringify(body),
      preview: true,
    })
  ).json()
  assert.equal(demo.preview, true)
  assert.equal(fixture.calls.length, before)
  delete fixture.env.ACCORD_FORMATEUR_PERSON_PROJECTION
  assert.equal((await render('/suivi/accord-formateur')).status, 503)
  assert.equal(
    (
      await render('/api/questionnaires/accord-formateur', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    ).status,
    503,
  )
  assert.equal(errors.length, 0)
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        measurements,
        browserErrors: errors,
        sourceRows: fixture.sources.length,
        businessPatches: fixture.calls.filter((c) => c.method === 'PATCH').length,
        network: 'All external calls mocked; no production secrets',
        verified: [
          'full contract',
          'no automatic consent/signature/date',
          'source lost response replay',
          'NULL cohort retained',
          'agreement readback',
          'private proof auth',
          'ambiguous identity review',
          'preview no writes',
          'configuration fail closed',
        ],
      },
      null,
      2,
    ),
  )
  console.log(`Accord compiled QA passed; ${output}`)
} finally {
  await browser.close()
  server.stop(true)
  globalThis.fetch = realFetch
  fixture.sql.close()
}
