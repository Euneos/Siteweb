import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import * as publicPage from '../dist/_worker.js/pages/suivi/_kind_.astro.mjs'
import * as internalPage from '../dist/_worker.js/pages/interne/formulaires.astro.mjs'
import * as publicEndpoint from '../dist/_worker.js/pages/api/suivi/_kind_.astro.mjs'

// Actual compiled Astro pages and preview API. All identities/answers are synthetic.
// No production configuration, real credential, NocoDB write or email transport.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-direct-ui-qa'
await mkdir(output, { recursive: true })
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(
  (name) => name.startsWith('manifest_') && name.endsWith('.mjs'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({
  ...manifest,
  sessionConfig: undefined,
  pageMap: new Map([
    ['src/pages/suivi/[kind].astro', async () => publicPage],
    ['src/pages/interne/formulaires.astro', async () => internalPage],
    ['src/pages/api/suivi/[kind].ts', async () => publicEndpoint],
  ]),
})
const routes = ['fiche-contact', 'deploiement', 'participants']
const html = {}
for (const route of routes) {
  const response = await app.render(new Request(`http://localhost/suivi/${route}?t=demo`), {
    locals: {},
  })
  assert.equal(response.status, 200, route)
  assert.match(response.headers.get('Cache-Control'), /no-store/)
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/)
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
  html[route] = await response.text()
  assert.match(html[route], /Collège Exemple/)
  assert.match(html[route], /Aperçu de démonstration/)
  assert.doesNotMatch(html[route], /(?:rel="canonical"[^>]*|property="og:url"[^>]*)\?t=/)
  assert.doesNotMatch(html[route], /<input[^>]*name="(?:participationId|schoolId|cohortId)"/)
}

// Failed GETs use the compiled public layout, preserving status and privacy.
// The only stored-link fixture is expired; no transport or real credential is used.
let expiredReads = 0, errorNetworkCalls = 0
const expiredDb = { prepare(query) {
  assert.match(query, /SELECT l\.target_id/)
  return { bind() { return { async first() {
    expiredReads++
    return { target_id: 901, school_id: 902, cohort_id: 903, kind: 'contact', expires_at: 0, private_name: 'PRIVATE_LINK_CANARY' }
  } } } }
} }
const expiredLocals = { runtime: { env: {
  OPERATIONAL_FORMS_ENABLED: 'true', FORM_SUBMISSIONS: expiredDb, NOCODB_TOKEN: 'fixture-only-link-check',
} } }
const linkErrors = [
  { label: 'preview-missing', url: 'http://localhost/suivi/fiche-contact', locals: {}, status: 404 },
  { label: 'preview-invalid', url: 'http://localhost/suivi/fiche-contact?t=not-demo', locals: {}, status: 404 },
  { label: 'missing', url: 'https://euneos.fr/suivi/fiche-contact', locals: expiredLocals, status: 403 },
  { label: 'expired', url: `https://euneos.fr/suivi/fiche-contact?t=${'c'.repeat(64)}`, locals: expiredLocals, status: 403 },
  { label: 'unavailable', url: 'https://euneos.fr/suivi/participants', locals: {}, status: 503 },
  { label: 'unknown-kind', url: 'http://localhost/suivi/inconnu?t=demo', locals: {}, status: 404 },
]
const errorRealFetch = globalThis.fetch
globalThis.fetch = async () => { errorNetworkCalls++; throw new Error('No external request allowed during failed GET tests') }
try {
  for (const fixture of linkErrors) {
    const response = await app.render(new Request(fixture.url), { locals: fixture.locals })
    assert.equal(response.status, fixture.status, fixture.label)
    assert.match(response.headers.get('Content-Type'), /text\/html/)
    assert.match(response.headers.get('Cache-Control'), /no-store/)
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/)
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer')
    const body = await response.text(), main = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1]
    assert(main, 'Shared Base main content')
    assert.match(body, /<header\b/)
    assert.match(body, /<title>Lien à vérifier — EUNEOS<\/title>/)
    assert.match(main, /<h1>Lien à vérifier<\/h1>/)
    assert.match(main, /href="\/contact"[^>]*>Contacter l’équipe EUNEOS<\/a>/)
    assert.match(main, fixture.status === 503 ? /momentanément indisponible/ : /invalide, expiré ou a été remplacé/)
    assert.doesNotMatch(main, /<form\b|<input\b|of-context/)
    assert.doesNotMatch(body, /PRIVATE_LINK_CANARY|fixture-only-link-check|Collège Exemple|Ville Exemple|"code":|c{64}/)
    html[`error-${fixture.label}`] = body
  }
  assert.equal(expiredReads, 1, 'Only the expired-link lookup reads the simulated store')
  assert.equal(errorNetworkCalls, 0, 'Invalid links never read private dossier data')
  const apiError = await app.render(new Request('http://localhost/api/suivi/fiche-contact', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: JSON.stringify({ token: 'not-demo' }),
  }), { locals: {} })
  assert.equal(apiError.status, 400)
  assert.match(apiError.headers.get('Content-Type'), /application\/json/)
  assert.equal(typeof (await apiError.json()).code, 'string', 'API errors remain JSON')
} finally { globalThis.fetch = errorRealFetch }

