import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { chromium, expect } from '@playwright/test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { NC } from '../src/lib/nocodb'
import {
  preformationPersonConfig,
  preformationAdult,
  preformationDossier,
} from '../tests/fixtures/preformation-person'
import * as pageModule from '../dist/_worker.js/pages/suivi/pre-formation.astro.mjs'
import * as endpointModule from '../dist/_worker.js/pages/api/questionnaires/pre-formation.astro.mjs'
import * as teamModule from '../dist/_worker.js/pages/interne/formulaires.astro.mjs'
import * as teamApiModule from '../dist/_worker.js/pages/api/interne/formulaires.astro.mjs'

// Real compiled page + API + SQL + private catalogue, synthetic NocoDB only.
// No real credentials/config files are loaded and no external fetch can escape.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-preformation-qa'
await mkdir(output, { recursive: true })
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find((n) =>
  n.startsWith('manifest_'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({
  ...manifest,
  sessionConfig: undefined,
  pageMap: new Map([
    ['src/pages/suivi/pre-formation.astro', async () => pageModule],
    ['src/pages/api/questionnaires/pre-formation.ts', async () => endpointModule],
    ['src/pages/interne/formulaires.astro', async () => teamModule],
    ['src/pages/api/interne/formulaires.ts', async () => teamApiModule],
  ]),
})
const sql = new Database(':memory:')
const migrations = new URL('../migrations/', import.meta.url)
for (const f of (await readdir(migrations)).filter((f) => /^\d.*\.sql$/.test(f)).sort())
  sql.exec(await readFile(new URL(f, migrations), 'utf8'))
sql.exec(
  await readFile(new URL('../workers/google-transition/schema.sql', import.meta.url), 'utf8'),
)
const db = {
  prepare: (query) => ({
    bind: (...values) => ({
      run: async () => ({ meta: { changes: sql.query(query).run(...values).changes } }),
      first: async () => sql.query(query).get(...values),
      all: async () => ({ results: sql.query(query).all(...values) }),
    }),
  }),
}
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'preformation-qa', alg: 'RS256' }
const issuer = 'https://preformation-qa.cloudflareaccess.com'
const jwt = await new SignJWT({ email: 'team@example.invalid' })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setIssuer(issuer)
  .setAudience('team')
  .setSubject('fixture')
  .setExpirationTime('30m')
  .sign(privateKey)
const env = {
  FORM_SUBMISSIONS: db,
  NOCODB_TOKEN: 'fixture-only',
  PUBLIC_FORMS_TABLE: 'publicanswerstable',
  PRE_FORMATION_PERSON_PROJECTION: JSON.stringify(preformationPersonConfig),
  OPERATIONAL_FORMS_ENABLED: 'true',
  TEAM_WORKSPACE: {},
  INTERNAL_ACCESS_DOMAIN: new URL(issuer).hostname,
  INTERNAL_ACCESS_AUD: 'team',
}
const locals = { runtime: { env } },
  rows = [],
  calls = [],
  browserErrors = [],
  adults = [preformationAdult()],
  dossier = preformationDossier()
let failAfterSave = false
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)),
    method = init?.method ?? 'GET'
  calls.push({ url: url.href, method })
  if (url.href === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] })
  assert.equal(url.origin, 'https://app.nocodb.com', 'Unexpected external transport')
  const [, , , , table, , id] = url.pathname.split('/')
  if (table === preformationPersonConfig.tables.records) {
    assert.equal(method, 'GET')
    return Response.json(dossier)
  }
  if (table === preformationPersonConfig.tables.people) {
    if (method === 'POST') {
      const added = JSON.parse(init.body).map((row) => ({ ...row, Id: 100 + adults.length }))
      adults.push(...added)
      return Response.json(added)
    }
    if (method === 'PATCH') {
      for (const patch of JSON.parse(init.body))
        Object.assign(
          adults.find((a) => a.Id === patch.Id),
          patch,
        )
      return Response.json(JSON.parse(init.body))
    }
    assert.equal(method, 'GET')
    if (id) return Response.json(adults.find((a) => a.Id === Number(id)))
    const where = url.searchParams.get('where') ?? ''
    return Response.json({
      list: adults.filter((a) =>
        where.includes('(participations_id,eq,')
          ? where === `(participations_id,eq,${a.participations_id})`
          : where.includes(`(email,eq,${a.email})`) ||
            (a.adulte_id && where.includes(`(adulte_id,eq,${a.adulte_id})`)),
      ),
      pageInfo: { isLastPage: true },
    })
  }
  if (table !== 'publicanswerstable') {
    assert.equal(method, 'GET', 'No dossier/participant mutation')
    assert([NC.tables.etablissements, NC.tables.participations, NC.tables.cohortes].includes(table))
    return Response.json({
      list:
        table === NC.tables.cohortes
          ? [{ Id: 1, active: true, annee_debut: 2026, annee_fin: 2027 }]
          : [],
      pageInfo: { isLastPage: true },
    })
  }
  if (method === 'POST') {
    const added = JSON.parse(init.body).map((row) => ({ ...row, Id: rows.length + 1 }))
    rows.push(...added)
    if (failAfterSave) throw new Error('PRIVATE_TRANSPORT_CANARY')
    return Response.json(added)
  }
  if (method === 'PATCH') {
    for (const patch of JSON.parse(init.body))
      Object.assign(
        rows.find((r) => r.Id === patch.Id),
        patch,
      )
    return Response.json(JSON.parse(init.body))
  }
  assert.equal(method, 'GET', 'Source answers are append-only')
  if (id) return Response.json(rows.find((row) => row.Id === Number(id)))
  const where = url.searchParams.get('where')
  return Response.json({
    list: where ? rows.filter((row) => where === `(cle_reponse,eq,${row.cle_reponse})`) : rows,
  })
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
    { locals },
  )
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url),
      path = url.pathname
    if (path === '/suivi/pre-formation')
      return render(path + url.search, { preview: url.searchParams.has('demo') })
    if (path === '/api/questionnaires/pre-formation')
      return render(path, { method: 'POST', body: await request.text() })
    if (path === '/interne/formulaires' || path === '/api/interne/formulaires')
      return render(path, { authenticated: true })
    if (/^\/(?:_astro|fonts)\//.test(path) || path === '/favicon.svg')
      return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
    return new Response('Not found', { status: 404 })
  },
})
const origin = `http://127.0.0.1:${server.port}`
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
const measures = []
try {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  await context.route('**/*', (route) => {
    assert.equal(
      new URL(route.request().url()).origin,
      origin,
      'Browser external network forbidden',
    )
    return route.continue()
  })
  const page = await context.newPage()
  await page.addInitScript(() => sessionStorage.setItem('euneos-study-dismissed', '1'))
  page.on('pageerror', (error) => browserErrors.push(error.message))
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const response = await page.goto(origin + '/suivi/pre-formation?name=PRIVATE_PREFILL_CANARY')
    assert.equal(response.status(), 200)
    assert.match(response.headers()['cache-control'], /no-store/)
    assert.match(response.headers()['x-robots-tag'], /noindex/)
    assert.equal(response.headers()['referrer-policy'], 'no-referrer')
    await expect(page.locator('#preformation-form [name="name"]')).toHaveValue('')
    await expect(page.locator('main')).not.toContainText('PRIVATE_PREFILL_CANARY')
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      content: document.documentElement.scrollWidth,
    }))
    assert(dimensions.content <= width + 1, `Overflow at ${width}`)
    measures.push(dimensions)
    assert.equal(await page.locator('#preformation-form [name="email"]').count(), 1)
    assert.equal(await page.locator('#preformation-form .pq-choice').count(), 10)
    await page.screenshot({ path: `${output}/preformation-${width}.png`, fullPage: true })
  }
  const fill = async (email = 'adult@example.invalid') => {
    await page.locator('#preformation-form [name="name"]').fill('Adulte Fictif')
    await page.locator('#preformation-form [name="email"]').fill(email)
    await page.locator('#preformation-form [name="school"]').fill('École fictive')
    await page.locator('#preformation-form [name="year"]').fill('2026-2027')
    for (const group of await page.locator('.pq-choice').all())
      await group.locator('input').first().check()
    await page
      .locator('#preformation-form [name="problems"]')
      .fill('Une difficulté fictive\nUne deuxième ligne')
    await page.locator('#preformation-form [name="expectations"]').fill('Une attente fictive')
    await page
      .locator('#preformation-form [name="success"]')
      .fill('<script>PRIVATE_XSS_CANARY</script>')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(origin + '/suivi/pre-formation')
  await page
    .locator('#preformation-form')
    .getByRole('button', { name: 'Envoyer', exact: true })
    .click()
  assert.equal(rows.length, 0, 'Required fields block empty submission')
  await fill()
  // Radio groups support the keyboard as well as pointer/touch.
  await page.locator('#preformation-form [name="role"]').first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('#preformation-form [name="role"]').nth(1)).toBeChecked()
  await page
    .locator('#preformation-form')
    .getByRole('button', { name: 'Envoyer', exact: true })
    .click()
  await expect(page.locator('#preformation-feedback')).toContainText('a bien été enregistrée')
  assert.equal(rows.length, 1)
  assert.equal(JSON.parse(rows[0].reponses).answers.length, 17)
  assert.equal(rows[0].statut_reprise, 'À rapprocher')
  assert.match(adults[0].date_pre_recu, /^20\d{2}-\d{2}-\d{2}$/)
  assert.equal(adults[0].statut, 'Inchangé')
  await expect(page.getByRole('button', { name: 'Réponse reçue' })).toBeDisabled()
  await page.screenshot({ path: `${output}/preformation-confirmation-mobile.png`, fullPage: true })
  // An uncertain POST is reconciled on the same frozen payload, never resubmitted.
  await page.goto(origin + '/suivi/pre-formation')
  await fill('second@example.invalid')
  failAfterSave = true
  await page
    .locator('#preformation-form')
    .getByRole('button', { name: 'Envoyer', exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Vérifier la réception' })).toBeEnabled()
  await expect(page.locator('#preformation-form [name="name"]')).toHaveAttribute('readonly', '')
  assert.equal(rows.length, 2)
  failAfterSave = false
  await page.getByRole('button', { name: 'Vérifier la réception' }).click()
  await expect(page.locator('#preformation-feedback')).toContainText('a bien été enregistrée')
  assert.equal(rows.length, 2)
  // The actual compiled protected catalogue reads the new source alongside old forms.
  await page.goto(origin + '/interne/formulaires')
  await expect(page.locator('#submissions-list')).toContainText(
    'Réception préformation vérifiée sur l’adulte',
  )
  await expect(page.locator('#submissions-list')).toContainText(
    'Réception préformation en attente — à vérifier',
  )
  await page.locator('#submissions-list summary').first().click()
  await expect(page.locator('#submissions-list')).toContainText(
    '<script>PRIVATE_XSS_CANARY</script>',
  )
  assert.equal(await page.locator('#submissions-list script').count(), 0)
  await expect(page.locator('[data-public-form="pre-formation"] input')).toHaveValue(
    'https://euneos.fr/suivi/pre-formation',
  )
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${output}/journal-${width}.png`, fullPage: true })
  }
  const unauthorized = await render('/api/interne/formulaires')
  assert.equal(unauthorized.status, 403)
  const preview = await render('/suivi/pre-formation', { preview: true })
  assert.match(await preview.text(), /Aperçu de démonstration/)
  assert.equal(calls.filter((c) => c.method === 'POST').length, 2)
  assert.equal(
    calls.filter(
      (c) => c.method === 'PATCH' && c.url.includes(preformationPersonConfig.tables.people),
    ).length,
    1,
  )
  const states = sql
    .query('SELECT state,code,adult_id,date_pre FROM public_preformation_projections')
    .all()
  assert(states.some((s) => s.state === 'complete' && s.adult_id === 50 && s.date_pre))
  assert(states.some((s) => s.state === 'review' && s.code === 'identity_conflict'))
  const privateConfig = env.PRE_FORMATION_PERSON_PROJECTION
  delete env.PRE_FORMATION_PERSON_PROJECTION
  const closed = await render('/suivi/pre-formation')
  assert.equal(closed.status, 503)
  assert.doesNotMatch(await closed.text(), /id="preformation-form"/)
  env.PRE_FORMATION_PERSON_PROJECTION = privateConfig
  assert.deepEqual(browserErrors, [])
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        widths: measures,
        answersPerResponse: 17,
        journalRows: rows.length,
        sourceWrites: 2,
        adultWrites: 1,
        pendingCases: 1,
        emails: 0,
        browserErrors,
      },
      null,
      2,
    ),
  )
  console.log(
    'Préformation : 7 largeurs, formulaire → journal simulé → catalogue privé, adulte/date vérifiés + cas ambigu explicitement en attente, reprise après timeout, 0 email.',
  )
} finally {
  await browser.close()
  server.stop(true)
  sql.close()
  globalThis.fetch = realFetch
}
