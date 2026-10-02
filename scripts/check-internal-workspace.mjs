import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'

// Actual compiled pages and routes + real SQL migration. Synthetic identities
// and data only, no production credentials, no network beyond this local server.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-internal-workspace'
await mkdir(output, { recursive: true })
const sql = new Database(':memory:')
sql.exec('PRAGMA foreign_keys = ON')
const migrations = new URL('../migrations/interne/', import.meta.url)
for (const file of (await readdir(migrations)).filter((name) => /^\d.*\.sql$/.test(name)).sort()) {
  const migration = await readFile(new URL(file, migrations), 'utf8')
  sql.transaction(() => sql.exec(migration))()
}
let reads = 0,
  failDatabase = false
const db = {
  async batch(statements) {
    return sql.transaction(() => statements.map((statement) => statement.execute()))()
  },
  prepare(query) {
    if (failDatabase) throw new Error('Synthetic private database failure')
    reads++
    return {
      bind(...values) {
        const statement = sql.query(query)
        return {
          all: async () => ({ results: statement.all(...values) }),
          first: async () => statement.get(...values),
          run: async () => ({ meta: { changes: statement.run(...values).changes } }),
          execute: () => ({ meta: { changes: statement.run(...values).changes } }),
        }
      },
    }
  },
}
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'workspace-fixture', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'workspace-fixture.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'team-fixture',
  RESOURCE_ACCESS_DOMAIN: 'workspace-fixture.cloudflareaccess.com',
  RESOURCE_ACCESS_AUD: 'resource-fixture',
  INTERNAL_ADMIN_EMAILS: 'manager@example.test',
  INTERNAL_WORKSPACE_PREVIEW: 'true',
  TEAM_WORKSPACE: db,
}
const token = (aud, email) =>
  new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setSubject(`fixture-${email}`)
    .setAudience(aud)
    .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
    .setExpirationTime('30m')
    .sign(privateKey)
