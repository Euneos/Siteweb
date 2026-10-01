import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { chromium, expect } from '@playwright/test'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { postformationFixture } from '../tests/fixtures/postformation.ts'
import { postformationDefinitions } from '../src/lib/postformation-definition.ts'
import { NC } from '../src/lib/nocodb.ts'

// Compiled Astro + endpoints + SQLite + private catalogue. Synthetic transport
// only; no real secrets are loaded, and browser egress is limited to this server.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-postformation-qa'
await mkdir(output, { recursive: true })
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find((n) =>
  n.startsWith('manifest_'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const pages = [
  ...postformationDefinitions.flatMap((d) => [
    `src/pages/suivi/${d.slug}.astro`,
    `src/pages/api/questionnaires/${d.slug}.ts`,
  ]),
  'src/pages/interne/formulaires.astro',
  'src/pages/api/interne/formulaires.ts',
]
const pageMap = new Map()
for (const path of pages) {
  const compiled = path.replace('src/', '').replace(/\.(astro|ts)$/, '.astro.mjs')
  pageMap.set(path, async () => import(new URL(`../dist/_worker.js/${compiled}`, import.meta.url)))
}
const app = new App({ ...manifest, sessionConfig: undefined, pageMap })
const f = postformationFixture(),
  realFetch = globalThis.fetch
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'postformation-qa', alg: 'RS256' },
  issuer = 'https://postformation-qa.cloudflareaccess.com'
const jwt = await new SignJWT({ email: 'team@example.invalid' })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setIssuer(issuer)
  .setAudience('team')
  .setSubject('fixture')
  .setExpirationTime('30m')
  .sign(privateKey)
Object.assign(f.env, {
  TEAM_WORKSPACE: {},
  INTERNAL_ACCESS_DOMAIN: new URL(issuer).hostname,
  INTERNAL_ACCESS_AUD: 'team',
})
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)),
    method = init?.method ?? 'GET'
  if (url.href === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
  if (
    url.origin === 'https://app.nocodb.com' &&
    [NC.tables.etablissements, NC.tables.participations, NC.tables.cohortes].includes(
      url.pathname.split('/')[4],
    )
  ) {
    assert.equal(method, 'GET')
    return Response.json({
      list: url.pathname.includes(NC.tables.cohortes)
        ? [{ Id: 2, active: true, annee_debut: 2026, annee_fin: 2027 }]
        : [],
      pageInfo: { isLastPage: true },
    })
  }
  return f.transport(input, init)
}
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
    { locals: { runtime: { env: f.env } } },
  )
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const u = new URL(request.url),
      path = u.pathname
    if (pages.some((p) => p.replace('src/pages', '').replace(/\.(astro|ts)$/, '') === path))
      return render(path + u.search, {
        method: request.method,
        body: request.method === 'POST' ? await request.text() : undefined,
        authenticated: path.includes('/interne/'),
        preview: u.searchParams.has('demo'),
      })
    if (/^\/(?:_astro|fonts)\//.test(path) || path === '/favicon.svg')
      return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
    return new Response('Not found', { status: 404 })
  },
})
const origin = `http://127.0.0.1:${server.port}`,
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH }),
  errors = [],
  measures = []
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  await context.route('**/*', (route) => {
    assert.equal(new URL(route.request().url()).origin, origin, 'No external browser transport')
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  const fill = async (def, email = 'adult@example.invalid') => {
    for (const [key, value] of Object.entries({
      name: 'Adulte Fictif',
      email,
      school: 'École fictive',
      year: '2026-2027',
    }))
      await page.locator(`#postformation-form [name="${key}"]`).fill(value)
    for (const q of def.questions.filter(
      (q) => q.required && ['radio', 'checkbox'].includes(q.type),
    ))
      await page.locator(`#postformation-form [name="${q.key}"]`).first().check()
  }
  for (const def of postformationDefinitions) {
    for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const r = await page.goto(origin + `/suivi/${def.slug}?email=PRIVATE_PREFILL_CANARY`)
      assert.equal(r.status(), 200)
      assert.match(r.headers()['cache-control'], /no-store/)
      assert.equal(r.headers()['referrer-policy'], 'no-referrer')
      assert.match(r.headers()['x-robots-tag'], /noindex/)
      await expect(page.locator('#postformation-form [name="email"]')).toHaveValue('')
      assert(
        !(await page
          .locator('main')
          .textContent()
          .then((t) => t.includes('PRIVATE_PREFILL_CANARY'))),
      )
      const size = await page.evaluate(() => ({
        width: innerWidth,
        content: document.documentElement.scrollWidth,
      }))
      assert(size.content <= width + 1)
      measures.push({ slug: def.slug, ...size })
      for (const q of def.questions) {
        await expect(page.locator(`[name="${q.key}"]`).first()).toBeAttached()
        const holder = page.locator(`[name="${q.key}"]`).first().locator('xpath=..')
        if (!['radio', 'checkbox'].includes(q.type)) await expect(holder).toContainText(q.label)
      }
      if ([390, 1440].includes(width)) {
        await page.screenshot({ path: `${output}/${def.slug}-${width}.png`, fullPage: true })
        await page.screenshot({ path: `${output}/${def.slug}-top-${width}.png` })
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(origin + `/suivi/${def.slug}`)
    const count = f.rows.length
    await page.locator('#postformation-form button[type="submit"]').click()
    assert.equal(f.rows.length, count)
    await fill(def)
    const other = def.questions.find((q) => q.other)
    await page.locator(`[name="${other.key}"]`).last().check()
    await page.locator('#postformation-form button[type="submit"]').click()
    assert.equal(f.rows.length, count, 'Selected other needs text')
    await page.locator(`[name="${other.key}Other"]`).fill('<script>QA_XSS_CANARY</script>')
    await page
      .locator(`[name="${other.key}Other"]`)
      .locator('xpath=../..')
      .screenshot({ path: `${output}/${def.slug}-other-mobile.png` })
    if (def.slug === 'suivi-j45') {
      const check = def.questions.find((q) => q.type === 'checkbox')
      await page.locator(`[name="${check.key}"]`).first().uncheck()
      await page.locator('#postformation-form button[type="submit"]').click()
      assert.equal(f.rows.length, count)
      await page.locator(`[name="${check.key}"]`).first().check()
      await page.locator(`[name="${check.key}"]`).nth(2).check()
    }
    await page.locator('#postformation-form button[type="submit"]').click()
    await expect(page.locator('#postformation-feedback')).toContainText('a bien été enregistrée')
    assert.equal(f.rows.length, count + 1)
    assert.match(f.people[0][def.dateField], /^20\d{2}-\d{2}-\d{2}$/)
    assert.equal(f.people[0].statut, 'Déclaré — préformation')
    await expect(page.getByRole('button', { name: 'Réponse reçue' })).toBeDisabled()
    await page
      .locator('#postformation-feedback')
      .screenshot({ path: `${output}/${def.slug}-receipt-mobile.png` })
    // Lost capture response: retry same frozen body; pending identity stays private.
    await page.goto(origin + `/suivi/${def.slug}`)
    await fill(def, 'unknown@example.invalid')
    f.behavior = 'capture-after-save'
    await page.locator('#postformation-form button[type="submit"]').click()
    await expect(page.getByRole('button', { name: 'Vérifier la réception' })).toBeEnabled()
    await expect(page.locator('#postformation-form [name="email"]')).toHaveAttribute('readonly', '')
    f.behavior = ''
    await page.getByRole('button', { name: 'Vérifier la réception' }).click()
    await expect(page.locator('#postformation-feedback')).toContainText('a bien été enregistrée')
    assert.equal(f.rows.length, count + 2)
  }
  // A pre-A source shares the same private table; ensure schemas coexist.
  f.rows.push({
    Id: 100,
    cle_reponse: 'f'.repeat(64),
    formulaire: 'Préformation fixture',
    etablissement: 'École fictive',
    annee_scolaire: '2026-2027',
    reponses: JSON.stringify({
      schema: 'preformation-v1',
      answers: [{ label: 'Question pré-A', value: 'Réponse pré-A' }],
    }),
  })
  await page.goto(origin + '/interne/formulaires')
  await expect(page.locator('#submissions-list')).toContainText('Réception vérifiée sur l’adulte')
  await expect(page.locator('#submissions-list')).toContainText('Réponse reçue — à rapprocher')
  await expect(page.locator('#submissions-list')).toContainText('Réception préformation en attente')
  for (const summary of await page.locator('#submissions-list summary').all()) await summary.click()
  await expect(page.locator('#submissions-list')).toContainText('<script>QA_XSS_CANARY</script>')
  assert.equal(await page.locator('#submissions-list script').count(), 0)
  await expect(page.locator('#submissions-list')).toContainText('Minuteur')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: `${output}/journal-mobile.png`, fullPage: true })
  assert.equal((await render('/api/interne/formulaires')).status, 403)
  for (const def of postformationDefinitions) {
    const key =
        def.slug === 'post-formation'
          ? 'POST_FORMATION_PERSON_PROJECTION'
          : 'SUIVI_J45_PERSON_PROJECTION',
      saved = f.env[key]
    delete f.env[key]
    const closed = await render(`/suivi/${def.slug}`)
    assert.equal(closed.status, 503)
    assert(!/id="postformation-form"/.test(await closed.text()))
    const demo = await render(`/suivi/${def.slug}`, { preview: true })
    assert.equal(demo.status, 200)
    assert.match(await demo.text(), /Aperçu de démonstration/)
    f.env[key] = saved
  }
  assert.deepEqual(errors, [])
  assert.equal(f.writes.length, 2)
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        measures,
        errors,
        adultWrites: f.writes.length,
        journalRows: f.rows.length,
        checks: [
          'required fields',
          'other text',
          'multiple choices',
          'receipt dates only',
          'uncertain replay',
          'pending private identity',
          'mixed pre-A/B/J45 catalogue',
          'no XSS',
          'unauthenticated denied',
          'config fails closed',
          'preview no writes',
        ],
      },
      null,
      2,
    ),
  )
  console.log(
    'B/J45 compiled QA: 14 viewport checks, 2 complete submissions + 2 uncertain replay/pending, mixed private catalogue; no JS errors.',
  )
} finally {
  await browser.close()
  server.stop(true)
  f.sql.close()
  globalThis.fetch = realFetch
}
