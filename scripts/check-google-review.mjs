import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import { loadMigrations, executeSQLite } from './lib/internal-migrations.mjs'

// Real compiled Astro pages/API, real local SQL, exclusively fabricated data.
// No .env, .dev.vars, production credentials, Access account or external network.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-google-review-ui'
await mkdir(output, { recursive: true })
const sql = new Database(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
for (const m of loadMigrations()) sql.transaction(() => executeSQLite(sql, m.sql))()
sql.exec(
  await readFile(new URL('../workers/google-transition/schema.sql', import.meta.url), 'utf8'),
)
sql.exec(
  await readFile(
    new URL('../migrations/0004_operational_submissions.sql', import.meta.url),
    'utf8',
  ),
)
for (const name of [
  '0009_public_form_receipts.sql',
  '0010_preformation_projection.sql',
  '0011_postformation_projection.sql',
  '0012_accord_formateur.sql',
  '0014_final_questionnaires.sql',
])
  sql.exec(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'))
const db = {
  prepare: (query) => ({
    bind: (...args) => ({
      all: async () => ({ results: sql.query(query).all(...args) }),
      first: async () => sql.query(query).get(...args),
      run: async () => ({ meta: { changes: sql.query(query).run(...args).changes } }),
    }),
  }),
}
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'review-fixture', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'google-review-fixture.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'team-fixture',
  INTERNAL_ADMIN_EMAILS: 'manager@example.test',
  TEAM_WORKSPACE: db,
  FORM_SUBMISSIONS: db,
  GOOGLE_REVIEW_JOURNAL_TABLE: 'journalfixture123',
  NOCODB_TOKEN: 'fixture-not-a-real-token',
  GOOGLE_REVIEW_CORRECTION_SOURCES: JSON.stringify([
    {
      label: 'Préformation — exemple fictif',
      family: 'preformation',
      mapping: {
        name: 'Prénom et nom',
        email: 'Email professionnel',
        cohort: 'Année scolaire concernée',
        establishment: 'Établissement',
      },
    },
    {
      label: 'Organisation — exemple fictif',
      family: 'organisation',
      mapping: { name: 'Établissement', start: 'Début prévu', end: 'Fin prévue' },
    },
  ]),
}
const token = (aud, email) =>
  new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
    .setAudience(aud)
    .setSubject(`fixture-${email}`)
    .setExpirationTime('30m')
    .sign(privateKey)
const tokens = {
  manager: await token(env.INTERNAL_ACCESS_AUD, 'manager@example.test'),
  member: await token(env.INTERNAL_ACCESS_AUD, 'member@example.test'),
  trainer: await token('trainer-fixture', 'manager@example.test'),
}
const parts = 'mbunbu0f1zztce4',
  adults = 'mzbpzuikti6h3pz',
  schools = 'mg12klh5zv7b5n5',
  trainers = 'mblganql53o34gm',
  journeys = 'mom9m2q83nainyz',
  cohorts = 'm5ayop8ul8s040l'
const marker = (receipt) =>
  `[EUNEOS_GOOGLE_RECONCILIATION_V1]${JSON.stringify(receipt)}[/EUNEOS_GOOGLE_RECONCILIATION_V1]`
const base = {
  Id: 1,
  cle_reponse: 'synthetic-one',
  formulaire: 'Préformation — exemple fictif',
  horodatage_source: '2026-10-01',
  statut_reprise: 'Source conservée — reprise initiale',
  reponses: JSON.stringify([
    { question: 'Établissement', answer: 'École de la Colline' },
    { question: 'Prénom et nom', answer: 'Camille Exemple' },
    { question: 'Année scolaire concernée', answer: '2026-2027' },
    { question: 'Email professionnel', answer: 'camille@example.test' },
    { question: 'Texte original', answer: '<script>window.untrusted=true</script>' },
  ]),
  detail_reprise:
    'Historique fictif préservé' +
    marker({
      version: 1,
      sourceKey: 'synthetic-one',
      targets: [],
      state: 'pending',
      reasons: ['establishment_unresolved'],
      at: '2026-10-01T11:00:00Z',
    }),
  UpdatedAt: '2026-10-01T10:00:00Z',
}
const rows = [
  structuredClone(base),
  {
    ...base,
    Id: 2,
    cle_reponse: 'synthetic-two',
    detail_reprise: marker({
      version: 1,
      sourceKey: 'synthetic-two',
      targets: [
        { table: adults, id: 21, fields: ['date_pre_recu'] },
        { table: parts, id: 7, fields: ['adultes'] },
      ],
      state: 'partial',
      reasons: ['Fin de formation à confirmer'],
      at: '2026-10-01T11:00:00Z',
    }),
  },
  {
    ...base,
    Id: 3,
    cle_reponse: 'synthetic-three',
    detail_reprise: marker({
      version: 1,
      sourceKey: 'synthetic-three',
      targets: [{ table: journeys, id: 8, fields: ['accord_signe'] }],
      state: 'integrated',
      reasons: [],
      at: '2026-10-01T11:00:00Z',
    }),
  },
  {
    ...base,
    Id: 4,
    cle_reponse: 'synthetic-four',
    formulaire: 'Organisation — exemple fictif',
    reponses: JSON.stringify([
      { question: 'Établissement', answer: 'École de la Colline' },
      { question: 'Début prévu', answer: '05/10/2026' },
      { question: 'Fin prévue', answer: '20/12/2026' },
    ]),
    detail_reprise: marker({
      version: 1,
      sourceKey: 'synthetic-four',
      targets: [{ table: parts, id: 7, fields: ['date_debut_formation'] }],
      state: 'partial',
      reasons: ['existing_value_conflict'],
      at: '2026-10-01T11:00:00Z',
    }),
  },
]
const data = {
  [env.GOOGLE_REVIEW_JOURNAL_TABLE]: rows,
  [schools]: [{ Id: 3, nom: 'École de la Colline', ville: 'Ville fictive' }],
  [parts]: [
    {
      Id: 7,
      etablissements_id: 3,
      cohortes_id: 2,
      code: 'DOS-0007',
      statut: 'Établissement engagé',
      date_debut_formation: '2026-10-06',
      date_fin_formation: '2026-12-15',
    },
  ],
  [adults]: [
    {
      Id: 21,
      prenom: 'Camille',
      nom: 'Exemple',
      email: 'camille@example.test',
      participations_id: 7,
    },
  ],
  [trainers]: [{ Id: 4, prenom: 'Alex', nom: 'Fictif', email: 'alex@example.test' }],
  [journeys]: [{ Id: 8, formateurs_id: 4, cohortes_id: 2 }],
  [cohorts]: [{ Id: 2, nom: '2026–2027', annee_debut: 2026, annee_fin: 2027 }],
}
let mutations = 0,
  networkErrors = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  if (url.href === `https://${env.INTERNAL_ACCESS_DOMAIN}/cdn-cgi/access/certs`)
    return Response.json({ keys: [jwk] })
  try {
    assert.equal(url.origin, 'https://app.nocodb.com')
    assert.equal(init.headers?.['xc-token'], env.NOCODB_TOKEN)
    assert.equal(init.redirect, 'manual')
    const meta = /^\/api\/v2\/meta\/tables\/([a-z0-9]+)$/.exec(url.pathname)
    if (meta) {
      assert([adults, parts].includes(meta[1]))
      return Response.json({
        columns: ['date_pre_recu', 'date_debut_formation', 'date_fin_formation'].map((title) => ({
          title,
          uidt: 'Date',
        })),
      })
    }
    const match = /^\/api\/v2\/tables\/([a-z0-9]+)\/records(?:\/(\d+))?$/.exec(url.pathname)
    assert(match, 'Unexpected mocked path')
    const table = match[1]
    assert(data[table], 'Unexpected mocked table')
    if (init.method === 'PATCH') {
      assert([parts, adults].includes(table))
      const body = JSON.parse(init.body)
      assert.equal(body.length, 1)
      assert(
        Object.keys(body[0]).every((key) =>
          ['Id', 'date_pre_recu', 'date_debut_formation', 'date_fin_formation'].includes(key),
        ),
      )
      const record = data[table].find((r) => r.Id === body[0].Id)
      assert(record)
      Object.assign(record, body[0])
      mutations++
      return Response.json(body)
    }
    assert.equal(init.method, 'GET')
    return Response.json(
      match[2]
        ? data[table].find((r) => r.Id === Number(match[2]))
        : { list: data[table], pageInfo: { isLastPage: true } },
    )
  } catch (error) {
    networkErrors.push(error.message)
    throw error
  }
}
const worker = new URL('../dist/_worker.js/', import.meta.url)
const manifestName = (await readdir(worker)).find(
  (f) => f.startsWith('manifest_') && f.endsWith('.mjs'),
)
assert(manifestName, 'Build first')
const { manifest } = await import(new URL(manifestName, worker))
const components = ['interne/reponses-google.astro', 'api/interne/reponses-google.ts']
const pageMap = new Map(
  components.map((path) => [
    `src/pages/${path}`,
    () => import(new URL(`pages/${path.replace(/\.(ts|astro)$/, '.astro.mjs')}`, worker)),
  ]),
)
const app = new App({ ...manifest, sessionConfig: undefined, pageMap })
const render = (
  path,
  role,
  method = 'GET',
  body,
  origin = 'https://euneos.fr',
  host = 'euneos.fr',
) =>
  app.render(
    new Request(`https://${host}${path}`, {
      method,
      headers: {
        ...(tokens[role] ? { 'Cf-Access-Jwt-Assertion': tokens[role] } : {}),
        ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { locals: { runtime: { env } } },
  )
for (const role of [null, 'trainer'])
  for (const path of ['/interne/reponses-google', '/api/interne/reponses-google'])
    assert.equal((await render(path, role)).status, 403)
assert.equal((await render('/api/interne/reponses-google', 'member', 'POST', {})).status, 403)
assert.equal(
  (await render('/api/interne/reponses-google', 'manager', 'POST', {}, 'https://evil.test')).status,
  403,
)
assert.equal(
  (
    await render(
      '/interne/reponses-google',
      'manager',
      'GET',
      undefined,
      'https://euneos.fr',
      'preview.example.test',
    )
  ).status,
  403,
)
assert.equal(mutations, 0)
const server = Bun.serve({
  idleTimeout: 120,
  hostname: '127.0.0.1',
  port: Number(process.env.GOOGLE_REVIEW_TEST_PORT ?? 0),
  async fetch(request) {
    const url = new URL(request.url)
    if (
      url.pathname.startsWith('/_astro/') ||
      url.pathname.startsWith('/fonts/') ||
      url.pathname === '/favicon.svg'
    )
      return new Response(Bun.file(new URL(`../dist${url.pathname}`, import.meta.url)))
    const role = request.headers.get('x-fixture-role') ?? 'manager'
    const body = request.method === 'POST' ? await request.json() : undefined
    // Virtual origin only in this fixture server. Foreign origins stay foreign.
    const origin =
      request.headers.get('Origin') === url.origin
        ? 'https://euneos.fr'
        : (request.headers.get('Origin') ?? 'https://euneos.fr')
    return render(url.pathname + url.search, role, request.method, body, origin)
  },
})
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH,
  }),
  errors = []
try {
  const origin = `http://127.0.0.1:${server.port}`
  for (const width of [1440, 390, 320, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' })
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue()
      networkErrors.push('Unexpected browser request: ' + route.request().url())
      return route.abort()
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(origin + '/interne/reponses-google')
    await expect(page.locator('#gr-feedback')).toContainText('Réponses actualisées', {
      timeout: 20000,
    })
    await expect(
      page.getByRole('link', { name: 'Réponses à vérifier', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.gr-row')).toHaveCount(1)
    await expect(page.locator('.gr-row strong')).toHaveText('Camille Exemple — École de la Colline')
    await page.screenshot({ path: `${output}/list-${width}.png`, fullPage: true })
    await page.locator('#gr-state').selectOption('partial')
    await expect(page.locator('.gr-row')).toHaveCount(2)
    await page.locator('[data-response-id="2"]').click()
    await expect(page.locator('#gr-list-view')).toBeHidden()
    await expect(page.locator('#gr-targets')).toContainText('Camille Exemple — École de la Colline')
    await expect(page.locator('#gr-targets')).toContainText('DOS-0007')
    await expect(page.locator('#gr-reasons')).toHaveText('Fin de formation à confirmer')
    await expect(page.locator('#gr-source')).not.toHaveAttribute('open', '')
    await page.locator('#gr-source summary').click()
    await expect(page.locator('#gr-answers')).toContainText(
      '<script>window.untrusted=true</script>',
    )
    assert.equal(await page.evaluate(() => window.untrusted), undefined)
    await page.locator('#gr-back').click()
    await expect(page.locator('#gr-state')).toHaveValue('partial')
    await expect(page.locator('[data-response-id="2"]')).toBeFocused()
    await page.locator('#gr-state').selectOption('integrated')
    await expect(page.locator('.gr-row')).toHaveCount(1)
    await page.locator('.gr-row').click()
    await expect(page.locator('#gr-targets')).toContainText('Alex Fictif')
    await page.locator('#gr-back').click()
    await page.locator('#gr-state').selectOption('all')
    await page.locator('#gr-search').fill('Alex Fictif')
    await expect(page.locator('.gr-row')).toHaveCount(1)
    await page.locator('#gr-search').fill('')
    await expect(page.locator('.gr-row')).toHaveCount(4)
    await page.locator('[data-response-id="1"]').click()
    if (width === 1440) {
      await expect(page.locator('#gr-form')).toBeVisible({ timeout: 20000 })
      await page.locator('#gr-target').selectOption('school:7')
      await page
        .locator('#gr-reason')
        .fill('Identité, établissement et année vérifiés dans cette fixture')
      await page.locator('#gr-save').click()
      assert.equal(
        sql.query('SELECT count(*) AS n FROM google_review_corrections').get().n,
        0,
        'Identity confirmation required',
      )
      await page.locator('#gr-target-confirm').check()
      await page.locator('#gr-save').click()
      await expect(page.locator('#gr-preview')).toBeVisible({ timeout: 30000 })
      await expect(page.locator('#gr-changes')).toContainText('2026-10-01')
      assert.equal(mutations, 0, 'Preparing must not modify NocoDB')
      await page.locator('#gr-apply').click()
      assert.equal(mutations, 0, 'Exact changes need confirmation')
      await page.screenshot({ path: `${output}/preview-${width}.png`, fullPage: true })
      await page.locator('#gr-confirm').check()
      await page.locator('#gr-apply').click()
      await expect(page.locator('#gr-correction-result')).toBeVisible({ timeout: 45000 })
      await expect(page.locator('#gr-result-title')).toHaveText(
        'Correction appliquée et vérifiée',
        { timeout: 30000 },
      )
      assert.equal(mutations, 1)
      assert.equal(data[adults][0].date_pre_recu, '2026-10-01')
      assert.equal(rows[0].reponses, base.reponses)
      assert.equal(rows[0].detail_reprise, base.detail_reprise)
      assert.equal(sql.query('SELECT state FROM google_review_corrections').get().state, 'complete')
      await page.reload()
      await expect(page.locator('#gr-result-title')).toHaveText(
        'Correction appliquée et vérifiée',
        { timeout: 20000 },
      )
      assert.equal(mutations, 1, 'Refreshing never repeats a write')
      await page.locator('#gr-back').click()
      await page.locator('#gr-state').selectOption('partial')
      await page.locator('[data-response-id="4"]').click()
      await expect(page.locator('#gr-form')).toBeVisible({ timeout: 20000 })
      await page.locator('#gr-target').selectOption('school:7')
      await page
        .locator('#gr-reason')
        .fill('Les dates source ont été confirmées pour cette fixture')
      await page.locator('#gr-target-confirm').check()
      await page.locator('#gr-save').click()
      await expect(page.locator('#gr-preview')).toBeVisible({ timeout: 30000 })
      await expect(page.locator('#gr-changes')).toContainText('2026-10-06')
      await expect(page.locator('#gr-changes')).toContainText('2026-10-05')
      await expect(page.locator('#gr-changes')).toContainText('2026-12-20')
      await page.locator('#gr-confirm').check()
      await page.locator('#gr-apply').click()
      await expect(page.locator('#gr-correction-result')).toBeVisible({ timeout: 45000 })
      await expect(page.locator('#gr-result-title')).toHaveText(
        'Correction appliquée et vérifiée',
        { timeout: 30000 },
      )
      assert.equal(mutations, 2)
      assert.equal(data[parts][0].date_debut_formation, '2026-10-05')
      assert.equal(data[parts][0].date_fin_formation, '2026-12-20')
    } else {
      await expect(page.locator('#gr-result-title')).toHaveText(
        'Correction appliquée et vérifiée',
        { timeout: 20000 },
      )
    }
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'No horizontal overflow',
    )
    await page.screenshot({ path: `${output}/review-${width}.png`, fullPage: true })
    await context.close()
  }
  const member = await browser.newContext({
    extraHTTPHeaders: { 'x-fixture-role': 'member' },
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 900 },
  })
  const memberPage = await member.newPage()
  await memberPage.goto(origin + '/interne/reponses-google#reponse-1')
  await expect(memberPage.locator('#gr-access')).toContainText('consultation')
  await expect(memberPage.locator('#gr-result-title')).toHaveText(
    'Correction appliquée et vérifiée',
    { timeout: 20000 },
  )
  await expect(memberPage.locator('#gr-form')).toBeHidden()
  await expect(memberPage.locator('#gr-readonly')).toBeVisible()
  await member.close()
  assert.equal(mutations, 2)
  assert.deepEqual(networkErrors, [])
  assert.deepEqual(errors, [])
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        widths: [1440, 390, 320, 768],
        mutations,
        externalRequests: 0,
        tests: [
          'access',
          'csrf',
          'preview denial',
          'identity and source',
          'filters and back focus',
          'deep link',
          'correction preview',
          'required confirmations',
          'NocoDB write and readback',
          'source unchanged',
          'audit restored on refresh',
          'dates conflict resolved',
          'read-only role',
          'no overflow',
          'escaped source',
        ],
      },
      null,
      2,
    ),
  )
  console.log(`Compiled Google review checks passed; screenshots: ${output}`)
} finally {
  await browser.close()
  server.stop(true)
  sql.close()
  globalThis.fetch = originalFetch
}