const tokens = {
  member: await token(env.INTERNAL_ACCESS_AUD, 'member@example.test'),
  manager: await token(env.INTERNAL_ACCESS_AUD, 'manager@example.test'),
  trainer: await token(env.RESOURCE_ACCESS_AUD, 'trainer@example.test'),
  trainerManager: await token(env.RESOURCE_ACCESS_AUD, 'manager@example.test'),
}
const originalFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  assert.equal(
    String(input),
    `https://${env.INTERNAL_ACCESS_DOMAIN}/cdn-cgi/access/certs`,
    'Unexpected external request',
  )
  return Response.json({ keys: [jwk] })
}
const worker = new URL('../dist/_worker.js/', import.meta.url)
const manifestName = (await readdir(worker)).find(
  (f) => f.startsWith('manifest_') && f.endsWith('.mjs'),
)
const { manifest } = await import(new URL(manifestName, worker))
const components = [
  'interne/index.astro',
  'interne/ressources.astro',
  'interne/catalogue.astro',
  'etat-candidatures.astro',
  'api/interne/calendrier.ts',
  'api/interne/commentaires.ts',
  'api/interne/ressources.ts',
  'api/interne/catalogue.ts',
]
const pageMap = new Map(
  components.map((path) => [
    `src/pages/${path}`,
    () =>
      import(
        new URL(
          `pages/${path.replace('/index.astro', '.astro').replace(/\.(ts|astro)$/, '.astro.mjs')}`,
          worker,
        )
      ),
  ]),
)
const app = new App({ ...manifest, sessionConfig: undefined, pageMap })
const call = (path, role, method = 'GET', body, extraHeaders = {}, environment = env) =>
  app.render(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: {
        ...(tokens[role] ? { 'Cf-Access-Jwt-Assertion': tokens[role] } : {}),
        ...(body ? { Origin: 'http://127.0.0.1', 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { locals: { runtime: { env: environment } } },
  )
const baseEntry = (extra) => ({
  kind: 'equipe',
  title: 'Préparation des ateliers',
  starts_on: '2026-09-17',
  ends_on: '2026-09-17',
  person: extra?.kind === 'editorial' ? 'Pauline' : 'member@example.test',
  activity: 'Formation',
  channel: '',
  attendance: 'presence',
  location: 'À distance',
  status: 'a_valider',
  hours: 3,
  notes: '',
  content: '',
  link: '',
  ...extra,
})
const routes = [
  '/interne',
  '/interne/ressources',
  '/interne/catalogue',
  '/etat-candidatures',
  '/api/interne/calendrier?month=2026-09&kind=equipe',
  '/api/interne/calendrier?entryId=' + crypto.randomUUID(),
  '/api/interne/commentaires?entryId=' + crypto.randomUUID(),
  '/api/interne/ressources',
]
for (const path of routes) assert.equal((await call(path, null)).status, 403, `Anonymous: ${path}`)
assert.equal(reads, 0)
assert.equal((await call('/interne', 'member', 'GET', undefined, {}, {})).status, 503)
for (const role of ['trainer', 'trainerManager']) {
  for (const path of [
    '/interne',
    '/interne/catalogue',
    '/etat-candidatures',
    '/api/interne/calendrier?month=2026-09&kind=equipe',
  ])
    assert.equal((await call(path, role)).status, 403)
  assert.equal((await call('/api/interne/catalogue', role, 'POST', {})).status, 403)
}
assert.equal(reads, 0, 'Wrong audiences cannot reach the database')
assert.equal((await call('/interne/catalogue', 'member')).status, 403)
assert.match(await (await call('/interne', 'member')).text(), /Espace d’essai\./)
assert.doesNotMatch(
  await (
    await call(
      '/interne',
      'member',
      'GET',
      undefined,
      {},
      {
        ...env,
        INTERNAL_WORKSPACE_PREVIEW: undefined,
      },
    )
  ).text(),
  /Espace d’essai\./,
)
assert.equal((await call('/api/interne/ressources', 'trainer')).status, 200)
const productionHtml = await (
  await call(
    '/interne',
    'member',
    'GET',
    undefined,
    {},
    {
      ...env,
      INTERNAL_WORKSPACE_PREVIEW: undefined,
      INTERNAL_WORKSPACE_IMPORT_PENDING: 'true',
    },
  )
).text()
assert.doesNotMatch(productionHtml, /Reprise de l’historique Notion en cours/)
assert.doesNotMatch(productionHtml, /Espace d’essai\./)
const withoutAdmins = { ...env, INTERNAL_ADMIN_EMAILS: undefined }
assert.equal(
  (
    await (
      await call(
        '/api/interne/calendrier?month=2026-09&kind=equipe',
        'manager',
        'GET',
        undefined,
        {},
        withoutAdmins,
      )
    ).json()
  ).identity.admin,
  false,
)
assert.equal(
  (
    await call(
      '/api/interne/calendrier',
      'manager',
      'POST',
      {
        requestId: crypto.randomUUID(),
        entry: baseEntry({
          person: 'manager@example.test',
          status: 'valide',
          hours: null,
          daily_hours: JSON.stringify([{ date: '2026-09-17', planned: 7, actual: 8 }]),
        }),
      },
      {},
      withoutAdmins,
    )
  ).status,
  403,
)

const id = crypto.randomUUID(),
  body = { requestId: id, entry: baseEntry() }
for (let i = 0; i < 2; i++)
  assert.equal((await call('/api/interne/calendrier', 'member', 'POST', body)).status, 201)
assert.equal(sql.query('SELECT count(*) n FROM workspace_entries').get().n, 1)
assert.equal(
  (
    await call(
      '/api/interne/calendrier',
      'member',
      'POST',
      { requestId: crypto.randomUUID(), entry: baseEntry() },
      { Origin: 'https://untrusted.example' },
    )
  ).status,
  403,
)
assert.equal(
  (
    await call('/api/interne/calendrier', 'member', 'PATCH', {
      id,
      version: 1,
      entry: baseEntry({ hours: 4 }),
    })
  ).status,
  200,
)
assert.equal(
  (
    await call('/api/interne/calendrier', 'member', 'PATCH', {
      id,
      version: 1,
      entry: baseEntry({ hours: 9 }),
    })
  ).status,
  409,
)
assert.equal(sql.query('SELECT hours FROM workspace_entries WHERE id=?').get(id).hours, 4)
const commentId = crypto.randomUUID(),
  comment = {
    requestId: commentId,
    entryId: id,
    content: '<img src=x onerror=alert(1)>',
    author: 'forged@example.test',
  }
for (let i = 0; i < 2; i++)
  assert.equal((await call('/api/interne/commentaires', 'member', 'POST', comment)).status, 201)
assert.equal(sql.query('SELECT count(*) n FROM workspace_comments').get().n, 1)
assert.equal(sql.query('SELECT author FROM workspace_comments').get().author, 'member@example.test')
const resource = {
  requestId: crypto.randomUUID(),
  title: 'Guide des ateliers',
  category: 'Formation',
  description: 'Pour préparer la prochaine session.',
  url: 'https://example.test/guide.pdf',
}
for (let i = 0; i < 2; i++)
  assert.equal((await call('/api/interne/catalogue', 'manager', 'POST', resource)).status, 201)
assert.equal(sql.query('SELECT count(*) n FROM workspace_resources').get().n, 1)
sql
  .query(
    'INSERT INTO workspace_resources (id,title,category,description,url,published,updated_by) VALUES (?,?,?,?,?,0,?)',
  )
  .run(
    crypto.randomUUID(),
    'Confidentiel non publié',
    'Interne',
    '',
    'https://example.test/private',
    'manager@example.test',
  )
const library = await (await call('/api/interne/ressources', 'trainer')).json()
assert.equal(library.resources.length, 1)
assert(!JSON.stringify(library).includes('Confidentiel'))
await call('/api/interne/calendrier', 'manager', 'POST', {
  requestId: crypto.randomUUID(),
  entry: baseEntry({
    kind: 'editorial',
    title: 'Faire découvrir le programme',
    activity: 'Communication',
    channel: 'LinkedIn',
    attendance: '',
    location: '',
    hours: null,
  }),
})
for (const status of ['en_cours', 'a_creer', 'a_modifier']) {
  const statusId = crypto.randomUUID()
  assert.equal(
    (
      await call('/api/interne/calendrier', 'manager', 'POST', {
        requestId: statusId,
        entry: baseEntry({ kind: 'editorial', status, hours: null }),
      })
    ).status,
    201,
  )
  assert.equal(
    sql.query('SELECT status FROM workspace_entries WHERE id=?').get(statusId).status,
    status,
  )
}
const legacyId = crypto.randomUUID()
const legacyChannel = 'Réseau historique · partenariats'
const legacyTitle = 'Publication historique de démonstration'
assert.equal(
  (
    await call('/api/interne/calendrier', 'manager', 'POST', {
      requestId: legacyId,
      entry: baseEntry({
        kind: 'editorial',
        title: legacyTitle,
        ends_on: '2026-09-20',
        channel: legacyChannel,
        activity: 'Communication historique',
        hours: null,
        content: 'Texte de la publication fictive.',
        notes: 'Sources et inspirations fictives.',
      }),
    })
  ).status,
  201,
)
await call('/api/interne/calendrier', 'manager', 'POST', {
  requestId: crypto.randomUUID(),
  entry: baseEntry({ title: 'Coordination validée', status: 'valide', hours: 2 }),
})
const totals = await (
  await call('/api/interne/calendrier?month=2026-09&kind=equipe', 'member')
).json()
assert.deepEqual(totals.totals, [{ person: 'member@example.test', declared: 6, approved: 2 }])
assert(!('source_payload' in totals.entries[0]))
// Deletion uses the same compiled route and real SQL, with synthetic records only.
const deletionId = crypto.randomUUID()
await call('/api/interne/calendrier', 'member', 'POST', { requestId: deletionId, entry: baseEntry() })
await call('/api/interne/commentaires', 'member', 'POST', { entryId: deletionId, content: 'Commentaire fictif', requestId: crypto.randomUUID() })
const deletionBody = { id: deletionId, version: 1, confirmed: true }
for (const role of [null, 'trainer', 'trainerManager'])
  assert.equal((await call('/api/interne/calendrier', role, 'DELETE', deletionBody)).status, 403)
assert.equal((await call('/api/interne/calendrier', 'member', 'DELETE', deletionBody, { Origin: 'https://untrusted.example' })).status, 403)
assert.equal((await call('/api/interne/calendrier', 'member', 'DELETE', { ...deletionBody, confirmed: false })).status, 400)
assert.equal((await call('/api/interne/calendrier', 'member', 'DELETE', { ...deletionBody, version: 0 })).status, 400)
assert.equal((await call('/api/interne/calendrier', 'member', 'DELETE', { ...deletionBody, version: 2 })).status, 409)
assert.equal(sql.query('SELECT count(*) n FROM workspace_comments WHERE entry_id=?').get(deletionId).n, 1)
sql.query("UPDATE workspace_entries SET created_by='manager@example.test' WHERE id=?").run(deletionId)
assert.equal((await call('/api/interne/calendrier', 'member', 'DELETE', deletionBody)).status, 403)
sql.query("UPDATE workspace_entries SET created_by='member@example.test', status='valide' WHERE id=?").run(deletionId)
assert.equal((await call('/api/interne/calendrier', 'member', 'DELETE', deletionBody)).status, 403)
// A parent deletion failure must roll back the child deletion as well.
sql.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON workspace_entries BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
assert.equal((await call('/api/interne/calendrier', 'manager', 'DELETE', deletionBody)).status, 503)
assert.equal(sql.query('SELECT count(*) n FROM workspace_comments WHERE entry_id=?').get(deletionId).n, 1)
sql.exec('DROP TRIGGER fail_delete')
assert.equal((await call('/api/interne/calendrier', 'manager', 'DELETE', deletionBody)).status, 200)
assert.equal(sql.query('SELECT count(*) n FROM workspace_comments WHERE entry_id=?').get(deletionId).n, 0)
assert.equal(sql.query('SELECT count(*) n FROM workspace_entries WHERE id=?').get(deletionId).n, 0)
assert.equal((await call('/api/interne/calendrier', 'manager', 'DELETE', deletionBody)).status, 404)
for (const kind of ['equipe', 'editorial']) {
  const ownId = crypto.randomUUID()
  await call('/api/interne/calendrier', 'member', 'POST', { requestId: ownId, entry: baseEntry({ kind }) })
  if (kind === 'editorial') sql.query("UPDATE workspace_entries SET created_by='manager@example.test' WHERE id=?").run(ownId)
  assert.equal((await call('/api/interne/calendrier', 'member', 'DELETE', { id: ownId, version: 1, confirmed: true })).status, 200)
  assert.equal(sql.query('SELECT count(*) n FROM workspace_entries WHERE id=?').get(ownId).n, 0)
}
const moveId = crypto.randomUUID()
await call('/api/interne/calendrier', 'member', 'POST', { requestId: moveId, entry: baseEntry({ kind: 'editorial', title: 'Publication mobile de recette', person: 'Pauline', notes: 'Texte à préserver' }) })
const moveBody = { action: 'move', id: moveId, version: 1, date: '2026-09-23' }
for (const role of [null, 'trainer', 'trainerManager']) assert.equal((await call('/api/interne/calendrier', role, 'PATCH', moveBody)).status, 403)
assert.equal((await call('/api/interne/calendrier', 'member', 'PATCH', moveBody, { Origin: 'https://untrusted.example' })).status, 403)
assert.equal((await call('/api/interne/calendrier', 'member', 'PATCH', { ...moveBody, date: '2026-02-30' })).status, 400)
assert.equal((await call('/api/interne/calendrier', 'member', 'PATCH', { ...moveBody, version: 0 })).status, 400)
assert.equal((await call('/api/interne/calendrier', 'member', 'PATCH', { ...moveBody, id, version: 2 })).status, 400)
assert.equal((await call('/api/interne/calendrier', 'member', 'PATCH', moveBody)).status, 200)
assert.equal((await call('/api/interne/calendrier', 'member', 'PATCH', moveBody)).status, 409)
assert.deepEqual(sql.query('SELECT starts_on,ends_on,notes,person FROM workspace_entries WHERE id=?').get(moveId), { starts_on: '2026-09-23', ends_on: '2026-09-23', notes: 'Texte à préserver', person: 'Pauline' })
const outsideMonthId = crypto.randomUUID()
await call('/api/interne/calendrier', 'manager', 'POST', { requestId: outsideMonthId, entry: baseEntry({ person: 'alex@example.test', activity: 'Activité historique hors mois', starts_on: '2025-01-03', ends_on: '2025-01-03' }) })
const options = await (await call('/api/interne/calendrier?month=2026-09&kind=equipe', 'member')).json()
assert(options.filterOptions.people.includes('alex@example.test'))
assert(options.filterOptions.activities.includes('Activité historique hors mois'))
assert(!options.entries.some((entry) => entry.id === outsideMonthId))
const duplicatePaulineId = crypto.randomUUID()
await call('/api/interne/calendrier', 'member', 'POST', { requestId: duplicatePaulineId, entry: baseEntry({ kind: 'editorial', person: 'pauline.fixture@example.test', title: 'Doublon prénom fictif' }) })
console.log('Routes compilées : JWT, rôles, CSRF, SQL, versions, idempotence, auteurs, filtres tous mois et totaux OK.')

let comparisonGate = null,
  comparisonStarted = () => {}
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.searchParams.has('entryId') && comparisonGate) {
      comparisonStarted()
      await comparisonGate
    }
    if (url.pathname.startsWith('/interne') || url.pathname.startsWith('/api/interne')) {
      // This fixture header exists only in this test server; never in site code.
      const headers = new Headers(request.headers),
        role = headers.get('X-Fixture-Role') ?? 'member'
      if (tokens[role]) headers.set('Cf-Access-Jwt-Assertion', tokens[role])
      return app.render(new Request(request, { headers }), { locals: { runtime: { env } } })
    }
    if (/^\/(_astro|fonts)\//.test(url.pathname) || url.pathname === '/favicon.svg')
      return new Response(Bun.file(new URL(`../dist${url.pathname}`, import.meta.url)))
    return new Response('Not found', { status: 404 })
  },
})
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
const checks = []
try {
  const page = await browser.newPage({
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'X-Fixture-Role': 'member' },
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const origin = `http://127.0.0.1:${server.port}`
  for (const width of [320, 390, 599, 600, 768, 860, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`${origin}/interne`)
    await expect(page.locator('#iw-calendar-content')).toHaveAttribute('aria-busy', 'false')
    await page.locator('#iw-month').fill('2026-09')
    await page.locator('#iw-month').press('Tab')
    await expect(page.locator('#iw-calendar-content')).toContainText('Faire découvrir le programme')
    await expect(page.locator('#iw-monthly-action, #iw-totals')).toHaveCount(0)
    await page.evaluate(() => document.fonts.ready)
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Calendar overflow ${width}`,
    )
    if ([390, 1440].includes(width))
      await page.screenshot({ path: `${output}/calendrier-${width}.png`, fullPage: true })
    checks.push(`calendar-${width}`)
  }
  assert.equal(await page.locator('#iw-person option').filter({ hasText: /^Pauline$/ }).count(), 1)
  await page.locator('#iw-person').selectOption('Pauline')
  await expect(page.locator('#iw-calendar-content')).toContainText('Doublon prénom fictif')
  await page.locator('#iw-person').selectOption('')
  await page.setViewportSize({ width: 1440, height: 1000 })
  const movingCard = () => page.locator(`.iw-event[data-entry-id="${moveId}"]`)
  await movingCard().dragTo(page.locator('.iw-day[data-date="2026-09-24"]'))
  await expect(page.locator('#iw-notice')).toContainText('Publication déplacée')
  await expect(page.locator(`.iw-day[data-date="2026-09-24"] [data-entry-id="${moveId}"]`)).toHaveCount(1)
  assert.equal(sql.query('SELECT starts_on FROM workspace_entries WHERE id=?').get(moveId).starts_on, '2026-09-24')
  sql.query('UPDATE workspace_entries SET version=version+1 WHERE id=?').run(moveId)
  await movingCard().dragTo(page.locator('.iw-day[data-date="2026-09-25"]'))
  await expect(page.locator('#iw-notice')).toContainText('Déplacement non confirmé')
  assert.equal(sql.query('SELECT starts_on FROM workspace_entries WHERE id=?').get(moveId).starts_on, '2026-09-24')
  await page.locator('#iw-refresh').click()
  await expect(page.locator('#iw-calendar-content')).toHaveAttribute('aria-busy', 'false')
  await movingCard().focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(page.locator('#iw-notice')).toContainText('Publication déplacée')
  await expect(page.locator(`.iw-day[data-date="2026-09-25"] [data-entry-id="${moveId}"]`)).toHaveCount(1)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const card = page.locator(`[data-entry-id="${moveId}"]`).filter({ visible: true }).first()
    await card.scrollIntoViewIfNeeded()
    await card.evaluate((element) => element.addEventListener('click', () => { window.__beforeCardScroll = window.scrollY }, { capture: true, once: true }))
    await card.click()
    const beforeOpen = await page.evaluate(() => window.__beforeCardScroll)
    await expect(page.locator('#iw-open-link')).toHaveCount(0)
    await expect(page.locator('#iw-starts')).toHaveValue('2026-09-25')
    assert.deepEqual(await page.locator('#iw-entry-person option').allTextContents(), ['Sélectionner une personne', 'Pauline', 'Candice', 'Charlotte', 'Partenaires'])
    await page.locator('#iw-entry-person').selectOption('Candice')
    await page.locator('#iw-save').click()
    await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
    assert.equal(sql.query('SELECT person FROM workspace_entries WHERE id=?').get(moveId).person, 'Candice')
    await expect(page.locator('#iw-notice')).not.toContainText('enregistrée')
    await expect(page.locator('#iw-calendar-content')).toHaveAttribute('aria-busy', 'false')
    await page.screenshot({ path: `${output}/publication-personne-${width}.png` })
    await page.locator('#iw-close').click()
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - beforeOpen), { message: `Closing a saved card preserves the page position (${width}px, initial ${beforeOpen})` }).toBeLessThan(3)
  }
  checks.push('publication-drag-keyboard-date-persist-conflict-person-select-mobile-desktop')
  // Confirmation cancellation, errors and deletion on mobile and desktop.
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const deleteTitle = `Fiche fictive à supprimer ${width}`
    const browserDeleteId = crypto.randomUUID()
    await call('/api/interne/calendrier', 'member', 'POST', { requestId: browserDeleteId, entry: baseEntry({ kind: 'editorial', title: deleteTitle }) })
    await call('/api/interne/commentaires', 'member', 'POST', { entryId: browserDeleteId, content: 'Commentaire fictif', requestId: crypto.randomUUID() })
    await page.locator('#iw-refresh').click()
    await page.getByRole('button', { name: new RegExp(`^Ouvrir ${deleteTitle},`) }).first().click()
    const deleteControl = page.locator('#iw-delete')
    await expect(deleteControl).toBeVisible()
    await deleteControl.scrollIntoViewIfNeeded()
    const bounds = await deleteControl.boundingBox()
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width)
    await page.screenshot({ path: `${output}/supprimer-fiche-${width}.png` })
    page.once('dialog', (dialog) => { assert.match(dialog.message(), /tous ses commentaires/); return dialog.dismiss() })
    await deleteControl.click()
    assert(sql.query('SELECT id FROM workspace_entries WHERE id=?').get(browserDeleteId))
    // Failure preserves the open editor and never reports success.
    await page.route('**/api/interne/calendrier', async (route) => {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Erreur fictive' }) })
      return route.continue()
    })
    page.once('dialog', (dialog) => dialog.accept())
    await deleteControl.click()
    await expect(page.locator('#iw-save-feedback')).toContainText('La suppression n’est pas confirmée')
    assert(sql.query('SELECT id FROM workspace_entries WHERE id=?').get(browserDeleteId))
    await page.unroute('**/api/interne/calendrier')
    page.once('dialog', (dialog) => dialog.accept())
    await deleteControl.click()
    await expect(page.locator('#iw-notice')).toContainText(`« ${deleteTitle} » a été supprimée.`)
    await expect(page.getByRole('button', { name: new RegExp(`^Ouvrir ${deleteTitle},`) })).toHaveCount(0)
    assert.equal(sql.query('SELECT count(*) n FROM workspace_comments WHERE entry_id=?').get(browserDeleteId).n, 0)
    assert.equal(sql.query('SELECT count(*) n FROM workspace_entries WHERE id=?').get(browserDeleteId).n, 0)
    checks.push(`delete-confirm-cancel-error-comments-${width}`)
  }
  // PR18: editing another field must not erase a legacy free-text channel.
  // These interactions use the compiled client/API and read back the real fixture SQL.
  const channel = page.locator('#iw-entry-channel')
  const editor = page.locator('#iw-editor')
  const openLegacy = () =>
    page.getByRole('button', { name: new RegExp(`^Ouvrir ${legacyTitle},`) }).click()
  await page.locator('[data-view="list"]').click()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await openLegacy()
    await expect(channel).toHaveValue(legacyChannel)
    await expect(channel.locator('option[data-legacy-channel]')).toHaveCount(1)
    await expect(channel.locator('option[data-legacy-channel]')).toHaveText(
      `${legacyChannel} (ancien canal)`,
    )
    await expect(page.locator('#iw-entry-activity')).toBeHidden()
    await expect(page.locator('#iw-entry-activity')).toHaveValue('Communication historique')
    assert(
      await page.evaluate(() => {
        const content = document.querySelector('#iw-content'),
          notes = document.querySelector('#iw-notes')
        return (
          !!(content.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          notes.getBoundingClientRect().top > content.getBoundingClientRect().bottom
        )
      }),
      'Notes stay below content',
    )
    assert(
      await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `Editor overflow ${width}`,
    )
    await channel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/fiche-canal-${width}.png` })
    await page.locator('#iw-notes').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/fiche-contenu-notes-${width}.png` })
    await page.locator('#iw-notes').fill(`Note modifiée à ${width} px`)
    await page.locator('#iw-save').click()
    await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
    assert.deepEqual(
      sql.query('SELECT channel,activity,notes FROM workspace_entries WHERE id=?').get(legacyId),
      {
        channel: legacyChannel,
        activity: 'Communication historique',
        notes: `Note modifiée à ${width} px`,
      },
    )
    assert.equal(
      sql.query('SELECT ends_on FROM workspace_entries WHERE id=?').get(legacyId).ends_on,
      '2026-09-20',
      'An unchanged historical editorial period stays intact',
    )
    await page.locator('#iw-close').click()
    await expect(editor).not.toBeVisible()
    await page.getByRole('button', { name: /^Ouvrir Faire découvrir le programme,/ }).click()
    await expect(channel).toHaveValue('LinkedIn')
    await expect(channel.locator('option[data-legacy-channel]')).toHaveCount(0)
    await page.locator('#iw-close').click()
    await page.locator('#iw-new').click()
    await expect(channel).toHaveValue('')
    await expect(page.getByLabel('Date de publication *', { exact: true })).toBeVisible()
    await expect(page.locator('#iw-ends')).toBeHidden()
    assert.deepEqual(await page.locator('#iw-entry-status option').allTextContents(), [
      'En cours',
      'À créer',
      'À modifier',
      'À valider',
      'Programmé',
      'Validé',
      'Publié',
    ])
    assert.deepEqual(
      await channel
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.value)),
      ['', 'LinkedIn', 'Newsletter', 'Site'],
    )
    await page.locator('#iw-close').click()
    checks.push(`legacy-channel-hidden-activity-notes-order-${width}`)
  }
  // A concurrently changed legacy channel is also preserved when choosing the server version.
  await openLegacy()
  await page.locator('#iw-notes').fill('Note conservée après comparaison')
  const changedChannel = 'Ancien canal <b>partenaires</b>'
  sql
    .query('UPDATE workspace_entries SET channel=?,version=version+1 WHERE id=?')
    .run(changedChannel, legacyId)
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-conflict')).toBeVisible()
  await page.locator('#iw-compare').click()
  await expect(page.locator('#iw-merge-channel')).toBeVisible()
  await page.locator('#iw-merge-channel').selectOption('current')
  await page.locator('#iw-apply-merge').click()
  await expect(channel).toHaveValue(changedChannel)
  await expect(channel.locator('option[data-legacy-channel]')).toHaveCount(1)
  await expect(channel.locator('b')).toHaveCount(0)
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  assert.deepEqual(
    sql.query('SELECT channel,notes FROM workspace_entries WHERE id=?').get(legacyId),
    {
      channel: changedChannel,
      notes: 'Note conservée après comparaison',
    },
  )
  checks.push('legacy-channel-concurrent-merge-safe-text')
  // Every editorial status and publication-date change must persist through the compiled API.
  for (const status of [
    'en_cours',
    'a_creer',
    'a_modifier',
    'a_valider',
    'programme',
    'valide',
    'publie',
  ]) {
    await page.locator('#iw-entry-status').selectOption(status)
    await page.locator('#iw-starts').fill('2026-09-22')
    await page.locator('#iw-save').click()
    await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
    assert.deepEqual(
      sql.query('SELECT status,starts_on,ends_on FROM workspace_entries WHERE id=?').get(legacyId),
      { status, starts_on: '2026-09-22', ends_on: '2026-09-22' },
    )
  }
  checks.push('editorial-seven-statuses-publication-date-sql')
  // An explicit selection replaces the old value; Programmé must persist server-side.
  await channel.selectOption('Newsletter')
  await page.locator('#iw-entry-status').selectOption('programme')
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  assert.deepEqual(
    sql.query('SELECT channel,status,activity FROM workspace_entries WHERE id=?').get(legacyId),
    {
      channel: 'Newsletter',
      status: 'programme',
      activity: 'Communication historique',
    },
  )
  await page.locator('#iw-close').click()
  await page.reload()
  await expect(page.locator('#iw-calendar-content')).toHaveAttribute('aria-busy', 'false')
  await page.locator('#iw-month').fill('2026-09')
  await page.locator('#iw-month').press('Tab')
  await page.locator('[data-view="list"]').click()
  await openLegacy()
  await expect(channel).toHaveValue('Newsletter')
  await expect(channel.locator('option[data-legacy-channel]')).toHaveCount(0)
  await expect(page.locator('#iw-entry-status')).toHaveValue('programme')
  // A hidden legacy end date must honor the explicit choice made in a conflict.
  await page.locator('#iw-notes').fill('Conserver ma date après comparaison')
  sql
    .query("UPDATE workspace_entries SET ends_on='2026-09-26',version=version+1 WHERE id=?")
    .run(legacyId)
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-conflict')).toBeVisible()
  await page.locator('#iw-compare').click()
  await expect(page.locator('#iw-merge-ends_on')).toBeVisible()
  await page.locator('#iw-merge-ends_on').selectOption('mine')
  await page.locator('#iw-apply-merge').click()
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  assert.equal(
    sql.query('SELECT ends_on FROM workspace_entries WHERE id=?').get(legacyId).ends_on,
    '2026-09-22',
    'The chosen date must not be overwritten by the latest server date',
  )
  // A concurrent historical status may not already exist in the closed select.
  await page.locator('#iw-notes').fill('Conserver le statut actuel après comparaison')
  sql
    .query("UPDATE workspace_entries SET status='annule',version=version+1 WHERE id=?")
    .run(legacyId)
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-conflict')).toBeVisible()
  await page.locator('#iw-compare').click()
  await page.locator('#iw-merge-status').selectOption('current')
  await page.locator('#iw-apply-merge').click()
  await expect(page.locator('#iw-entry-status')).toHaveValue('annule')
  await expect(page.locator('#iw-entry-status option[data-legacy-status]')).toHaveText(
    'Annulé (ancien statut)',
  )
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  assert.equal(
    sql.query('SELECT status FROM workspace_entries WHERE id=?').get(legacyId).status,
    'annule',
  )
  checks.push('editorial-conflict-preserves-chosen-date-and-historical-status')
  await page.locator('#iw-close').click()
  checks.push('explicit-channel-change-and-programme-status-sql-reload')
  await page.locator('[data-kind="equipe"]').click()
  await expect(page.locator('#iw-person option[value="Alex"]')).toHaveCount(1)
  await expect(page.locator('#iw-activity option[value="Activité historique hors mois"]')).toHaveCount(1)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.locator('#iw-person-totals')).toContainText('Heures réalisées par personne')
    await expect(page.locator('#iw-person-totals thead th')).toHaveText(['Personne', 'Heures réalisées'])
    await expect(page.locator('#iw-person-totals tbody th')).toHaveText(['Member'])
    await expect(page.locator('#iw-person-totals tbody td')).toHaveText(['6 h'])
    await expect(page.locator('#iw-person-totals tfoot th')).toHaveText(['Total du mois'])
    await expect(page.locator('#iw-person-totals tfoot td')).toHaveText(['6 h'])
    assert(await page.locator('#iw-person-totals').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
  }
  await page.locator('#iw-person').selectOption('Alex')
  await expect(page.locator('#iw-calendar-state')).toContainText('Aucune fiche ne correspond')
  await expect(page.locator('#iw-person-totals dd')).toHaveText(['6 h'])
  await page.locator('#iw-person').selectOption('')
  await page.locator('[data-view="list"]').click()
  const teamPreview = page.locator('.iw-entry').first()
  await expect(teamPreview.locator('.iw-entry__details').first()).toHaveText('Présence · Formation')
  await expect(teamPreview.locator('.iw-entry__person')).not.toContainText('Member')
  await page.locator('[data-view="month"]').click()
  // Synthetic historical text only: prose must remain accessible without
  // becoming hours, notes, or an editorial field on new team entries.
  const teamTextId = crypto.randomUUID()
  const teamText = 'Consigne fictive : préparer la salle le matin. Prévision indicative : 2 heures.'
  const teamNotes = 'Note fictive indépendante.'
  assert.equal(
    (
      await call('/api/interne/calendrier', 'member', 'POST', {
        requestId: teamTextId,
        entry: baseEntry({
          title: 'Informations équipe historiques de recette',
          hours: null,
          content: teamText,
          notes: teamNotes,
          channel: 'Ancien canal fictif',
        }),
      })
    ).status,
    201,
  )
  await page.locator('#iw-refresh').click()
  const openTeamText = () => page.locator(`[data-entry-id="${teamTextId}"]`).filter({ visible: true }).first().click()
  await openTeamText()
  await expect(page.getByLabel('Détails complémentaires', { exact: true })).toBeVisible()
  await expect(page.locator('#iw-content')).toBeEditable()
  await expect(page.locator('#iw-content')).toHaveValue(teamText)
  await expect(page.locator('#iw-content-help')).toContainText(
    'ne sont pas automatiquement reprises',
  )
  await expect(page.locator('#iw-hours')).toHaveValue('')
  await expect(page.locator('#iw-location')).toBeHidden()
  await page.locator('#iw-entry-activity').selectOption('Coordination')
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  assert.deepEqual(
    sql
      .query('SELECT content,notes,hours,daily_hours,channel FROM workspace_entries WHERE id=?')
      .get(teamTextId),
    {
      content: teamText,
      notes: teamNotes,
      hours: null,
      daily_hours: '',
      channel: 'Ancien canal fictif',
    },
  )
  await page.locator('#iw-content').fill(`${teamText}\nPrécision fictive ajoutée.`)
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  await page.locator('#iw-close').click()
  await openTeamText()
  await expect(page.locator('#iw-content')).toHaveValue(`${teamText}\nPrécision fictive ajoutée.`)
  assert.equal(
    sql.query('SELECT hours FROM workspace_entries WHERE id=?').get(teamTextId).hours,
    null,
  )
  await expect(page.locator('#iw-notes')).toHaveValue(teamNotes)
  await page.locator('#iw-close').click()
  // Same content stays readable for a member who cannot edit the fiche.
  sql
    .query('UPDATE workspace_entries SET created_by=? WHERE id=?')
    .run('manager@example.test', teamTextId)
  await page.locator('#iw-refresh').click()
  await openTeamText()
  await expect(page.locator('#iw-content')).toBeVisible()
  await expect(page.locator('#iw-content')).toBeDisabled()
  await expect(page.locator('#iw-save')).toBeHidden()
  await expect(page.locator('#iw-delete')).toBeHidden()
  await page.locator('#iw-close').click()
  checks.push('existing-team-content-readable-editable-preserved-without-hours-or-rights')
  await page.locator('#iw-new').click()
  await expect(page.getByLabel('Date de début *', { exact: true })).toBeVisible()
  await expect(page.locator('#iw-ends')).toBeVisible()
  assert.deepEqual(
    await page
      .locator('#iw-entry-status option')
      .evaluateAll((options) => options.map((option) => option.value)),
    ['brouillon', 'a_valider', 'valide', 'annule'],
  )
  await expect(page.locator('#iw-entry-status option[value="valide"]')).toBeDisabled()
  await expect(page.locator('#iw-entry-status')).toBeHidden()
  await expect(page.locator('#iw-status-help')).toBeHidden()
  await expect(page.locator('#iw-title')).toBeHidden()
  await expect(page.locator('#iw-entry-activity')).toBeVisible()
  assert.deepEqual(await page.locator('#iw-entry-activity option').allTextContents(), ['Sélectionner une activité', 'Communication', 'Direction générale', 'Coordination'])
  await expect(page.locator('#iw-calendar-content')).not.toContainText('@')
  await expect(page.locator('#iw-activity')).toBeVisible()
  await expect(page.locator('#iw-entry-channel')).toBeHidden()
  await expect(page.locator('#iw-channel')).toBeHidden()
  await expect(page.locator('#iw-content')).toBeHidden()
  await expect(page.locator('#iw-notes')).toBeHidden()
  await page.locator('#iw-entry-activity').selectOption('Coordination')
  const beforeUiIds = new Set(sql.query('SELECT id FROM workspace_entries').all().map((entry) => entry.id))
  await page.locator('#iw-starts').fill('2026-09-17')
  await page.locator('#iw-ends').fill('2026-09-17')
  await page.locator('#iw-hours').fill('1.5')
  await page.locator('#iw-attendance').selectOption('presence')
  await expect(page.locator('#iw-location')).toBeHidden()
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  const newUiEntries = sql.query('SELECT * FROM workspace_entries').all().filter((entry) => !beforeUiIds.has(entry.id))
  assert.equal(newUiEntries.length, 1)
  const uiEntry = newUiEntries[0]
  assert.equal(uiEntry.notes, '')
  assert.equal(uiEntry.title, 'Member')
  assert.equal(uiEntry.activity, 'Coordination')
  assert.equal(uiEntry.hours, 1.5)
  assert.equal(uiEntry.created_by, 'member@example.test')
  await page
    .locator('#iw-comment')
    .fill('<script>throw new Error("XSS")</script> commentaire en texte')
  await page.locator('#iw-comment-submit').click()
  await expect(page.locator('#iw-comment-list')).toContainText('<script>')
  assert.equal(await page.locator('#iw-comment-list script').count(), 0)
  await page.locator('#iw-hours').fill('2.5')
  sql
    .query(
      "UPDATE workspace_entries SET hours=5,starts_on='2026-10-02',ends_on='2026-10-02',version=version+1 WHERE id=?",
    )
    .run(uiEntry.id)
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-conflict')).toBeVisible()
  await expect(page.locator('#iw-hours')).toHaveValue('2.5')
  assert.equal(sql.query('SELECT hours FROM workspace_entries WHERE id=?').get(uiEntry.id).hours, 5)
  let releaseComparison
  comparisonGate = new Promise((resolve) => {
    releaseComparison = resolve
  })
  const comparisonArrival = new Promise((resolve) => {
    comparisonStarted = resolve
  })
  await page.locator('#iw-compare').click()
  await comparisonArrival
  await expect(page.locator('#iw-entry-activity')).toBeDisabled()
  // Also protect a value changed outside typing (e.g. browser autofill).
  await page.locator('#iw-entry-activity').evaluate((element) => {
    element.value = 'Communication'
  })
  releaseComparison()
  comparisonGate = null
  await expect(page.locator('#iw-save-feedback')).toContainText(
    'saisie a changé pendant la comparaison',
  )
  await expect(page.locator('#iw-entry-activity')).toHaveValue('Communication')
  await page.locator('#iw-compare').click()
  await expect(page.locator('#iw-merge-hours')).toBeVisible()
  await page.locator('#iw-merge-hours').selectOption('mine')
  await page.locator('#iw-apply-merge').click()
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  assert.equal(
    sql.query('SELECT hours FROM workspace_entries WHERE id=?').get(uiEntry.id).hours,
    2.5,
  )
  const reconciled = sql
    .query('SELECT starts_on,notes,activity FROM workspace_entries WHERE id=?')
    .get(uiEntry.id)
  assert.equal(reconciled.starts_on, '2026-10-02')
  assert.equal(reconciled.notes, '')
  assert.equal(reconciled.activity, 'Communication')
  checks.push('browser-create-comment-xss-conflict-merge')
  checks.push('comparison-race-and-moved-month')
  await page.locator('#iw-close').click()
  // Choosing a calendar month must not silently rewrite a fiche or declare hours.
  await page.locator('#iw-month').fill('2028-02')
  await page.locator('#iw-month').press('Tab')
  await expect(page.locator('#iw-result-count')).toContainText('février 2028')
  await page.locator('#iw-new').click()
  await expect(page.locator('#iw-ends')).toHaveValue('2028-02-01')
  await page.locator('#iw-fill-month').click()
  await expect(page.locator('#iw-starts')).toHaveValue('2028-02-01')
  await expect(page.locator('#iw-ends')).toHaveValue('2028-02-29')
  await expect(page.locator('#iw-hours')).toHaveValue('')
  await page.locator('#iw-close').click()
  await expect(page.locator('#iw-close-warning')).toBeVisible()
  await page.locator('#iw-discard').click()
  assert.equal(
    sql.query("SELECT count(*) n FROM workspace_entries WHERE starts_on LIKE '2028-02%'").get().n,
    0,
  )
  await page.locator('#iw-month').fill('2026-09')
  await page.locator('#iw-month').press('Tab')
  await expect(page.locator('#iw-result-count')).toContainText('septembre 2026')
  checks.push('team-fields-permissions-and-explicit-month-no-autosave')
  await page.locator('#iw-new').click()
  await expect(page.locator('#iw-notes')).toBeHidden()
  const beforeDailyIds = new Set(sql.query('SELECT id FROM workspace_entries').all().map((entry) => entry.id))
  await page.locator('#iw-fill-month').click()
  await expect(page.locator('#iw-starts')).toHaveValue('2026-09-01')
  await expect(page.locator('#iw-ends')).toHaveValue('2026-09-30')
  await expect(page.locator('#iw-entry-status')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Saisir les heures par jour', exact: true })).toHaveCount(0)
  await expect(page.locator('#iw-link')).toBeHidden()
  await expect(page.getByRole('spinbutton', { name: 'Heures déjà enregistrées le jeudi 17 septembre', exact: true })).toHaveValue('6')
  await expect(page.getByRole('spinbutton', { name: /Heures prévues/ })).toHaveCount(0)
  await page
    .getByRole('spinbutton', { name: 'Heures réalisées le vendredi 4 septembre', exact: true })
    .fill('0')
  await page
    .getByRole('spinbutton', { name: 'Heures réalisées le mardi 1 septembre', exact: true })
    .fill('8')
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  const newDailyEntries = sql.query('SELECT * FROM workspace_entries').all().filter((entry) => !beforeDailyIds.has(entry.id))
  assert.equal(newDailyEntries.length, 1)
  const dailyEntry = newDailyEntries[0]
  assert.equal(dailyEntry.notes, '')
  assert.equal(dailyEntry.hours, 8)
  assert.equal(JSON.parse(dailyEntry.daily_hours).length, 2)
  await page.locator('#iw-close').click()
  await page.reload()
  await page.locator('[data-kind="equipe"]').click()
  await page.locator('#iw-month').fill('2026-09')
  await page.locator('#iw-month').press('Tab')
  await expect(page.locator(`.iw-event[data-entry-id="${dailyEntry.id}"]`)).toHaveCount(2)
  await page.locator(`.iw-event[data-entry-id="${dailyEntry.id}"]`).first().click()
  await expect(
    page.getByRole('spinbutton', { name: 'Heures réalisées le mardi 1 septembre', exact: true }),
  ).toHaveValue('8')
  await page
    .getByRole('spinbutton', { name: 'Heures réalisées le vendredi 4 septembre', exact: true })
    .fill('')
  await page
    .getByRole('spinbutton', { name: 'Heures réalisées le mercredi 2 septembre', exact: true })
    .fill('3.5')
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert(
      await page.evaluate(
        () =>
          document.querySelector('#iw-editor').scrollWidth <=
          document.querySelector('#iw-editor').clientWidth + 1,
      ),
      `Daily editor overflow ${width}`,
    )
    await expect(page.getByRole('spinbutton', { name: /Heures prévues/ })).toHaveCount(0)
    await expect(page.locator('#iw-daily-feedback')).not.toContainText('prévues')
    await page.locator('#iw-entry-person').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/daily-permissions-${width}.png` })
    await page.locator('#iw-daily-rows').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${output}/daily-hours-${width}.png` })
  }
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  const revised = JSON.parse(
    sql.query('SELECT daily_hours FROM workspace_entries WHERE id=?').get(dailyEntry.id)
      .daily_hours,
  )
  assert(revised.some((row) => row.date === '2026-09-02' && row.actual === 3.5))
  assert(!revised.some((row) => row.date === '2026-09-04'))
  await page.locator('#iw-close').click()
  checks.push('daily-planned-actual-reload-move-responsive')
  // Existing monthly records remain editable on the actual compiled UI/API, using only this in-memory
  // database: weekdays, half-days, custom exception, reload and same-record edits.
  const existingMonthlyId = crypto.randomUUID()
  assert.equal((await call('/api/interne/calendrier', 'member', 'POST', { requestId: existingMonthlyId, entry: baseEntry({ title: 'Member', activity: 'Disponibilités mensuelles', starts_on: '2026-10-01', ends_on: '2026-10-31', hours: 0, daily_hours: JSON.stringify([{ date: '2026-10-01', planned: null, actual: 0 }]) }) })).status, 201)
  await page.locator('#iw-month').fill('2026-10')
  await page.locator('#iw-month').press('Tab')
  await expect(page.locator('#iw-result-count')).toContainText('octobre 2026')
  const existingMonthlyRecord = sql.query("SELECT id FROM workspace_entries WHERE activity='Disponibilités mensuelles'").get()
  await page.locator(`.iw-event[data-entry-id="${existingMonthlyRecord.id}"]`).first().click()
  await expect(page.locator('#iw-starts')).toHaveValue('2026-10-01')
  await expect(page.locator('#iw-ends')).toHaveValue('2026-10-31')
  await expect(page.locator('#iw-entry-person')).toBeDisabled()
  await page.getByText('Répéter des jours chaque semaine', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Chaque mardi', exact: true }).selectOption('day')
  await page.getByRole('combobox', { name: 'Chaque jeudi', exact: true }).selectOption('day')
  await page.getByRole('combobox', { name: 'Chaque vendredi', exact: true }).selectOption('afternoon')
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-daily-feedback')).toContainText('Appliquez les jours récurrents')
  assert.equal(sql.query("SELECT COUNT(*) n FROM workspace_entries WHERE activity='Disponibilités mensuelles'").get().n, 1)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator('#iw-daily-controls').scrollIntoViewIfNeeded()
    assert(await page.locator('#iw-editor').evaluate(e => e.scrollWidth <= e.clientWidth + 1))
    await page.screenshot({ path: `${output}/monthly-recurrence-${width}.png` })
  }
  await page.getByRole('button', { name: 'Appliquer les jours à la période', exact: true }).click()
  const dayRow = text => page.locator('.iw-daily-day').filter({ has: page.getByText(text, { exact: true }) })
  await dayRow('jeudi 8 octobre').locator('summary').click()
  await dayRow('jeudi 8 octobre').getByRole('combobox').selectOption('')
  await dayRow('jeudi 8 octobre').getByRole('button', { name: 'Appliquer à ce jour' }).click()
  await dayRow('mercredi 7 octobre').locator('summary').click()
  await dayRow('mercredi 7 octobre').getByRole('combobox').selectOption('custom')
  await page.getByLabel('Début — Prévision le mercredi 7 octobre', { exact: true }).fill('14:00')
  await page.getByLabel('Fin — Prévision le mercredi 7 octobre', { exact: true }).fill('16:15')
  await page.getByRole('checkbox', { name: 'Second créneau — Prévision le mercredi 7 octobre', exact: true }).check()
  await page.getByLabel('Début du second créneau — Prévision le mercredi 7 octobre', { exact: true }).fill('17:00')
  await page.getByLabel('Fin du second créneau — Prévision le mercredi 7 octobre', { exact: true }).fill('18:00')
  await dayRow('mercredi 7 octobre').getByRole('button', { name: 'Appliquer à ce jour' }).click()
  await dayRow('mercredi 7 octobre').locator('summary').click()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await dayRow('mercredi 7 octobre').locator('details').scrollIntoViewIfNeeded()
    assert(await page.locator('#iw-editor').evaluate(e => e.scrollWidth <= e.clientWidth + 1))
    await page.screenshot({ path: `${output}/monthly-custom-slots-${width}.png` })
  }
  await page.getByRole('spinbutton', { name: 'Heures réalisées le jeudi 1 octobre', exact: true }).fill('8')
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  const monthlyRecord = sql.query("SELECT * FROM workspace_entries WHERE activity='Disponibilités mensuelles' AND person='member@example.test' AND starts_on='2026-10-01'").get()
  assert.equal(monthlyRecord.hours, 8)
  let monthRows = JSON.parse(monthlyRecord.daily_hours)
  assert.equal(monthRows.length, 14)
  assert(!monthRows.some(d => d.date === '2026-10-08'))
  assert.deepEqual(monthRows.find(d => d.date === '2026-10-07').slots, [{ start: '14:00', end: '16:15' }, { start: '17:00', end: '18:00' }])
  assert.equal(monthRows.find(d => d.date === '2026-10-07').planned, 3.25)
  assert.equal(monthRows.find(d => d.date === '2026-10-02').planned, 3.5)
  await page.locator('#iw-close').click()
  await page.reload()
  await page.locator('[data-kind="equipe"]').click()
  await page.locator('#iw-month').fill('2026-10')
  await page.locator('#iw-month').press('Tab')
  await expect(page.locator(`.iw-event[data-entry-id="${monthlyRecord.id}"]`)).toHaveCount(14)
  await expect(page.locator('#iw-calendar-content')).toContainText('14:00–16:15')
  await page.locator(`.iw-event[data-entry-id="${monthlyRecord.id}"]`).first().click()
  await expect(page.getByRole('spinbutton', { name: 'Heures réalisées le jeudi 1 octobre', exact: true })).toHaveValue('8')
  await dayRow('mercredi 7 octobre').locator('summary').click()
  await expect(page.getByRole('checkbox', { name: 'Second créneau — Prévision le mercredi 7 octobre', exact: true })).toBeChecked()
  await expect(page.getByLabel('Début du second créneau — Prévision le mercredi 7 octobre', { exact: true })).toHaveValue('17:00')
  await page.getByText('Répéter des jours chaque semaine', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Chaque lundi', exact: true }).selectOption('morning')
  await page.getByRole('combobox', { name: 'Chaque mardi', exact: true }).selectOption('day')
  page.once('dialog', d => d.dismiss())
  await page.getByRole('button', { name: 'Appliquer les jours à la période', exact: true }).click()
  assert.equal(JSON.parse(await page.locator('input[name="daily_hours"]').inputValue()).length, 14)
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: 'Appliquer les jours à la période', exact: true }).click()
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  assert.equal(sql.query("SELECT COUNT(*) n FROM workspace_entries WHERE activity='Disponibilités mensuelles' AND person='member@example.test' AND starts_on='2026-10-01'").get().n, 1)
  const revisedMonth = sql.query('SELECT * FROM workspace_entries WHERE id=?').get(monthlyRecord.id)
  assert.equal(revisedMonth.version, monthlyRecord.version + 1)
  assert.equal(revisedMonth.hours, 8)
  monthRows = JSON.parse(revisedMonth.daily_hours)
  assert.equal(monthRows.length, 9)
  assert.deepEqual(monthRows.find(d => d.date === '2026-10-01'), { date: '2026-10-01', planned: null, actual: 8 })
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator('#iw-daily-rows').scrollIntoViewIfNeeded()
    assert(await page.locator('#iw-editor').evaluate(e => e.scrollWidth <= e.clientWidth + 1))
    await page.screenshot({ path: `${output}/monthly-exceptions-${width}.png` })
  }
  await page.locator('#iw-close').click()
  checks.push('monthly-recurrence-slots-exceptions-reopen-no-duplicates-actual-preserved')
  for (const [width, month] of [[390, '2027-03'], [1440, '2027-11']]) {
    await page.setViewportSize({ width, height: 1000 })
    const ownId = crypto.randomUUID(), sourceId = crypto.randomUUID()
    for (const [requestId, day, hours] of [[ownId, '01', 2], [sourceId, '02', 6]]) {
      assert.equal((await call('/api/interne/calendrier', 'member', 'POST', { requestId, entry: baseEntry({ starts_on: `${month}-${day}`, ends_on: `${month}-${day}`, hours }) })).status, 201)
    }
    await page.locator('#iw-month').fill(month)
    await page.locator('#iw-month').press('Tab')
    await page.locator(`button[data-entry-id="${ownId}"]:visible`).first().click()
    await expect(page.locator('#iw-link')).toBeHidden()
    await expect(page.getByText('Cette fiche couvre toute la période.', { exact: false })).toHaveCount(0)
    await page.locator('#iw-fill-month').click()
    await expect(page.getByRole('spinbutton', { name: /^Heures déjà enregistrées le mardi 2 / })).toHaveValue('6')
    await page.getByRole('button', { name: '7 h', exact: true }).click()
    await page.getByRole('combobox', { name: 'Jour à préremplir', exact: true }).selectOption('1')
    await page.getByRole('button', { name: 'Préremplir les jours correspondants', exact: true }).click()
    await page.getByRole('button', { name: '8 h', exact: true }).click()
    await page.getByRole('combobox', { name: 'Jour à préremplir', exact: true }).selectOption('2')
    await page.getByRole('button', { name: 'Préremplir les jours correspondants', exact: true }).click()
    const filled = JSON.parse(await page.locator('input[name="daily_hours"]').inputValue())
    assert.equal(filled.find(row => row.date === `${month}-01`).actual, 2)
    assert(!filled.some(row => row.date === `${month}-02`), 'Other fiches must never be copied')
    assert.equal(filled.find(row => row.date === `${month}-08`).actual, 7)
    assert.equal(filled.find(row => row.date === `${month}-09`).actual, 8)
    assert(await page.locator('#iw-editor').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    await page.screenshot({ path: `${output}/heures-recurrentes-${width}.png` })
    await page.locator('#iw-save').click()
    await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
    const saved = sql.query('SELECT * FROM workspace_entries WHERE id=?').get(ownId)
    assert.equal(saved.hours, filled.reduce((sum, row) => sum + (row.actual ?? 0), 0))
    assert.equal(sql.query('SELECT hours FROM workspace_entries WHERE id=?').get(sourceId).hours, 6)
    await page.locator('#iw-close').click()
    checks.push(`weekly-7-8-preserve-existing-no-duplicates-${width}`)
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator('#iw-new').click()
    await expect(page.locator('#iw-entry-person')).toBeEnabled()
    await page.locator('#iw-entry-person').selectOption({ label: 'Candice' })
    await page.locator('#iw-entry-activity').selectOption('Coordination')
    await page.locator('#iw-hours').fill('3.5')
    const before = new Set(sql.query('SELECT id FROM workspace_entries').all().map(row => row.id))
    await page.locator('#iw-save').click()
    await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
    const delegated = sql.query('SELECT * FROM workspace_entries').all().find(row => !before.has(row.id))
    assert(delegated)
    assert.equal(delegated.person.toLowerCase(), 'candice')
    assert.equal(delegated.created_by, 'member@example.test')
    assert.equal(delegated.hours, 3.5)
    await expect(page.locator('#iw-editor')).toContainText('Créée par member@example.test')
    await page.locator('#iw-hours').fill('4')
    await page.locator('#iw-save').click()
    await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
    assert.equal(sql.query('SELECT hours FROM workspace_entries WHERE id=?').get(delegated.id).hours, 4)
    assert(await page.locator('#iw-editor').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    await page.screenshot({ path: `${output}/saisie-collegue-${width}.png` })
    await page.locator('#iw-close').click()
    checks.push(`delegated-create-edit-creator-${width}`)
  }
  failDatabase = true
  await page.locator('#iw-refresh').click()
  await expect(page.locator('#iw-calendar-state')).toContainText(
    'Le calendrier n’a pas pu être chargé',
  )
  await expect(page.locator('#iw-metric-1')).toHaveText('—')
  failDatabase = false
  checks.push('database-error-not-zero')
  await page.setExtraHTTPHeaders({ 'X-Fixture-Role': 'trainer' })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`${origin}/interne/ressources`)
    await expect(page.locator('#iw-resource-grid')).toContainText('Guide des ateliers')
    assert.equal(await page.locator('#iw-resource-form').count(), 0)
    assert.equal(await page.locator('.iw-nav a[href="/interne"]').count(), 0)
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Library overflow ${width}`,
    )
    if ([390, 1440].includes(width))
      await page.screenshot({ path: `${output}/ressources-${width}.png`, fullPage: true })
    checks.push(`resources-${width}`)
  }
  await page.setExtraHTTPHeaders({ 'X-Fixture-Role': 'manager' })
  await page.goto(`${origin}/interne/catalogue`)
  await page.locator('#iw-resource-title').fill('Fiche de préparation')
  await page.locator('#iw-resource-new-category').fill('Exercices')
  await page.locator('#iw-resource-description').fill('Ressource fictive de recette.')
  await page.locator('#iw-resource-url').fill('https://example.test/fiche.pdf')
  await page.locator('#iw-resource-save').click()
  await expect(page.locator('#iw-resource-save-feedback')).toContainText('ajoutée')
  assert.equal(
    sql
      .query('SELECT count(*) n FROM workspace_resources WHERE title=?')
      .get('Fiche de préparation').n,
    1,
  )
  checks.push('admin-resource-create')
  assert.deepEqual(errors, [])
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      { compiledRoutes: true, realSql: true, syntheticOnly: true, checks, jsErrors: errors },
      null,
      2,
    ),
  )
  console.log(`${checks.length} scénarios navigateur compilé réussis ; aucune erreur JavaScript.`)
} catch (error) {
  const detail = String(error?.stack ?? error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
  console.error(`::error title=Recette des fiches internes::${detail}`)
  throw error
} finally {
  await browser.close()
  server.stop()
  sql.close()
  globalThis.fetch = originalFetch
}
