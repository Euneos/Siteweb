import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { chromium, expect } from '@playwright/test'
import { finalQuestionnaireDefinitions as definitions } from '../src/lib/final-questionnaire-definition'

// Real compiled previews only. Both production pages/endpoints must stay closed.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-final-questionnaires-qa'
await mkdir(output, { recursive: true })
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find((n) =>
  n.startsWith('manifest_'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const pageMap = new Map()
for (const def of definitions) {
  const page = await import(
    new URL(`../dist/_worker.js/pages/suivi/${def.slug}.astro.mjs`, import.meta.url)
  )
  const api = await import(
    new URL(`../dist/_worker.js/pages/api/questionnaires/${def.slug}.astro.mjs`, import.meta.url)
  )
  pageMap.set(`src/pages/suivi/${def.slug}.astro`, async () => page)
  pageMap.set(`src/pages/api/questionnaires/${def.slug}.ts`, async () => api)
}
const app = new App({ ...manifest, sessionConfig: undefined, pageMap })
const realFetch = globalThis.fetch
let networkCalls = 0,
  storageCalls = 0
const env = {
  OPERATIONAL_FORMS_ENABLED: 'true',
  NOCODB_TOKEN: 'fake-only',
  FORM_SUBMISSIONS: {
    prepare() {
      storageCalls++
      throw new Error('Storage forbidden')
    },
  },
}
globalThis.fetch = async () => {
  networkCalls++
  throw new Error('External transport forbidden')
}
const render = (path, production = false, body) => {
  const base = production ? 'https://euneos.fr' : 'http://localhost'
  return app.render(
    new Request(base + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { Origin: base, 'Content-Type': 'application/json' } : {},
      ...(body ? { body } : {}),
    }),
    { locals: { runtime: { env } } },
  )
}
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (
      definitions.some((d) =>
        [`/suivi/${d.slug}`, `/api/questionnaires/${d.slug}`].includes(url.pathname),
      )
    )
      return render(
        url.pathname,
        url.searchParams.has('production'),
        req.method === 'POST' ? await req.text() : undefined,
      )
    if (/^\/(?:_astro|fonts)\//.test(url.pathname) || url.pathname === '/favicon.svg')
      return new Response(Bun.file(new URL(`../dist${url.pathname}`, import.meta.url)))
    return new Response('Not found', { status: 404 })
  },
})
const origin = `http://127.0.0.1:${server.port}`
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
const measurements = [],
  errors = []
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  await context.route('**/*', (route) => {
    assert.equal(new URL(route.request().url()).origin, origin)
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  for (const def of definitions) {
    for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const response = await page.goto(`${origin}/suivi/${def.slug}`)
      assert.equal(response.status(), 200)
      assert.match(response.headers()['x-robots-tag'], /noindex/)
      await expect(page.locator('main')).toContainText('Aperçu de démonstration.')
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        content: document.documentElement.scrollWidth,
      }))
      assert(dimensions.content <= width + 1, `${def.slug} overflow at ${width}`)
      measurements.push({ slug: def.slug, ...dimensions })
      await page.screenshot({ path: `${output}/${def.slug}-${width}.png`, fullPage: true })
    }
    const form = page.locator('#final-questionnaire-form')
    for (const q of def.questions) {
      const control = form.locator(`[name="${q.key}"]`)
      if (q.type === 'radio' || q.type === 'scale') {
        assert.deepEqual(await control.evaluateAll((nodes) => nodes.map((n) => n.value)), q.choices)
        await control.first().check()
      } else if (q.type === 'checkbox') {
        assert.deepEqual(await control.evaluateAll((nodes) => nodes.map((n) => n.value)), q.choices)
        await control.nth(0).check()
        await control.nth(1).check()
      } else if (q.type === 'select') {
        assert.deepEqual(
          await control.locator('option').evaluateAll((nodes) => nodes.map((n) => n.value)),
          ['', ...q.choices],
        )
        await control.selectOption(q.choices[0])
      } else
        await control.fill(
          q.key === 'email'
            ? 'fictif@example.invalid'
            : q.key === 'year'
              ? '2026-2027'
              : 'Réponse fictive',
        )
    }
    const button = form.locator('button[type="submit"]')
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#final-questionnaire-feedback')).toContainText(
      'Démonstration terminée.',
    )
    await page.setViewportSize({ width: 390, height: 900 })
    await page.screenshot({ path: `${output}/${def.slug}-simulation.png`, fullPage: true })
    const closed = await page.goto(`${origin}/suivi/${def.slug}?production=1`)
    assert.equal(closed.status(), 503)
    assert.equal(await page.locator('#final-questionnaire-form').count(), 0)
    const rejected = await render(
      `/api/questionnaires/${def.slug}`,
      true,
      JSON.stringify({ version: def.version, answers: {} }),
    )
    assert.equal(rejected.status, 503)
  }
  assert.equal(networkCalls, 0)
  assert.equal(storageCalls, 0)
  assert.deepEqual(errors, [])
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        measurements,
        sourceQuestions: [20, 15],
        additionalSchoolYear: true,
        productionClosed: true,
        simulations: 2,
        networkCalls,
        storageCalls,
        errors,
      },
      null,
      2,
    ),
  )
  console.log(
    'Deux aperçus compilés : 14 largeurs, choix exacts, simulations clavier, production GET/POST 503, zéro stockage et zéro transport externe.',
  )
} finally {
  await browser.close()
  server.stop(true)
  globalThis.fetch = realFetch
}