const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'fixture', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'fixture-access.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'local-only',
  TEAM_WORKSPACE: {},
}
const jwt = await new SignJWT({ email: 'team@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
  .setSubject('fixture-member')
  .setAudience(env.INTERNAL_ACCESS_AUD)
  .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
  .setExpirationTime('5m')
  .sign(privateKey)
const realFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  assert.equal(
    new URL(String(input)).hostname,
    env.INTERNAL_ACCESS_DOMAIN,
    'Only the local key fixture may be read',
  )
  return Response.json({ keys: [jwk] })
}
try {
  const unauth = await app.render(new Request('https://euneos.fr/interne/formulaires'), {
    locals: { runtime: { env } },
  })
  assert.equal(unauth.status, 403)
  const response = await app.render(
    new Request('https://euneos.fr/interne/formulaires', {
      headers: { 'Cf-Access-Jwt-Assertion': jwt },
    }),
    { locals: { runtime: { env } } },
  )
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Cache-Control'), /no-store/)
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/)
  html.internal = await response.text()
} finally {
  globalThis.fetch = realFetch
}

const fixture = {
  enabled: true,
  dossiers: [
    {
      participationId: 901,
      schoolName: 'Collège Exemple',
      city: 'Ville Exemple',
      cohortLabel: '2026–2027',
      code: 'DEMO-901',
    },
    {
      participationId: 902,
      schoolName: 'École de démonstration',
      city: 'Autre Ville',
      cohortLabel: '2026–2027',
      code: 'DEMO-902',
    },
  ],
  submissions: [
    {
      participationId: 901,
      kind: 'contact',
      state: 'complete',
      code: 'INTERNAL-DETAIL-NOT-FOR-UI',
      createdAt: '2026-09-23T08:00:00Z',
    },
    {
      participationId: 902,
      kind: 'deploiement',
      state: 'review',
      code: 'INTERNAL-DETAIL-NOT-FOR-UI',
      createdAt: '2026-09-23T09:00:00Z',
    },
    {
      participationId: 901,
      kind: 'participants',
      state: 'processing',
      code: 'INTERNAL-DETAIL-NOT-FOR-UI',
      createdAt: '2026-09-23T10:00:00Z',
    },
  ],
}
fixture.submissions[1].code = 'dates_conflict'
fixture.submissions.push({
  participationId: 901,
  kind: 'participants',
  state: 'retryable',
  code: 'read_failed',
  createdAt: '2026-09-23T11:00:00Z',
})
let failRead = false,
  failLink = false,
  publicMode = 'real'
let publicPosts = [],
  linkPosts = [],
  apiResponses = []
