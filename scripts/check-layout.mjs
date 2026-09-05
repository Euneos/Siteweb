import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Lancer le site dans un autre terminal avant ce contrôle. Aucune soumission réelle.
const base = process.env.CHECK_BASE_URL ?? 'http://127.0.0.1:4321'
const output = process.env.CHECK_SCREENSHOTS
if (output) await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
const page = await browser.newPage({ reducedMotion: 'reduce' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const box = async (selector) => {
  const result = await page.locator(selector).first().boundingBox()
  assert(result, `${selector} doit être visible`)
  return result
}
const bottom = (b) => b.y + b.height
try {
  for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(`${base}/qui-sommes-nous`)
    await page.evaluate(() => document.fonts.ready)
    const gap = async () => (await box('.fond__details summary')).y - bottom(await box('.fond__txt > p'))
    const closedGap = await gap()
    await page.locator('.fond__details summary').click()
    assert(Math.abs(await gap() - closedGap) < 1, `Fondements : espace instable à ${width}px`)
    await page.locator('.fond__details summary').click()
    assert(Math.abs(await gap() - closedGap) < 1)
    const title = await box('.ca__t')
    const intro = await box('.ca__intro')
    const carousel = await box('.ca-carousel')
    assert(intro.y - bottom(title) < carousel.y - bottom(intro), `Rythme du conseil à ${width}px`)
    const photo = await box('.mission__media .ph')
    const badge = await box('.mission__badge')
    const card = await box('.mission__card')
    assert(Math.abs(badge.y - bottom(photo)) < 1, `Cartouche sous la photo à ${width}px`)
    if (width <= 860) assert(card.y >= bottom(badge) - 1, 'Le texte ne chevauche pas le cartouche')
    for (const paragraph of await page.locator('.mission__card > p').all()) {
      const p = await paragraph.boundingBox()
      assert(!(p.x < badge.x + badge.width && p.x + p.width > badge.x && p.y < bottom(badge) && bottom(p) > badge.y), `Cartouche sur le texte à ${width}px`)
    }
    for (const selector of ['.mission__card', '.mission__badge', '.mission__picto', '.fond__txt', '.ca__intro']) {
      const b = await box(selector)
      assert(b.x >= -1 && b.x + b.width <= width + 1, `${selector} sort de l'écran à ${width}px`)
    }
    const bio = page.locator('.ca__bio').first()
    const summary = bio.locator('summary')
    const closedCard = await box('.equipe--ca .membre__card')
    await summary.focus()
    await page.keyboard.press('Enter')
    assert(await bio.evaluate((el) => el.open), 'Ouverture au clavier')
    const openCard = await box('.equipe--ca .membre__card')
    const text = await box('.ca__bio > p')
    const button = await summary.boundingBox()
    assert(openCard.height > closedCard.height, 'Biographie développée')
    assert(button.width >= 44 && button.height >= 44, 'Cible tactile du +')
    assert(button.y >= bottom(text), 'Le + ne recouvre pas la biographie')
    const typography = await bio.locator('p').evaluate((el) => {
      const s = getComputedStyle(el)
      return { size: parseFloat(s.fontSize), line: parseFloat(s.lineHeight) }
    })
    assert(typography.size >= 16 && typography.line / typography.size <= 1.35, 'Biographie lisible et interligne resserré')
    if (output && [390, 1440].includes(width)) await page.locator('.ca-sec').screenshot({ path: `${output}/conseil-ouvert-${width}.png` })
    await summary.press('Enter')
    assert(!await bio.evaluate((el) => el.open), 'Fermeture au clavier')
    await page.locator('[data-direction="next"]').click()
    await page.waitForFunction(() => document.querySelector('[data-carousel-track]').scrollLeft > 0)
    await page.locator('[data-direction="previous"]').click()
    await page.waitForFunction(() => document.querySelector('[data-carousel-track]').scrollLeft < 1)
    if (output && [390, 1440].includes(width)) {
      for (const selector of ['.fond', '.mission', '.ca-sec']) await page.locator(selector).screenshot({ path: `${output}/${selector.slice(1)}-${width}.png` })
    }
    for (const path of ['/', '/programme']) {
      await page.goto(`${base}${path}`)
      const panel = await box('.final')
      for (const selector of ['.final h2', '.final__cta']) {
        const b = await box(selector)
        assert(b.x >= panel.x && b.x + b.width <= panel.x + panel.width + 1, `${selector} à ${width}px`)
        assert(b.y >= panel.y && bottom(b) <= bottom(panel), 'Contenu dans le bandeau')
      }
      if (width <= 860) assert((await box('.final__fig')).y >= bottom(await box('.final__cta')), 'Décor sous le contenu mobile')
      if (output && [390, 1440].includes(width) && path === '/programme') await page.locator('.final').screenshot({ path: `${output}/bandeau-${width}.png` })
    }
    console.log(`✓ ${width}px : espacements, compositions, biographies, carrousel, bandeaux`)
  }
  assert.deepEqual(errors, [], 'Erreurs JavaScript dans le navigateur')
} finally {
  await browser.close()
}
