import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { NC } from '../src/lib/nocodb'
import { chromium, expect } from '@playwright/test'
import {
  finalFixtureRuntime,
  finalFixtureAnswers,
} from '../tests/fixtures/final-questionnaire-runtime'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { finalQuestionnaireDefinitions as definitions } from '../src/lib/final-questionnaire-definition'

// Real compiled production routes with synthetic SQL/NocoDB. No external fallback.
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
for (const [key, path] of [
  ['src/pages/interne/formulaires.astro', 'pages/interne/formulaires.astro.mjs'],
  ['src/pages/api/interne/formulaires.ts', 'pages/api/interne/formulaires.astro.mjs'],
]) {
  const module = await import(new URL('../dist/_worker.js/' + path, import.meta.url))
  pageMap.set(key, async () => module)
}
const app = new App({ ...manifest, sessionConfig: undefined, pageMap })
const realFetch = globalThis.fetch
const rt = finalFixtureRuntime()
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'final-questionnaire-qa', alg: 'RS256' }
const issuer = 'https://final-questionnaire-qa.cloudflareaccess.com'
const jwt = await new SignJWT({ email: 'team@example.invalid' })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setIssuer(issuer)
  .setAudience('team')
  .setSubject('fixture')
  .setExpirationTime('30m')
  .sign(privateKey)
Object.assign(rt.env, {
  TEAM_WORKSPACE: {},
  INTERNAL_ACCESS_DOMAIN: new URL(issuer).hostname,
  INTERNAL_ACCESS_AUD: 'team',
})
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input))
  if (url.href === issuer + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] })
  // Existing catalogue also reads the active campaign through the legacy adapter.
  const table = url.pathname.split('/')[4]
  if ([NC.tables.etablissements, NC.tables.participations, NC.tables.cohortes].includes(table)) {
    assert.equal(url.origin, 'https://app.nocodb.com')
    assert.equal(init?.method ?? 'GET', 'GET')
    return Response.json({
      list:
        table === NC.tables.cohortes
          ? [{ Id: 2, active: true, annee_debut: 2026, annee_fin: 2027 }]
          : [],
      pageInfo: { isLastPage: true },
    })
  }
  return rt.fetch(input, init)
}
const render = (path, { body, preview = false, authenticated = false } = {}) => {
  const base = preview ? 'http://localhost' : 'https://euneos.fr'
  return app.render(
    new Request(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { Origin: base, 'Content-Type': 'application/json' } : {}),
        ...(authenticated ? { 'Cf-Access-Jwt-Assertion': jwt } : {}),
      },
      ...(body ? { body } : {}),
    }),
    { locals: rt.locals() },
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
      return render(url.pathname, {
        preview: url.searchParams.has('preview'),
        body: req.method === 'POST' ? await req.text() : undefined,
      })
    if (['/interne/formulaires', '/api/interne/formulaires'].includes(url.pathname))
      return render(url.pathname, { authenticated: true })
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
  await page.addInitScript(() => sessionStorage.setItem('euneos-study-dismissed', '1'))
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [index, def] of definitions.entries()) {
    for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const response = await page.goto(`${origin}/suivi/${def.slug}`)
      assert.equal(response.status(), 200)
      assert.match(response.headers()['x-robots-tag'], /noindex/)
      await expect(page.locator('main')).not.toContainText('Aperçu de démonstration.')
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
            ? String(finalFixtureAnswers(index).email)
            : q.key === 'year'
              ? '2026-2027'
              : q.key === 'school'
                ? 'École fictive'
                : 'Réponse fictive',
        )
    }
    if (index === 0) rt.state.behavior = 'readback-lost'
    const button = form.locator('button[type="submit"]')
    await button.focus()
    await page.keyboard.press('Enter')
    if (index === 0) {
      await expect(page.locator('#final-questionnaire-feedback')).toContainText(
        'en cours de vérification',
      )
      rt.state.blocked = false
      rt.state.behavior = ''
      rt.sql.exec(
        "UPDATE public_final_questionnaire_projections SET lease_until=1 WHERE state='writing'",
      )
      await button.click()
    }
    await expect(page.locator('#final-questionnaire-feedback')).toContainText(
      'Votre réponse a bien été enregistrée.',
    )
    await page.setViewportSize({ width: 390, height: 900 })
    await page.screenshot({ path: `${output}/${def.slug}-confirmation.png`, fullPage: true })
    assert.equal(rt.state.writes.length, index + 1)
  }
  const unresolved = finalFixtureAnswers(0)
  unresolved.email = 'absent@example.invalid'
  const pending = await render('/api/questionnaires/evaluation-formation', {
    body: JSON.stringify({ version: definitions[0].version, answers: unresolved }),
  })
  assert.equal(pending.status, 200)
  assert.equal(rt.projection().state, 'review')
  const conflict = finalFixtureAnswers(1)
  conflict.q14 = '10'
  const partial = await render('/api/questionnaires/bilan-etablissement', {
    body: JSON.stringify({ version: definitions[1].version, answers: conflict }),
  })
  assert.equal(partial.status, 200)
  assert.equal(rt.projection().code, 'receipt_verified_partial')
  assert.equal(rt.state.dossiers[0].score_nps, 0)
  await page.goto(origin + '/interne/formulaires')
  await expect(page.locator('#submissions-list')).toContainText('Réception métier vérifiée')
  await expect(page.locator('#submissions-list')).toContainText('Réception métier en attente')
  await expect(page.locator('#submissions-list')).toContainText('score NPS existant')
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${output}/journal-${width}.png`, fullPage: true })
  }
  assert.equal((await render('/api/interne/formulaires')).status, 403)
  const sourcePosts = rt.state.rows.length
  for (const def of definitions) {
    const preview = await render('/suivi/' + def.slug, { preview: true })
    assert.match(await preview.text(), /Aperçu de démonstration/)
    rt.state.schemaMissing = true
    assert.equal((await render('/suivi/' + def.slug)).status, 503)
    const body = JSON.stringify({
      version: def.version,
      answers: finalFixtureAnswers(def.slug === 'evaluation-formation' ? 0 : 1),
    })
    assert.equal((await render('/api/questionnaires/' + def.slug, { body })).status, 503)
    rt.state.schemaMissing = false
  }
  assert.equal(rt.state.rows.length, sourcePosts)
  assert.equal(rt.state.writes.length, 2)
  assert.equal(
    rt.state.calls.filter((c) => c.method === 'PATCH' && c.url.includes('fictionaljournal')).length,
    0,
  )
  assert.deepEqual(errors, [])
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        measurements,
        sourceQuestions: [20, 15],
        additionalSchoolYear: true,
        journalRows: rt.state.rows.length,
        businessWrites: 2,
        verified: 2,
        pending: 1,
        partial: 1,
        replayNoDuplicate: true,
        schemaGate: true,
        emails: 0,
        errors,
      },
      null,
      2,
    ),
  )
  console.log(
    'Deux parcours compilés : 14 largeurs, source -> réception métier relue -> catalogue privé, pending et NPS préservé, reprise sans double PATCH, zéro email.',
  )
} finally {
  await browser.close()
  server.stop(true)
  rt.close()
  globalThis.fetch = realFetch
}