let releasePublic, releaseLink
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url),
      path = url.pathname
    if (path === '/__qa/link-error/expired') return new Response(html['error-expired'], {
      status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
    if (path.startsWith('/api/suivi/')) {
      publicPosts.push(await request.clone().json())
      if (releasePublic) await releasePublic
      if (publicMode === 'error')
        return Response.json(
          { code: 'invalid_email', message: 'INTERNAL-DETAIL-NOT-FOR-UI' },
          { status: 422 },
        )
      if (publicMode === 'uncertain')
        return new Response('INTERNAL-DETAIL-NOT-FOR-UI', { status: 503 })
      if (publicMode === 'retryable')
        return Response.json({ state: 'retryable', code: 'read_failed' }, { status: 503 })
      if (publicMode === 'payload_changed')
        return Response.json({ state: 'review', code: 'payload_changed' })
      if (publicMode !== 'real') return Response.json({ state: publicMode, preview: false })
      const response = await app.render(request, { locals: {} })
      apiResponses.push(await response.clone().json())
      return response
    }
    if (path === '/api/interne/formulaires') {
      if (request.method === 'GET')
        return failRead
          ? Response.json({ message: 'INTERNAL-DETAIL-NOT-FOR-UI' }, { status: 503 })
          : Response.json(fixture)
      const payload = await request.json()
      linkPosts.push(payload)
      if (releaseLink) await releaseLink
      if (failLink) return Response.json({ code: 'INTERNAL-DETAIL-NOT-FOR-UI' }, { status: 503 })
      return Response.json(
        {
          url: `${url.origin}/suivi/${payload.kind === 'contact' ? 'fiche-contact' : payload.kind}?t=${'a'.repeat(64)}`,
          expiresAt: '2026-12-22T10:00:00Z',
        },
        { status: 201 },
      )
    }
    if (path === '/interne/formulaires')
      return new Response(html.internal, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    const route = path.split('/')[2]
    if (path.startsWith('/suivi/') && routes.includes(route))
      return new Response(html[route], {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Referrer-Policy': 'no-referrer',
          'Cache-Control': 'no-store',
        },
      })
    if (!/^\/(?:_astro|fonts)\//.test(path) && path !== '/favicon.svg')
      return new Response('Not found', { status: 404 })
    return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
  },
})
const origin = `http://127.0.0.1:${server.port}`
fixture.dossiers[1].links = {
  contact: {
    url: `https://euneos.fr/suivi/fiche-contact?t=${'b'.repeat(64)}`,
    expiresAt: '2026-12-22T10:00:00Z',
  },
}
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
const errors = [],
  measures = []
