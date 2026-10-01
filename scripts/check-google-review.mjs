import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
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
  GOOGLE_REVIEW_JOURNAL_TABLE: 'journalfixture123',
  NOCODB_TOKEN: 'fixture-not-a-real-token',
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
    { question: 'Participant', answer: 'Camille Exemple' },
    { question: 'Texte original', answer: '<script>window.untrusted=true</script>' },
  ]),
  detail_reprise: 'Historique fictif préservé',
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
    },
  ],
  [adults]: [{ Id: 21, prenom: 'Camille', nom: 'Exemple', participations_id: 7 }],
  [trainers]: [{ Id: 4, prenom: 'Alex', nom: 'Fictif', email: 'alex@example.test' }],
  [journeys]: [{ Id: 8, formateurs_id: 4, cohortes_id: 2 }],
  [cohorts]: [{ Id: 2, nom: '2026–2027' }],
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
    const match = /^\/api\/v2\/tables\/([a-z0-9]+)\/records(?:\/(\d+))?$/.exec(url.pathname)
    assert(match, 'Unexpected mocked path')
    const table = match[1]
    assert(data[table], 'Unexpected mocked table')
    if (init.method !== 'GET') mutations++
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
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
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
    await expect(page.getByRole('link', { name: 'Réponses Google', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.locator('.gr-row')).toHaveCount(1)
    await expect(page.locator('#gr-state option:checked')).toHaveText('À examiner (1)')
    await expect(page.locator('.gr-row strong')).toHaveText('Réponse #1')
    await page.locator('#gr-state').selectOption('partial')
    await expect(page.locator('.gr-row')).toHaveCount(1)
    await expect(page.locator('#gr-state option:checked')).toHaveText('Intégrations partielles (1)')
    await page.locator('.gr-row').filter({ hasText: 'Réponse #2' }).click()
    await expect(page.locator('#gr-targets')).toContainText('Camille Exemple — École de la Colline')
    await expect(page.locator('#gr-targets')).toContainText('DOS-0007')
    await expect(page.locator('#gr-reasons')).toHaveText('Fin de formation à confirmer')
    assert.equal(await page.evaluate(() => window.untrusted), undefined)
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'No horizontal overflow',
    )
    await page.screenshot({ path: `${output}/review-${width}.png`, fullPage: true })
    await page.locator('#gr-state').selectOption('integrated')
    await expect(page.locator('.gr-row')).toHaveCount(1)
    await page.locator('.gr-row').click()
    await expect(page.locator('#gr-targets')).toContainText('Alex Fictif')
    await page.locator('#gr-state').selectOption('all')
    await page.locator('#gr-search').fill('Alex Fictif')
    await expect(page.locator('.gr-row')).toHaveCount(1)
    await page.locator('#gr-search').fill('')
    await page.locator('#gr-state').selectOption('pending')
    await page.locator('.gr-row').filter({ hasText: 'Réponse #1' }).click()
    if (width === 1440) {
      await page.locator('#gr-target').selectOption('school:7')
      await page.locator('#gr-reason').fill('École et cohorte vérifiées dans la réponse fictive')
      await page.locator('#gr-save').click()
      assert.equal(
        sql.query('SELECT count(*) AS n FROM google_review_attachments').get().n,
        0,
        'Checkbox required',
      )
      await page.locator('#gr-confirm').check()
      await page.locator('#gr-save').click()
      await expect(page.locator('#gr-feedback')).toContainText('Rattachement enregistré', {
        timeout: 20000,
      })
      await expect(page.locator('#gr-form')).toBeHidden()
      await expect(page.locator('#gr-readonly')).toContainText('École de la Colline')
      assert.equal(mutations, 0)
      assert.equal(sql.query('SELECT state FROM google_review_attachments').get().state, 'complete')
      assert.equal(rows[0].statut_reprise, base.statut_reprise)
      assert.equal(rows[0].reponses, base.reponses)
      assert.equal(rows[0].detail_reprise, base.detail_reprise)
      await page.locator('#gr-refresh').click()
      await expect(page.locator('#gr-feedback')).toContainText('Réponses actualisées', {
        timeout: 20000,
      })
      await page.locator('.gr-row').filter({ hasText: 'Réponse #1' }).click()
      await expect(page.locator('#gr-form')).toBeHidden()
      await expect(page.locator('#gr-readonly')).toContainText('École de la Colline')
      const stale = await render('/api/interne/reponses-google', 'manager', 'POST', {
        id: 1,
        version: 'a'.repeat(64),
        targetKind: 'school',
        targetId: 7,
        reason: 'Test',
        confirmed: true,
      })
      assert.equal(stale.status, 409)
      assert.equal(mutations, 0)
    } else await expect(page.locator('#gr-form')).toBeHidden()
    await context.close()
  }
  assert.deepEqual(networkErrors, [])
  assert.deepEqual(errors, [])
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        widths: [1440, 390],
        mutations,
        externalRequests: 0,
        tests: [
          'access',
          'csrf',
          'preview denial',
          'receipt labels',
          'adult and dossier',
          'pending and partial filters with counts',
          'nonpersonal row titles',
          'D1 attachment restored on refresh with no NocoDB write',
          'no overflow',
          'escaped source',
          'confirmation',
          'audit',
          'double submit',
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
