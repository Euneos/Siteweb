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
  person: 'member@example.test',
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
assert.match(productionHtml, /Historique Notion à reprendre/)
assert.doesNotMatch(productionHtml, /Espace d’essai\./)

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
console.log(
  'Routes compilées : JWT, rôles, CSRF, SQL, versions, idempotence, auteurs et totaux OK.',
)

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
    await page.evaluate(() => document.fonts.ready)
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Calendar overflow ${width}`,
    )
    if ([390, 1440].includes(width))
      await page.screenshot({ path: `${output}/calendrier-${width}.png`, fullPage: true })
    checks.push(`calendar-${width}`)
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
    await page.locator('#iw-close').click()
    await expect(editor).not.toBeVisible()
    await page.getByRole('button', { name: /^Ouvrir Faire découvrir le programme,/ }).click()
    await expect(channel).toHaveValue('LinkedIn')
    await expect(channel.locator('option[data-legacy-channel]')).toHaveCount(0)
    await page.locator('#iw-close').click()
    await page.locator('#iw-new').click()
    await expect(channel).toHaveValue('')
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
  await page.locator('#iw-close').click()
  checks.push('explicit-channel-change-and-programme-status-sql-reload')
  await page.locator('[data-kind="equipe"]').click()
  await expect(page.locator('#iw-totals-content')).toContainText('6 h')
  await page.locator('#iw-new').click()
  await page.locator('#iw-title').fill('Recette depuis le navigateur')
  await page.locator('#iw-starts').fill('2026-09-17')
  await page.locator('#iw-ends').fill('2026-09-17')
  await page.locator('#iw-hours').fill('1.5')
  await page.locator('#iw-attendance').selectOption('presence')
  await page.locator('#iw-location').fill('En visioconférence')
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  const uiEntry = sql
    .query('SELECT * FROM workspace_entries WHERE title=?')
    .get('Recette depuis le navigateur')
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
  await expect(page.locator('#iw-notes')).toBeDisabled()
  // Also protect a value changed outside typing (e.g. browser autofill).
  await page.locator('#iw-notes').evaluate((element) => {
    element.value = 'Nouvelle note à préserver'
  })
  releaseComparison()
  comparisonGate = null
  await expect(page.locator('#iw-save-feedback')).toContainText(
    'saisie a changé pendant la comparaison',
  )
  await expect(page.locator('#iw-notes')).toHaveValue('Nouvelle note à préserver')
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
    .query('SELECT starts_on,notes FROM workspace_entries WHERE id=?')
    .get(uiEntry.id)
  assert.equal(reconciled.starts_on, '2026-10-02')
  assert.equal(reconciled.notes, 'Nouvelle note à préserver')
  checks.push('browser-create-comment-xss-conflict-merge')
  checks.push('comparison-race-and-moved-month')
  await page.locator('#iw-close').click()
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
} finally {
  await browser.close()
  server.stop()
  sql.close()
  globalThis.fetch = originalFetch
}
