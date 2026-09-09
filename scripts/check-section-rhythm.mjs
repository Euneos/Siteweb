import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

// Chaque entrée représente un sujet perçu comme une section, avec ses limites
// visibles : titres, panneaux, photos et boutons, y compris ceux en débord.
const pages = {
  '/': {
    constat: '.constat__in',
    approche: '.approche__tag,.approche__media .ph,.approche__txt,.approche__cta',
    soutiens: '.confiance__t,.confiance__logos',
    programme: '.prog__in,.prog__cta',
    resultats: '.impact__t,.impact__sur,.impact__cards',
    candidater: '.final',
    candice: '.citation__name,.citation__ph,.citation__card,.citation__cta',
    photo: '.bloc-image__ph,.bloc-image__picto,.bloc-image__picto2',
    participer: '.parcours__t,.parcours__cards',
  },
  '/programme': {
    introduction: '.why__in',
    erasmus: '.erasmus__media,.erasmus__card',
    principes: '.methodo__t,.methodo,.methodo__cta',
    impact: '.resultat__t,.resultat__p,.impact2',
    modules: '.c-t,.modules,.modules__cta',
    etapes: '.deroule__t,.deroule__lead,.etapes,.etapes__cta',
    candidater: '.final',
    temoignages: '.temoins__t,.temoins,.temoins__cta',
    faq: '.faq__col,.faq__media .ph,.faq__picto,.faq__cartouche',
    formateurs: '.formateur',
  },
  '/qui-sommes-nous': {
    fondements: '.fond__in,.fond__cta',
    mission: '.mission__media .ph,.mission__badge,.mission__picto,.mission__card',
    approche: '.page',
    niveaux: '.page',
    conseil: '.page',
    equipe: '.page',
    participer: '.parcours__t,.parcours__cards',
  },
}
const base = process.env.CHECK_BASE_URL ?? 'http://127.0.0.1:4321'
const output = process.env.RHYTHM_OUTPUT ?? '/tmp/euneos-section-rhythm'
const widths = [320, 390, 768, 860, 861, 1024, 1440, 1920, 3840]
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
await mkdir(output, { recursive: true })
const reports = []
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.route('**/api/**', (route) =>
    route.request().method() === 'GET' ? route.continue() : route.abort(),
  )
  for (const [path, sections] of Object.entries(pages)) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(base + path)
      await page.evaluate(async () => {
        await document.fonts.ready
        for (const img of document.images) img.loading = 'eager'
        await Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
      })
      assert.deepEqual(
        await page
          .locator('main > [data-section]')
          .evaluateAll((els) => els.map((el) => el.dataset.section)),
        Object.keys(sections),
        'Découpage éditorial explicite',
      )
      for (const opened of [false, true]) {
        await page.locator('main details').evaluateAll(
          (els, open) =>
            els.forEach((el) => {
              el.open = open
            }),
          opened,
        )
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        )
        const report = await page.evaluate(
          ({ sections, opened }) => {
            const expected = parseFloat(getComputedStyle(document.querySelector('main')).rowGap)
            let previous = document.querySelector('.hero-zone').getBoundingClientRect().bottom
            const gaps = Object.entries(sections).map(([name, selector]) => {
              const section = document.querySelector(`[data-section="${name}"]`)
              const rects = [...section.querySelectorAll(selector)]
                .map((el) => el.getBoundingClientRect())
                .filter((r) => r.width && r.height)
              let top = Math.min(...rects.map((r) => r.top))
              let bottom = Math.max(...rects.map((r) => r.bottom))
              // Le panneau Programme commence au bord de son fond coloré.
              if (name === 'programme') top = section.getBoundingClientRect().top
              if (section.hasAttribute('data-section-surface')) {
                top = section.getBoundingClientRect().top
                bottom = section.getBoundingClientRect().bottom
              }
              const gap = top - previous
              previous = bottom
              return {
                name,
                gap: Math.round(gap * 100) / 100,
                expected,
                ok: Math.abs(gap - expected) < 1,
              }
            })
            const footerGap =
              document.querySelector('footer').getBoundingClientRect().top - previous
            gaps.push({
              name: 'footer',
              gap: Math.round(footerGap * 100) / 100,
              expected,
              ok: Math.abs(footerGap - expected) < 1,
            })
            return { width: innerWidth, opened, gaps }
          },
          { sections, opened },
        )
        reports.push({ path, ...report })
      }
      if (process.env.RHYTHM_SCREENSHOTS && [390, 860, 1440].includes(width)) {
        await page.locator('main details').evaluateAll((els) =>
          els.forEach((el) => {
            el.open = false
          }),
        )
        await page.mouse.move(0, 0)
        await page.screenshot({
          path: `${output}/${path.replaceAll('/', '_')}-${width}.png`,
          fullPage: true,
        })
      }
    }
    const failures = reports
      .filter((r) => r.path === path)
      .flatMap((r) =>
        r.gaps.filter((g) => !g.ok).map((g) => ({ width: r.width, opened: r.opened, ...g })),
      )
    console.log(
      path,
      failures.length
        ? JSON.stringify(failures)
        : 'espaces visuels réguliers, contenus ouverts et fermés',
    )
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ base, reports }, null, 2))
  assert(
    reports.every((r) => r.gaps.every((g) => g.ok)),
    'Tous les intervalles entre sections visuelles suivent le rythme commun',
  )
} finally {
  await browser.close()
}