let verified = false
try {
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  await context.route('**/*', async (route) => {
    assert.equal(
      new URL(route.request().url()).origin,
      origin,
      'Browser must stay on the local test server',
    )
    await route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const response = await page.goto(`${origin}/__qa/link-error/expired`)
    assert.equal(response.status(), 403)
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Lien à vérifier' })).toBeVisible()
    await expect(page.locator('main form,main input')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Contacter l’équipe EUNEOS', exact: true })).toHaveAttribute('href', '/contact')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${output}/link-error-${width}.png` })
  }
  const form = page.locator('#operational-form'),
    feedback = page.locator('#operational-feedback')
  const goto = async (route = 'fiche-contact') => {
    await page.goto(`${origin}/suivi/${route}?t=demo`)
    await expect(form.locator('[type=submit]')).toBeEnabled()
  }
  const fill = async (route = 'fiche-contact') => {
    await page.locator('[name=referentName]').fill('Alex Exemple')
    await page.locator('[name=referentEmail]').fill('alex@example.test')
    if (route === 'fiche-contact') {
      for (const [name, value] of Object.entries({
        start: '2026-11-04',
        end: '2027-01-20',
        academy: 'Académie Exemple',
        address: '1 rue de la Démonstration',
        postalCode: '00000',
        directionEmail: 'direction@example.test',
      }))
        await page.locator(`[name=${name}]`).fill(value)
      await page.locator('[name=schoolType]').selectOption('Collège')
      await page.locator('[name=groupedSchools]').selectOption('false')
    }
    if (route !== 'participants') await page.locator('[name=format]').selectOption('Présentiel')
    if (route === 'deploiement') {
      await page.locator('[name=sessions]').fill('5')
      await page
        .locator('[name=planning]')
        .fill('Session 1 ; 04/11/2026 ; 14h ; 17h ; 3h ; Présentiel')
      await page.locator('[data-trainer-field=name]').fill('Dominique Exemple')
      await page.locator('[data-trainer-field=email]').fill('trainer@example.test')
      await page.locator('[name=organizationConfirmed]').check()
      await page.locator('[name=changesAcknowledged]').check()
    } else await page.locator('[name=confirmed]').check()
    if (route === 'participants') {
      await page.locator('[data-person-field=firstName]').fill('Camille')
      await page.locator('[data-person-field=lastName]').fill('Exemple')
    }
  }
  const submit = () => form.locator('[type=submit]').click()
  // All three actual compiled preview routes enforce the backend schema.
  for (const route of routes) {
    await goto(route)
    await fill(route)
    if (route === 'deploiement') {
      await page.locator('#of-add-trainer').click()
      await page
        .locator('[data-trainer]')
        .last()
        .locator('[data-trainer-field=name]')
        .fill('Claude Exemple')
      await page
        .locator('[data-trainer]')
        .last()
        .locator('[data-trainer-field=email]')
        .fill('claude@example.test')
      await expect(page.locator('[name=academy]')).toHaveCount(0)
      await expect(page.locator('[name=confirmed]')).toHaveCount(0)
      await expect(form.locator('[type=checkbox]')).toHaveCount(2)
    }
    const before = publicPosts.length,
      href = page.url()
    await submit()
    await expect(feedback).toContainText('Test terminé')
    assert.equal(publicPosts.length, before + 1)
    assert.equal(page.url(), href, 'No navigation after submit')
    await expect(form).toBeHidden()
    assert.deepEqual(apiResponses.at(-1), {
      state: 'complete',
      preview: true,
      code: 'preview',
      duplicate: false,
      createdAdults: 0,
    })
    const payload = publicPosts.at(-1)
    assert.equal(payload.token, 'demo')
    assert.equal(payload.referrer.name, 'Alex Exemple')
    assert(!Object.hasOwn(payload, 'referent'))
    assert(!Object.hasOwn(payload, 'participationId'))
    assert(!Object.hasOwn(payload.formation ?? {}, 'hours'))
    if (route === 'fiche-contact') {
      assert.equal(payload.participants.length, 0)
      assert.equal(payload.formation.sessions, null, 'Empty count must not become zero')
      assert.equal(payload.operations.groupedSchools, false)
      assert.equal(payload.schoolDetails.type, 'Collège')
    }
    if (route === 'deploiement') {
      assert.equal(payload.declaredTrainers.length, 2)
      assert.equal(payload.formation.sessions, 5)
      assert.equal(payload.formation.start, '')
      assert.equal(payload.formation.end, '')
      assert.equal(payload.confirmed, true)
      assert(!Object.hasOwn(payload, 'operations'))
      assert(!Object.hasOwn(payload, 'schoolDetails'))
    }
    if (route === 'participants') assert.equal(payload.formation, null)
  }

  // Native confirmation, chronological validation and dynamic row controls.
  await goto('deploiement')
  await fill('deploiement')
  await expect(page.locator('[data-trainer] [data-remove]')).toBeDisabled()
  await page.locator('[name=start]').fill('2026-11-04')
  const beforePair = publicPosts.length
  await submit()
  await expect(feedback).toContainText('Indiquez les deux dates')
  assert.equal(publicPosts.length, beforePair)
  await goto('participants')
  await expect(page.locator('[data-person]')).toHaveCount(1)
  await expect(page.locator('[data-person] [data-remove]')).toBeDisabled()
  await page.locator('#of-add-person').click()
  await expect(page.locator('[data-person]')).toHaveCount(2)
  await page.locator('[data-person]').last().locator('[data-remove]').click()
  await expect(page.locator('[data-person]')).toHaveCount(1)
  await goto()
  await fill()
  const beforeValidation = publicPosts.length
  await page.locator('[name=confirmed]').uncheck()
  await submit()
  assert.equal(publicPosts.length, beforeValidation)
  await page.locator('[name=confirmed]').check()
  await page.locator('[name=end]').fill('2026-01-01')
  await submit()
  await expect(feedback).toContainText('une fin ne peut pas précéder son début')
  assert.equal(publicPosts.length, beforeValidation)
  await page.locator('[name=end]').fill('2027-01-20')

  // A pending submit locks every input and ignores a second submit event.
  let unlock
  releasePublic = new Promise((resolve) => {
    unlock = resolve
  })
  await submit()
  await expect(form).toHaveAttribute('aria-busy', 'true')
  await expect(form.locator('[type=submit]')).toBeDisabled()
  await form.dispatchEvent('submit')
  unlock()
  await expect(feedback).toContainText('Test terminé')
  releasePublic = undefined
  assert.equal(publicPosts.length, beforeValidation + 1)

  // API error and indeterminate network result retain answers, never auto retry.
  for (const mode of ['error', 'uncertain']) {
    await goto()
    await fill()
    publicMode = mode
    const before = publicPosts.length,
      href = page.url()
    await submit()
    await expect(feedback).toHaveAttribute('role', 'alert')
    await expect(feedback).toContainText(
      mode === 'error' ? 'adresses e-mail' : 'Aucun nouvel essai automatique',
    )
    await expect(page.locator('[name=referentName]')).toHaveValue('Alex Exemple')
    await expect(form.locator('[type=submit]')).toBeEnabled()
    assert.equal(publicPosts.length, before + 1)
    assert.equal(page.url(), href)
    assert(
      !(await page
        .locator('body')
        .innerText()
        .then((text) => text.includes('INTERNAL-DETAIL-NOT-FOR-UI'))),
    )
  }
  // Terminal states for the production-facing UI (still only a local fixture).
  for (const [mode, message] of [
    ['retryable', 'Votre réponse n’a pas été enregistrée'],
    ['payload_changed', 'Votre nouvelle saisie n’a pas été enregistrée'],
  ]) {
    await goto()
    await fill()
    publicMode = mode
    const before = publicPosts.length
    await submit()
    await expect(feedback).toContainText(message)
    await expect(form).toBeVisible()
    await expect(form.locator('[type=submit]')).toBeEnabled()
    await expect(page.locator('[name=referentName]')).toHaveValue('Alex Exemple')
    await expect(feedback).not.toContainText('a été reçue')
    assert.equal(publicPosts.length, before + 1)
  }
  for (const [state, message] of [
    ['review', 'nécessite une vérification'],
    ['processing', 'en cours de confirmation'],
  ]) {
    await goto()
    await fill()
    await form.evaluate((node) => {
      node.dataset.preview = 'false'
    })
    publicMode = state
    const before = publicPosts.length
    await submit()
    await expect(feedback).toContainText(message)
    await expect(form).toBeHidden()
    await form.dispatchEvent('submit')
    assert.equal(publicPosts.length, before + 1)
  }
  publicMode = 'real'

  // The internal page uses its real access check, then synthetic API results.
  await page.goto(`${origin}/interne/formulaires?dossier=902`)
  const linkForm = page.locator('#operational-link-form'),
    linkSubmit = linkForm.locator('[type=submit]')
  await expect(linkSubmit).toBeEnabled()
  await expect(linkForm.locator('[name=participationId]')).toHaveValue('902')
  await expect(page.locator('#submissions-feedback')).toContainText(
    '4 tentative(s) consultée(s), dont 3 à vérifier',
  )
  await expect(page.locator('#submissions-list')).toContainText('École de démonstration')
  await expect(page.locator('#submissions-list')).toContainText(
    'Les dates proposées diffèrent de celles du dossier',
  )
  const retryableCard = page
    .locator('.of-submission')
    .filter({ hasText: 'Réponses non enregistrées' })
  await expect(retryableCard).toContainText('Tentative le')
  await expect(retryableCard).not.toContainText('Reçue le')
  assert(
    !(await page
      .locator('body')
      .innerText()
      .then((text) => text.includes('INTERNAL-DETAIL-NOT-FOR-UI'))),
  )
  await expect(page.locator('#link-result')).toBeVisible()
  await expect(linkSubmit).toHaveText('Renouveler le lien')
  assert.equal(linkPosts.length, 0, 'Viewing an existing link does not create/renew it')
  await linkForm.locator('[name=kind]').selectOption('participants')
  await expect(linkSubmit).toHaveText('Créer le lien')
  releaseLink = new Promise((resolve) => {
    unlock = resolve
  })
  await linkSubmit.click()
  await expect(linkSubmit).toBeDisabled()
  await linkForm.dispatchEvent('submit')
  unlock()
  await expect(page.locator('#link-result')).toBeVisible()
  releaseLink = undefined
  assert.deepEqual(linkPosts, [{ participationId: 902, kind: 'participants' }])
  await page.locator('#link-copy').click()
  await expect(page.locator('#copy-feedback')).toContainText('Lien copié')
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    await page.locator('#link-url').inputValue(),
  )
  await linkForm.locator('[name=kind]').selectOption('contact')
  await expect(page.locator('#link-result')).toBeVisible()
  await expect(page.locator('#link-url')).toHaveValue(fixture.dossiers[1].links.contact.url)
  await expect(linkSubmit).toHaveText('Renouveler le lien')
  failLink = true
  await linkSubmit.click()
  await expect(page.locator('#link-feedback')).toContainText('Aucun nouvel essai automatique')
  assert.equal(linkPosts.length, 2)
  failLink = false
  failRead = true
  await page.locator('#links-refresh').click()
  await expect(page.locator('#submissions-feedback')).toContainText(
    'Aucun bilan ne peut être affiché',
  )
  await expect(linkSubmit).toBeDisabled()
  await expect(page.locator('#submissions-list')).toBeHidden()
  failRead = false

  // Real viewport checks on all four compiled pages, not CSS emulation.
  for (const width of [320, 390, 680, 681, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const route of [...routes, 'internal']) {
      if (route === 'internal') {
        await page.goto(`${origin}/interne/formulaires?dossier=902`)
        await expect(linkSubmit).toBeEnabled()
        await expect(
          page
            .getByRole('navigation', { name: 'Espace interne' })
            .getByRole('link', { name: 'Formulaires', exact: true }),
        ).toHaveAttribute('aria-current', 'page')
      } else {
        await goto(route)
        if (route !== 'deploiement') {
          if (route === 'fiche-contact') await page.locator('#of-add-person').click()
          await page.locator('[data-person-field=firstName]').fill('Camille')
          await page.locator('[data-person-field=lastName]').fill('Exemple')
        }
      }
      await page.evaluate(() => document.fonts.ready)
      await expect(page.getByRole('banner')).toBeVisible()
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        content: document.documentElement.scrollWidth,
      }))
      assert(
        dimensions.content <= width + 1,
        `${route}: horizontal overflow at ${width}: ${dimensions.content}`,
      )
      const badFields = await page
        .locator('.of-field input,.of-field textarea,.of-field select')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const rect = node.getBoundingClientRect()
              return (
                rect.width &&
                (rect.left < 0 ||
                  rect.right > innerWidth + 1 ||
                  rect.height < 44 ||
                  parseFloat(getComputedStyle(node).fontSize) < 16)
              )
            })
            .map((node) => node.getAttribute('name')),
        )
      assert.deepEqual(badFields, [], `${route}: accessible input bounds at ${width}`)
      measures.push({ route, ...dimensions })
      if ([390, 1440].includes(width)) {
        await page.evaluate(() => scrollTo(0, 0))
        await page.screenshot({ path: `${output}/${route}-${width}-top.png` })
        await page.screenshot({ path: `${output}/${route}-${width}-full.png`, fullPage: true })
        if (route !== 'internal') {
          await page
            .locator(route === 'deploiement' ? '#of-trainers' : '#of-participants')
            .scrollIntoViewIfNeeded()
          await page.screenshot({ path: `${output}/${route}-${width}-adults.png` })
        }
      }
    }
  }
  assert.deepEqual(errors, [], 'No browser JavaScript errors')
  const report = {
    compiledPreviewValidation: routes,
    compiledErrorPages: linkErrors.map(({label,status}) => ({label,status})),
    viewports: measures,
    publicPosts: publicPosts.length,
    linkPosts: linkPosts.length,
    browserErrors: errors,
    checks: [
      'strict JSON contract incl all deployment fields and multiple trainers',
      'no reload',
      'one POST during pending',
      'required confirmations',
      'date order',
      'participant add/remove',
      'error retains input',
      'no automatic retries',
      'review/processing terminal',
      'private SSR and noindex/no-store',
      'no token in canonical/OG',
      'internal access denied without token',
      'contextual dossier preselection',
      'copy link',
      'read failure is not zero',
      'existing valid link displayed/copied without renewing',
      'retryable and payload_changed keep unsaved answers visible',
      'canonical euneos.fr links usable from another staff origin',
      'staff retryable label, date and actionable review reasons',
      'mobile/desktop header and field bounds',
    ],
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  verified = true
  console.log(
    `Operational UI: passed ${measures.length} viewport/page checks; real compiled preview API validated all three forms. Evidence: ${output}`,
  )
} finally {
  await browser.close()
  if (process.env.CHECK_KEEP_SERVER === '1' && verified) {
    await writeFile(`${output}/preview-url.txt`, origin)
    console.log(
      `Local synthetic preview: ${origin}/suivi/fiche-contact?t=demo ; ${origin}/interne/formulaires?dossier=902`,
    )
  } else server.stop(true)
}
