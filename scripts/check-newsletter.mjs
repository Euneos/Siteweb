import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

// Recette du navigateur sur serveur local ou preview : aucun email réel.
const base = process.env.CHECK_BASE_URL ?? 'http://127.0.0.1:4321'
const host = new URL(base).hostname
assert(['localhost', '127.0.0.1'].includes(host) || /^pr-\d+\.euneos-site\.pages\.dev$/.test(host), 'Utiliser un serveur local ou une preview de PR')
const output = process.env.NEWSLETTER_SCREENSHOTS
if (output) await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
let checks = 0
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const [path, formId, statusId] of [
      ['/', 'newsletter', 'newsletter-status'],
      ['/programme', 'newsletter', 'newsletter-status'],
      ['/newsletter', 'nl-form', 'nl-page-status'],
      ['/newsletter', 'newsletter', 'newsletter-status'],
    ]) {
      await page.goto(base + path)
      await page.evaluate(() => document.fonts.ready)
      const form = page.locator(`#${formId}`)
      const status = page.locator(`#${statusId}`)
      await form.locator('[name="nom"]').fill('Test navigateur')
      await form.locator('[name="email"]').fill('test@example.com')
      await form.locator('[value="partenaire"]').check()
      const button = formId === 'nl-form' ? page.locator('[form="nl-form"]') : form.locator('button[type="submit"]')
      await button.scrollIntoViewIfNeeded()
      const initialScroll = await page.evaluate(() => scrollY)
      const initialUrl = page.url()
      let navigations = 0
      page.on('framenavigated', onNavigate)
      function onNavigate(frame) { if (frame === page.mainFrame()) navigations++ }
      // Le vrai endpoint de preview renvoie le résultat JSON sans appeler Brevo.
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/newsletter'))
      await button.click()
      const response = await responsePromise
      assert.equal(response.request().resourceType(), 'fetch')
      assert.deepEqual(await response.json(), { state: 'confirmation', preview: true })
      await expect(status).toContainText('Vérifiez votre boîte e-mail')
      await expect(status).toBeInViewport()
      await expect(button).toBeEnabled()
      assert.equal(page.url(), initialUrl)
      assert.equal(navigations, 0, 'Aucun rechargement du document')
      const finalScroll = await page.evaluate(() => scrollY)
      assert(finalScroll >= initialScroll - 100, `${path} ${formId} à ${width}px : pas de retour en haut (${initialScroll} → ${finalScroll})`)
      if (output) await page.screenshot({ path: `${output}/${formId}-${path === '/' ? 'accueil' : path.slice(1)}-${width}.png` })
      checks++

      for (const state of ['deja-inscrit', 'technique', 'network', 'html']) {
        let requests = 0
        let release
        const pending = new Promise(resolve => { release = resolve })
        await page.route('**/api/newsletter', async route => {
          requests++
          await pending
          if (state === 'network') await route.abort('failed')
          else if (state === 'html') await route.fulfill({ status: 429, contentType: 'text/html', body: '<h1>Trop de demandes</h1>' })
          else await route.fulfill({ status: state === 'technique' ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ state }) })
        })
        await button.click()
        await expect(button).toBeDisabled()
        await expect(form).toHaveAttribute('aria-busy', 'true')
        // Une deuxième soumission pendant la première ne crée pas de requête.
        await form.evaluate(element => element.requestSubmit())
        release()
        await expect(status).toContainText(state === 'deja-inscrit' ? 'déjà inscrite' : 'erreur technique')
        await expect(button).toBeEnabled()
        await expect(status).toBeInViewport()
        await expect(form.locator('[name="nom"]')).toHaveValue('Test navigateur')
        await expect(form.locator('[name="email"]')).toHaveValue('test@example.com')
        await expect(form.locator('[value="partenaire"]')).toBeChecked()
        await expect(status).toHaveAttribute('role', 'alert')
        assert.equal(requests, 1)
        assert.equal(navigations, 0)
        assert.equal(page.url(), initialUrl)
        await page.unroute('**/api/newsletter')
        checks++
      }
      page.off('framenavigated', onNavigate)
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
  // Le formulaire natif reste utilisable sans JavaScript.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  for (const [path, formId] of [['/', 'newsletter'], ['/newsletter', 'nl-form']]) {
    await page.goto(base + path)
    const form = page.locator(`#${formId}`)
    await form.locator('[name="nom"]').fill('Test sans JavaScript')
    await form.locator('[name="email"]').fill('test@example.com')
    await form.locator('[value="partenaire"]').check()
    const button = formId === 'nl-form' ? page.locator('[form="nl-form"]') : form.locator('button[type="submit"]')
    await button.click()
    await expect(page).toHaveURL(/\/newsletter\?nl=confirmation&preview=1#inscription$/)
    await expect(page.locator('#nl-page-status')).toContainText('Vérifiez votre boîte e-mail')
    await expect(page.locator('#nl-form')).toHaveCount(0)
    checks++
  }
  await context.close()
  console.log(`${checks} contrôles newsletter réussis : ordinateur/téléphone, sans navigation, erreurs, double clic, sans JavaScript.`)
} finally {
  await browser.close()
}
