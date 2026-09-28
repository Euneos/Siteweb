import assert from 'node:assert/strict'
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import { imageFixture, syntheticEntry, sample } from '../tests/helpers/editorial-images.js'
import { saveEntry } from '../src/lib/internal-workspace.ts'

// Compiled app, synthetic data, local JWT and R2 double. No real data/credentials.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-editorial-images'
await mkdir(output, { recursive: true })
const fixture = imageFixture()
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'images-render', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'images-render.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'team-fixture',
  TEAM_WORKSPACE: fixture.db,
  EDITORIAL_IMAGES: fixture.bucket,
  INTERNAL_WORKSPACE_PREVIEW: 'true',
}
const jwt = await new SignJWT({ email: 'member@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setSubject('local-fixture')
  .setAudience(env.INTERNAL_ACCESS_AUD)
  .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
  .setExpirationTime('30m')
  .sign(privateKey)
const fetchOriginal = globalThis.fetch
globalThis.fetch = async (input) => {
  assert.equal(String(input), `https://${env.INTERNAL_ACCESS_DOMAIN}/cdn-cgi/access/certs`)
  return Response.json({ keys: [jwk] })
}
const worker = new URL('../dist/_worker.js/', import.meta.url)
const manifestName = (await readdir(worker)).find(
  (f) => f.startsWith('manifest_') && f.endsWith('.mjs'),
)
const { manifest } = await import(new URL(manifestName, worker))
const components = [
  'interne/index.astro',
  'api/interne/calendrier.ts',
  'api/interne/commentaires.ts',
  'api/interne/images.ts',
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
const id = await saveEntry(
  fixture.db,
  { email: 'member@example.test', admin: false },
  syntheticEntry(),
)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/interne') || url.pathname.startsWith('/api/interne')) {
      const headers = new Headers(request.headers)
      headers.set('Cf-Access-Jwt-Assertion', jwt) // Test harness only.
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
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/*', (route) => {
    assert.equal(new URL(route.request().url()).hostname, '127.0.0.1', 'Browser must stay local')
    return route.continue()
  })
  const origin = `http://127.0.0.1:${server.port}`
  const open = async () => {
    await page.goto(`${origin}/interne`)
    await expect(page.locator('#iw-calendar-content')).toHaveAttribute('aria-busy', 'false')
    await page.locator('#iw-month').fill('2026-09')
    await page.locator('#iw-month').press('Tab')
    await page
      .getByRole('button', { name: /Visuel de démonstration/ })
      .first()
      .click()
    await expect(page.locator('#iw-image-file')).toBeEnabled()
  }
  const choose = async (ext) => {
    await page.locator('#iw-image-file').setInputFiles({
      name: `synthetic.${ext}`,
      mimeType: ext === 'png' ? 'image/png' : 'image/jpeg',
      buffer: Buffer.from(sample(ext)),
    })
    await expect(page.locator('#iw-image-upload')).toBeVisible()
    await expect(page.locator('#iw-image-upload')).toBeEnabled()
    await expect
      .poll(() => page.locator('#iw-image-preview').evaluate((img) => img.naturalWidth))
      .toBe(640)
  }
  await open()
  await expect(page.locator('#iw-image-status')).toContainText('Aucun visuel')
  await choose('png')
  await page.locator('#iw-close').click()
  await expect(page.locator('#iw-close-warning')).toBeVisible()
  await page.locator('#iw-keep-editing').click()
  let releaseUpload, uploadStarted
  const uploadGate = new Promise((resolve) => {
    releaseUpload = resolve
  })
  const started = new Promise((resolve) => {
    uploadStarted = resolve
  })
  await page.route('**/api/interne/images*', async (route) => {
    if (route.request().method() === 'PUT') {
      uploadStarted()
      await uploadGate
    }
    await route.continue()
  })
  await page.locator('#iw-image-upload').click()
  await started
  await page.keyboard.press('Escape')
  await expect(page.locator('#iw-editor')).toBeVisible()
  await expect(page.locator('#iw-save-feedback')).toContainText('opération est en cours')
  releaseUpload()
  await expect(page.locator('#iw-image-status')).toContainText('Visuel enregistré.')
  await page.unroute('**/api/interne/images*')
  await expect(page.locator('#iw-image-pending')).toBeHidden()
  await expect
    .poll(() => page.locator('#iw-image-stored').evaluate((img) => img.naturalWidth))
    .toBe(640)
  const firstUrl = await page.locator('#iw-image-stored').getAttribute('src')
  for (const width of [320, 390, 860, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator('#iw-image-title').scrollIntoViewIfNeeded()
    await page.evaluate(() => document.fonts.ready)
    assert(
      await page.locator('#iw-editor').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `Dialog overflow ${width}`,
    )
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Page overflow ${width}`,
    )
    await page.screenshot({ path: `${output}/visuel-${width}.png` })
    checks.push({ width, overflow: false })
  }
  // Reload proves persistence; a stale client cannot replace a newer image.
  await open()
  await choose('jpg')
  await page.evaluate(
    async ({ id, bytes }) => {
      const response = await fetch(`/api/interne/images?entryId=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'If-Match': '"1"' },
        body: new Uint8Array(bytes),
      })
      if (!response.ok) throw new Error('Concurrent fixture upload failed')
    },
    { id, bytes: [...sample('png')] },
  )
  await page.locator('#iw-image-upload').click()
  await expect(page.locator('#iw-image-status')).toContainText('Le visuel a changé')
  await expect(page.locator('#iw-image-pending')).toBeVisible()
  await expect(page.locator('#iw-image-upload')).toBeDisabled()
  await page.locator('#iw-image-refresh').click()
  await expect(page.locator('#iw-image-upload')).toBeEnabled()
  await page.locator('#iw-image-pending').scrollIntoViewIfNeeded()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator('#iw-image-upload').scrollIntoViewIfNeeded()
    assert(
      await page.locator('#iw-editor').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `Replacement overflow ${width}`,
    )
    await page.screenshot({ path: `${output}/remplacement-${width}.png` })
  }
  await page.locator('#iw-image-upload').click()
  await expect(page.locator('#iw-image-status')).toContainText('Visuel enregistré.')
  assert.equal((await page.request.get(`${origin}${firstUrl}`)).status(), 404)
  // A response lost after commit is reconciled by a read, never auto-retried.
  await choose('png')
  let requests = 0
  await page.route('**/api/interne/images*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    requests++
    await route.fetch()
    await route.abort('failed')
  })
  await page.locator('#iw-image-upload').click()
  await expect(page.locator('#iw-image-status')).toContainText('Votre sélection est conservée')
  assert.equal(requests, 1)
  await page.unroute('**/api/interne/images*')
  await page.locator('#iw-image-refresh').click()
  await expect(page.locator('#iw-image-upload')).toBeEnabled()
  await page.locator('#iw-image-cancel').click()
  await page.locator('#iw-image-remove').click()
  await page.locator('#iw-image-keep').click()
  await expect(page.locator('#iw-image-current')).toBeVisible()
  await page.locator('#iw-image-remove').click()
  await page.locator('#iw-image-confirm-remove').click()
  await expect(page.locator('#iw-image-status')).toContainText('Visuel retiré')
  await expect(page.locator('#iw-image-current')).toBeHidden()
  assert.equal(fixture.objects.size, 0)
  // Missing binding leaves text editing operational.
  env.EDITORIAL_IMAGES = undefined
  await page.locator('#iw-image-refresh').click()
  await expect(page.locator('#iw-image-status')).toContainText('en préparation')
  await page.locator('#iw-content').fill('Le texte reste modifiable sans bucket.')
  await page.locator('#iw-save').click()
  await expect(page.locator('#iw-save-feedback')).toContainText('Fiche enregistrée')
  await page.locator('#iw-close').click()
  // New entries have no upload until they exist; team entries have none.
  await page.locator('#iw-new').click()
  await expect(page.locator('#iw-image-status')).toContainText('Enregistrez la fiche')
  await expect(page.locator('#iw-image-file')).toBeDisabled()
  await page.locator('#iw-close').click()
  await page.locator('[data-kind="equipe"]').click()
  await page.locator('#iw-new').click()
  await expect(page.locator('#iw-images')).toBeHidden()
  assert.deepEqual(errors, [])
  checks.push({
    png: true,
    jpg: true,
    reload: true,
    conflicts: true,
    lostResponse: true,
    delete: true,
    missingBucket: true,
    newAndTeam: true,
  })
  await writeFile(`${output}/checks.json`, JSON.stringify(checks, null, 2))
  console.log(
    `Images : ajout, aperçu, remplacement, conflits, panne, suppression et rendu 320/390/860/1440 OK. Captures : ${output}`,
  )
} finally {
  await browser.close()
  server.stop()
  fixture.sql.close()
  globalThis.fetch = fetchOriginal
}
