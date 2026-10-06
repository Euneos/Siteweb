import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
const base = process.env.CHECK_BASE_URL ?? 'http://127.0.0.1:4321'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname) || /^pr-\d+\.euneos-site\.pages\.dev$/.test(new URL(base).hostname))
const browser = await chromium.launch()
await mkdir('/tmp/euneos-study', { recursive: true })
try {
  for (const width of [320, 390, 860, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(base + '/programme')
    const dialog = page.locator('#study-popup')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[name="profil"]')).toHaveCount(4)
    assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    await page.screenshot({ path: `/tmp/euneos-study/popup-${width}.png` })
    await page.locator('#study-nom').fill('Recette locale')
    await page.locator('#study-mail').fill('test@example.com')
    await page.route('**/api/newsletter', route => route.fulfill({ json: { state: 'confirmation' } }))
    await page.locator('[form="study-form"]').click()
    await expect(page.locator('#study-status')).toContainText('confirmez votre inscription')
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await page.goto(base + '/contact')
    await expect(dialog).not.toBeVisible()
    await page.close()
  }
  const page = await browser.newPage()
  const response = await page.request.get(base + '/api/etude')
  assert([403, 503].includes(response.status()))
  assert(!(response.headers()['content-type'] ?? '').includes('application/pdf'))
  console.log('Popup : 4 largeurs, formulaire simulé, fermeture, session et PDF protégé vérifiés.')
} finally { await browser.close() }
