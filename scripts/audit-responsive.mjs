import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.CHECK_BASE_URL ?? 'http://127.0.0.1:4321'
const output = process.env.AUDIT_OUTPUT ?? '/tmp/euneos-responsive'
const widths = process.env.AUDIT_WIDTHS
  ? process.env.AUDIT_WIDTHS.split(',').map(Number)
  : [
      ...new Set([
        ...Array.from({ length: 141 }, (_, i) => 320 + i * 16),
        360,
        375,
        390,
        393,
        412,
        414,
        430,
        479,
        480,
        481,
        599,
        600,
        601,
        767,
        768,
        769,
        859,
        860,
        861,
        899,
        900,
        901,
        1023,
        1024,
        1025,
        1099,
        1100,
        1101,
        1299,
        1300,
        1301,
        1366,
        1920,
        2560,
        3440,
        3840,
      ]),
    ].sort((a, b) => a - b)
const routes = [
  '/',
  '/programme',
  '/qui-sommes-nous',
  '/contact',
  '/newsletter',
  '/candidater/etablissement',
  '/candidater/formateur',
  '/faq',
  '/mentions-legales',
  '/politique-de-confidentialite',
  '/cookies',
  '/404',
  '/style-guide',
]
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
await mkdir(output, { recursive: true })
const reports = []
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.route('**/api/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (
      ['stylesheet', 'script', 'font'].includes(response.request().resourceType()) &&
      response.status() >= 400
    )
      errors.push(`Ressource ${response.status()} : ${response.url()}`)
  })
  for (const route of routes) {
    const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' })
    if (response.status() >= 400 && !(route === '/404' && response.status() === 404))
      errors.push(`Page ${response.status()} : ${route}`)
    await page.evaluate(() => document.fonts.ready)
    const failures = []
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      const inspect = () =>
        page.evaluate(() => {
          const failures = []
          if (!getComputedStyle(document.documentElement).getPropertyValue('--s-bloc').trim())
            failures.push({ type: 'styles-not-loaded' })
          if (document.documentElement.scrollWidth > innerWidth + 1)
            failures.push({
              type: 'page-overflow',
              excess: document.documentElement.scrollWidth - innerWidth,
            })
          const seen = new Set()
          for (const el of document.querySelectorAll(
            'h1,h2,h3,p,a,label,legend,summary,button,input,select,textarea',
          )) {
            if (el.closest('[aria-hidden="true"],.sr-only,.form-trap,.skip-link,svg')) continue
            const style = getComputedStyle(el)
            const rect = el.getBoundingClientRect()
            if (
              !rect.width ||
              !rect.height ||
              style.visibility === 'hidden' ||
              style.display === 'none'
            )
              continue
            const details = el.closest('details:not([open])')
            if (details && !details.querySelector('summary')?.contains(el)) continue
            const carousel = el.closest('[data-carousel-track]')
            if (carousel) continue // Separate interaction tests scroll every carousel to its last card.
            const key = `${el.tagName}.${typeof el.className === 'string' ? el.className : ''}`
            if (rect.left < -2 || rect.right > innerWidth + 2) {
              if (!seen.has(key))
                failures.push({
                  type: 'element-overflow',
                  selector: key,
                  text: el.textContent?.trim().slice(0, 90),
                  x: Math.round(rect.x),
                  right: Math.round(rect.right),
                })
              seen.add(key)
            }
            if (
              ['H1', 'H2', 'H3', 'P', 'LABEL', 'LEGEND', 'SUMMARY', 'BUTTON'].includes(
                el.tagName,
              ) &&
              el.clientWidth &&
              el.scrollWidth > el.clientWidth + 2 &&
              style.overflowX === 'visible'
            ) {
              if (!seen.has(key + 'content'))
                failures.push({
                  type: 'content-overflow',
                  selector: key,
                  text: el.textContent?.trim().slice(0, 90),
                  excess: el.scrollWidth - el.clientWidth,
                })
              seen.add(key + 'content')
            }
          }
          return failures
        })
      const closed = await inspect()
      if (process.env.AUDIT_SCREENSHOTS && [390, 860, 1440].includes(width)) {
        await page.evaluate(async () => {
          for (const img of document.images) {
            img.loading = 'eager'
          }
          await Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
        })
        await page.mouse.move(0, 0)
        await page.evaluate(() => document.activeElement?.blur())
        await page.screenshot({
          path: `${output}/${route.replaceAll('/', '_') || 'home'}-${width}.png`,
          fullPage: true,
        })
      }
      await page.locator('main details').evaluateAll((els) =>
        els.forEach((el) => {
          el.open = true
        }),
      )
      const opened = await inspect()
      await page.locator('main details').evaluateAll((els) =>
        els.forEach((el) => {
          el.open = false
        }),
      )
      const burger = page.locator('.hdr__burger')
      let menu = []
      if (await burger.isVisible()) {
        await burger.click()
        menu = await inspect()
        for (const link of await page.locator('.hdr__nav a').all()) {
          if (!(await link.isVisible())) continue
          await link.scrollIntoViewIfNeeded()
          if (
            !(await link.evaluate((el) => {
              const b = el.getBoundingClientRect()
              return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))
            }))
          )
            menu.push({ type: 'menu-link-obscured', text: await link.textContent() })
        }
        await page.keyboard.press('Escape')
      }
      if (closed.length || opened.length || menu.length)
        failures.push({ width, closed, opened, menu })
    }
    const result = { route, failures, errors: errors.splice(0) }
    reports.push(result)
    await writeFile(`${output}/report.json`, JSON.stringify({ base, widths, reports }, null, 2))
    console.log(
      `${route}: ${failures.length}/${widths.length} tailles avec anomalie, ${result.errors.length} erreurs JS/ressources`,
    )
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ base, widths, reports }, null, 2))
  console.log(
    `${routes.length} pages × ${widths.length} largeurs = ${routes.length * widths.length} dispositions contrôlées, états ouverts/fermés et menus.`,
  )
  if (reports.some((report) => report.failures.length || report.errors.length)) process.exitCode = 1
} finally {
  await browser.close()
}
