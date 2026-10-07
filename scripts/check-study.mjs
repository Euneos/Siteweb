import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
const base = process.env.CHECK_BASE_URL ?? 'http://127.0.0.1:4321'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname) || /^pr-\d+\.euneos-site\.pages\.dev$/.test(new URL(base).hostname))
const browser = await chromium.launch()
await mkdir('/tmp/euneos-study', { recursive: true })
try {
  for (const width of [320, 390, 860, 1440]) {
    for (const [path, prefix, popup] of [['/programme', 'study', true], ['/etudewiseup', 'study-page', false]]) {
      for (const state of ['confirmation', 'deja-inscrit']) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true })
        page.setDefaultTimeout(15_000)
        page.setDefaultNavigationTimeout(15_000)
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        console.log(`Étude : ${path}, ${state}, ${width} px`)
        await page.goto(base + path)
        const shell = page.locator('.study-form-shell')
        await expect(shell).toBeVisible()
        await expect(shell.locator('[name="website"]')).toHaveCount(0)
        await expect(shell.locator('[name="euneos_study_check"]')).toHaveAttribute('autocomplete', 'new-password')
        await expect(shell.locator('.study-invitation')).toHaveCSS('color', 'rgb(248, 199, 2)')
        await expect(page.locator('#study-popup')).toHaveCount(popup ? 1 : 0)
        await expect(shell.locator('[name="profil"]')).toHaveCount(4)
        assert(await shell.evaluate(el => el.scrollWidth <= el.clientWidth + 1))
        if (state === 'confirmation') await page.screenshot({ path: `/tmp/euneos-study/${popup ? 'popup' : 'page'}-${width}.png` })
        await page.locator(`#${prefix}-nom`).fill('Recette locale')
        await page.locator(`#${prefix}-mail`).fill('test@example.com')
        assert.equal(await shell.locator('.champ').first().evaluate(el => getComputedStyle(el).clipPath), 'none')
        const pdf = Buffer.from(await readFile(new URL('../src/assets/etude-europeenne.base64', import.meta.url), 'utf8'), 'base64')
        await page.route(/\/api\/etude\?token=recette$/, route => route.fulfill({ body: pdf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=etude-europeenne-euneos.pdf' } }))
        await page.route('**/api/newsletter', route => route.fulfill({ json: { state, download: '/api/etude?token=recette' } }))
        const downloadPromise = page.waitForEvent('download')
        await page.locator(`[form="${prefix}-form"]`).click()
        const download = await downloadPromise
        assert.equal(download.suggestedFilename(), 'etude-europeenne-euneos.pdf')
        assert.equal(await download.failure(), null, 'Le téléchargement doit terminer')
        assert.deepEqual(await readFile(await download.path()), pdf)
        const status = page.locator(`#${prefix}-status`)
        await expect(status).toHaveText(state === 'confirmation' ? 'Inscription confirmée. Bienvenue dans la newsletter EUNEOS.' : 'Vous êtes déjà inscrits à la newsletter EUNEOS.')
        await expect(status).toHaveAttribute('role', 'status')
        await expect(status.locator('a')).toHaveCount(0)
        if (popup) {
          await page.keyboard.press('Escape')
          await expect(page.locator('#study-popup')).not.toBeVisible()
          await page.goto(base + '/contact')
          await expect(page.locator('#study-popup')).not.toBeVisible()
        }
        assert.deepEqual(errors, [])
        await page.close()
      }
    }
  }
  const page = await browser.newPage()
  await page.goto(base + '/etudewiseup')
  await page.locator('#study-page-nom').fill('Recette locale')
  await page.locator('#study-page-mail').fill('test@example.com')
  await page.route('**/api/newsletter', route => route.fulfill({ json: { state: 'ok' } }))
  await page.locator('[form="study-page-form"]').click()
  await expect(page.locator('#study-page-status')).toHaveAttribute('role', 'alert')
  await expect(page.locator('#study-page-status')).not.toContainText('Inscription confirmée')
  const response = await page.request.get(base + '/api/etude')
  assert([403, 503].includes(response.status()))
  assert(!(response.headers()['content-type'] ?? '').includes('application/pdf'))
  console.log('Étude : popup et page, nouveaux abonnés et abonnés existants, téléchargement complet et message vérifiés à quatre largeurs.')
} finally { await browser.close() }
