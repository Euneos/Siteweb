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
// Relations éditoriales, mesurées sur les éléments rendus. Une séparation
// extérieure régulière ne garantit pas la proximité du titre et de son texte.
const contentSpacing = {
  '/': [
    ['.constat__in h2', '.constat__txt', 'lie', 'mobile'],
    ['.constat__txt .source', '.constat__txt .cta', 'titre'],
    ['.confiance__t', '.confiance__logos', 'titre'],
    ['.prog__t', '.prog__cards', 'titre'],
    ['.impact__t', '.impact__sur', 'lie'],
    ['.impact__sur', '.impact__cards', 'titre'],
    ['.parcours__t', '.parcours__cards', 'titre'],
    ['.impact__cards > li', null, 'grille', 'mobile'],
    ['.prog__cards > li', null, 'grille', 'mobile'],
    ['.parcours__cards > li', null, 'grille', 'mobile'],
  ],
  '/programme': [
    ['.erasmus__l1', '.erasmus__l2', 'lie'],
    ['.why__in h2', '.why__txt', 'lie', 'mobile'],
    ['.why__txt p:last-of-type', '.why__txt .cta', 'titre'],
    ['.methodo__t', '.methodo', 'titre'],
    ['.methodo', '.methodo__cta', 'titre'],
    ['.resultat__t', '.resultat__p', 'lie'],
    ['.resultat__p', '.impact2', 'titre'],
    ['.impact2__t', '.impact2__list', 'titre'],
    ['[data-section="modules"] .c-t', '.modules', 'titre'],
    ['.modules', '.modules__cta', 'titre'],
    ['.deroule__t', '.deroule__lead', 'lie'],
    ['.deroule__lead', '.etapes', 'titre'],
    ['.etapes', '.etapes__cta', 'titre'],
    ['.temoins__t', '.temoins', 'titre'],
    ['.temoins', '.temoins__cta', 'titre'],
    ['.faq__t', '.faq-list__item:first-child summary', 'titre'],
    ['.faq-list', '.faq__all', 'titre'],
    ['.etapes__item', null, 'grille', 'mobile'],
  ],
  '/qui-sommes-nous': [
    ['.fond__t', '.fond__txt', 'lie', 'mobile'],
    ['.fond__in', '.fond__cta', 'titre'],
    ['[data-section="approche"] .a-t', '.actions', 'titre'],
    ['[data-section="niveaux"] .a-t', '.niveaux', 'titre'],
    ['.ca__t', '.ca__intro', 'lie'],
    ['.ca__intro', '.ca-sec .equipe-carousel', 'titre'],
    ['.equipe-sec .c-t', '.equipe-sec .equipe-carousel', 'titre'],
    ['.parcours__t', '.parcours__cards', 'titre'],
    ['.niveaux > li', null, 'grille', 'mobile'],
    ['.parcours__cards > li', null, 'grille', 'mobile'],
  ],
  '/contact': [['.ct__panel h1', '.ct__form', 'titre']],
  ...Object.fromEntries(
    ['/newsletter', '/candidater/etablissement', '/candidater/formateur'].map((path) => [
      path,
      [
        ['.cand__panel h1', '.cand__chapo', 'lie'],
        ['.cand__chapo', '.cand__form', 'titre'],
      ],
    ]),
  ),
  '/404': [
    ['.nf__panel h1', '.nf__txt', 'lie'],
    ['.nf__txt', '.nf__liens', 'titre'],
  ],
}
async function measureContent(page, path) {
  return page.evaluate((relations) => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;visibility:hidden;width:0;pointer-events:none'
    document.body.append(probe)
    const spacing = {}
    for (const role of ['lie', 'titre', 'grille']) {
      probe.style.height = `var(--s-${role})`
      spacing[role] = probe.getBoundingClientRect().height
    }
    probe.remove()
    const measurements = relations.flatMap(([from, to, role, media]) => {
      if (media === 'mobile' && innerWidth > 860) return []
      const rects = (selector) =>
        [...document.querySelectorAll(selector)]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width && r.height)
          .sort((a, b) => a.top - b.top)
      const starts = rects(from)
      const ends = to ? rects(to) : starts.slice(1)
      if (!starts.length || !ends.length) return [{ from, to, ok: false, error: 'Élément absent' }]
      const pairs = to ? [[starts.at(-1), ends[0]]] : ends.map((end, i) => [starts[i], end])
      return pairs.map(([start, end], index) => {
        const gap = end.top - start.bottom
        return {
          from,
          to,
          index,
          role,
          gap,
          expected: spacing[role],
          ok: Math.abs(gap - spacing[role]) < 1,
        }
      })
    })
    if (innerWidth <= 860) {
      for (const button of document.querySelectorAll('.niveau__cta')) {
        const rect = button.getBoundingClientRect()
        const fontSize = parseFloat(getComputedStyle(button).fontSize)
        measurements.push({
          from: '.niveau__cta',
          role: 'bouton mobile lisible et tactile',
          height: rect.height,
          width: rect.width,
          fontSize,
          ok: rect.height >= 44 && rect.width >= 44 && fontSize >= 16,
        })
      }
    }
    return measurements
  }, contentSpacing[path])
}
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
        reports.push({ path, ...report, content: await measureContent(page, path) })
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
        [...r.gaps, ...r.content]
          .filter((g) => !g.ok)
          .map((g) => ({ width: r.width, opened: r.opened, ...g })),
      )
    console.log(
      path,
      failures.length
        ? JSON.stringify(failures)
        : 'intervalles entre sections et relations internes cohérents, contenus ouverts et fermés',
    )
  }
  for (const path of Object.keys(contentSpacing).filter((path) => !pages[path])) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(base + path)
      await page.evaluate(() => document.fonts.ready)
      reports.push({ path, width, gaps: [], content: await measureContent(page, path) })
    }
    const failures = reports
      .filter((r) => r.path === path)
      .flatMap((r) => r.content.filter((c) => !c.ok).map((c) => ({ width: r.width, ...c })))
    console.log(
      path,
      failures.length ? JSON.stringify(failures) : 'titre, introduction et contenu cohérents',
    )
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ base, reports }, null, 2))
  assert(
    reports.every((r) => [...r.gaps, ...r.content].every((g) => g.ok)),
    'Les intervalles extérieurs et les relations internes suivent leurs rôles respectifs',
  )
} finally {
  await browser.close()
}
