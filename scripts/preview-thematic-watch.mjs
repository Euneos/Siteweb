// Local-only harness: generated Access key, SQLite and seven researched draft cards.
// No bypass or identity fixture is included in deployed application code.
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import { saveWatch, listWatch } from '../src/lib/thematic-watch.ts'
const serve = process.argv.includes('--serve'),
  output = new URL('../preview-veille/', import.meta.url)
await mkdir(output, { recursive: true })
const sql = new Database(
  serve ? new URL('../preview-veille/local.sqlite', import.meta.url).pathname : ':memory:',
)
sql.exec('PRAGMA foreign_keys=ON')
let legacy = { sheets: [], rows: [] }
try {
  legacy = JSON.parse(
    await readFile(new URL('../preview-veille/legacy.json', import.meta.url), 'utf8'),
  )
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
if (!sql.query("SELECT name FROM sqlite_master WHERE name='thematic_watch'").get())
  for (const f of (await readdir(new URL('../migrations/interne/', import.meta.url)))
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0030'))
    .sort())
    sql.exec(await readFile(new URL('../migrations/interne/' + f, import.meta.url), 'utf8'))
if (!sql.query("SELECT name FROM sqlite_master WHERE name='thematic_watch_legacy'").get()) {
  for (const row of [
    ...legacy.sheets.map((r) => ({ ...r, __table: 'communication_sheets' })),
    ...legacy.rows.map((r) => ({ ...r, __table: 'communication_rows' })),
  ]) {
    const { __table, ...data } = row,
      keys = Object.keys(data)
    sql
      .query(
        `INSERT OR IGNORE INTO ${__table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
      )
      .run(...Object.values(data))
  }
  sql.exec(
    await readFile(
      new URL('../migrations/interne/0030_merge_legacy_watch.sql', import.meta.url),
      'utf8',
    ),
  )
}
const initialCount = 7 + legacy.rows.filter((r) => !r.deleted_at).length
const db = {
  prepare(q) {
    return {
      bind(...v) {
        return {
          all: async () => ({ results: sql.query(q).all(...v) }),
          first: async () => sql.query(q).get(...v),
          run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
          execute: () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
        }
      },
    }
  },
  batch: async (s) => sql.transaction(() => s.map((x) => x.execute()))(),
}
const selection = JSON.parse(
  await readFile(new URL('../drafts/veille-2026-11-09.json', import.meta.url), 'utf8'),
)
for (const item of selection.items)
  await saveWatch(db, { ...item, week: selection.week }, 'Agent · proposition', {
    automated: true,
    provenance: item.provenance,
    today: selection.checked_on,
  })
sql
  .query('INSERT OR IGNORE INTO thematic_watch_runs(id,week,coverage) VALUES(?,?,?)')
  .run('draft-2026-11-13', selection.week, selection.coverage)
for (const item of selection.items)
  sql
    .query(
      "UPDATE thematic_watch SET payload=json_set(payload,'$.format',?) WHERE protected=0 AND json_extract(payload,'$.title')=? AND json_extract(payload,'$.format') IS NULL",
    )
    .run(item.format, item.title)
const { publicKey, privateKey } = await generateKeyPair('RS256'),
  jwk = { ...(await exportJWK(publicKey)), kid: 'veille-local', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'veille-local.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'veille-local',
  INTERNAL_ADMIN_EMAILS: 'apercu@example.test',
  TEAM_WORKSPACE: db,
}
const token = await new SignJWT({ email: 'apercu@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setSubject('local-preview')
  .setAudience(env.INTERNAL_ACCESS_AUD)
  .setIssuer('https://' + env.INTERNAL_ACCESS_DOMAIN)
  .setExpirationTime('7d')
  .sign(privateKey)
globalThis.fetch = async (input) => {
  if (String(input) === 'https://' + env.INTERNAL_ACCESS_DOMAIN + '/cdn-cgi/access/certs')
    return Response.json({ keys: [jwk] })
  throw new Error('External requests disabled in local harness')
}
const worker = new URL('../dist/_worker.js/', import.meta.url),
  name = (await readdir(worker)).find((f) => f.startsWith('manifest_') && f.endsWith('.mjs')),
  { manifest } = await import(new URL(name, worker))
const paths = [
  'interne/communication/veille.astro',
  'api/interne/veille.ts',
  'interne/communication/agenda-evenements.astro',
  'api/interne/agenda-evenements.ts',
  'interne/communication.astro',
  'interne/communication/[table].astro',
]
const pageMap = new Map(
  paths.map((p) => [
    'src/pages/' + p,
    () => import(new URL('pages/' + p.replace(/\.(astro|ts)$/, '.astro.mjs'), worker)),
  ]),
)
const app = new App({ ...manifest, sessionConfig: undefined, pageMap })
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: serve ? 4351 : 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/interne') || url.pathname.startsWith('/api/interne')) {
      const headers = new Headers(request.headers)
      if (headers.get('X-Preview-Anonymous') !== 'true')
        headers.set('Cf-Access-Jwt-Assertion', token)
      return app.render(new Request(request, { headers }), { locals: { runtime: { env } } })
    }
    if (/^\/(_astro|fonts)\//.test(url.pathname) || url.pathname === '/favicon.svg')
      return new Response(Bun.file(new URL('../dist' + url.pathname, import.meta.url)))
    return new Response('Ouvrir /interne/communication/veille', { status: 404 })
  },
})
const origin = `http://127.0.0.1:${server.port}`,
  url = origin + '/interne/communication/veille'
if (serve) console.log('Brouillon local : ' + url)
else {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' }),
      errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const width of [320, 390, 768, 860, 861, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(url)
      await expect(page.locator('.vw-card')).toHaveCount(initialCount)
      await expect(page.locator('#vw-todo')).not.toContainText('ancien tableau')
      await expect(page.locator('#vw-todo')).not.toContainText('Pourquoi cette semaine :')
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Horizontal overflow ' + width,
      )
      await page.locator('[data-filter="themes"][data-value="CPS"]').click()
      await expect(page.locator('.vw-card')).toHaveCount(3)
      await page.getByRole('button', { name: 'Effacer les filtres' }).click()
      await page.locator('[data-filter="usages"][data-value="Événement"]').focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('.vw-card')).toHaveCount(1)
      await page.getByRole('button', { name: 'Effacer les filtres' }).click()
      await page.getByRole('button', { name: '+ Ajouter une fiche', exact: true }).click()
      await expect(page.locator('#vw-editor')).toBeVisible()
      await expect(page.locator('[name=format]')).toBeVisible()
      for (const name of ['connection', 'deadline', 'quotes', 'relevance', 'read_note'])
        await expect(page.locator(`[name=${name}]`)).toHaveCount(0)
      await expect(page.getByText('Précision de date (si inconnue)', { exact: true })).toHaveCount(
        0,
      )
      await expect(
        page.getByText('Pertinence pour Euneos · 1 ou 2 phrases', { exact: true }),
      ).toBeVisible()
      assert(
        await page.locator('#vw-editor').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        'Dialog overflow ' + width,
      )
      await page.keyboard.press('Escape')
      await expect(page.locator('#vw-editor')).not.toBeVisible()
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: new URL(`veille-${width}.png`, output).pathname,
          fullPage: true,
        })
      if ([390, 1440].includes(width))
        await page.screenshot({ path: new URL(`apercu-${width}.png`, output).pathname })
    }
    const themeColors = await page
      .locator('[data-filter="themes"][data-topic]')
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((n) => [n.dataset.topic, getComputedStyle(n).backgroundColor]),
        ),
      )
    expect(themeColors['éducation']).toBe('rgb(197, 212, 255)')
    const agendaPage = await browser.newPage()
    await agendaPage.goto(origin + '/interne/communication/agenda-evenements')
    await expect(agendaPage.locator('[data-pillar="éducation"]')).toBeVisible()
    await expect(agendaPage.locator('[data-pillar]')).toHaveCount(4)
    await expect(agendaPage.locator('.agenda-legend [data-tag-filter="pillar"]')).toHaveCount(0)
    await agendaPage.locator('[data-pillar="éducation"]').click()
    await expect(agendaPage.locator('[data-pillar="éducation"]')).toHaveAttribute('aria-pressed','true')
    await agendaPage.getByRole('button',{name:'Retirer le filtre : éducation',exact:true}).click()
    await expect(agendaPage.locator('[data-pillar="éducation"]')).toHaveAttribute('aria-pressed','false')
    for (const theme of ['santé mentale', 'CPS', 'numérique', 'éducation']) {
      const color = await agendaPage
        .locator(`[data-pillar="${theme}"]`)
        .evaluate((n) => getComputedStyle(n).backgroundColor)
      expect(color).toBe(themeColors[theme])
    }
    await agendaPage.close()
    await page.getByRole('button', { name: '+ Ajouter une fiche', exact: true }).click()
    for (const [k, v] of Object.entries({
      title: 'Fiche manuelle de recette',
      link: 'https://example.test/manual',
      source: 'Source test',
      summary: 'Résumé de recette.',
      for_euneos: 'Vérifier la saisie équipe.',
    }))
      await page.locator(`[name="${k}"]`).fill(v)
    await page.locator('[name=theme][value="émotions"]').check()
    await page.locator('[name=format]').selectOption('Podcast')
    await page.locator('#vw-usage-add').selectOption('Encart newsletter')
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page.locator('#vw-editor')).not.toBeVisible()
    await page.locator('#vw-week').selectOption('all')
    await expect(page.locator('.vw-card')).toHaveCount(initialCount + 1)
    const manual = page.locator('.vw-card').filter({ hasText: 'Fiche manuelle de recette' })
    await expect(manual).toContainText('ajout manuel · apercu@example.test')
    await expect(manual).toContainText('Podcast')
    await manual.getByRole('button', { name: 'Modifier', exact: true }).click()
    await page.locator('[name=summary]').fill('Résumé corrigé.')
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(manual).toContainText('Résumé corrigé.')
    for (const status of ['brouillon', 'fait']) {
      await manual.locator('.vw-usage:not(.vw-usage--add)').click()
      await expect(manual.locator('.vw-usage').first()).toContainText(status)
    }
    await expect(page.locator('#vw-used')).toContainText('Fiche manuelle de recette')
    // Removing an usage returns it to À traiter, including a zero-usage card.
    await manual.getByRole('button', { name: 'Modifier', exact: true }).click()
    await page.getByRole('button', { name: 'Retirer cet usage', exact: true }).click()
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click()
    await expect(page.locator('#vw-todo')).toContainText('Fiche manuelle de recette')
    await manual.getByRole('button', { name: 'Ajouter à l’agenda', exact: true }).click()
    await expect(page.locator('#vw-event-details')).toHaveAttribute('open', '')
    await expect(page.locator('[name=event_title]')).toHaveValue('Fiche manuelle de recette')
    await page.locator('[name=event_organizer]').fill('Organisateur fictif · recette locale')
    await page
      .locator('[name=event_starts_on]')
      .fill(new Date(Date.parse(selection.checked_on) + 7 * 86400000).toISOString().slice(0, 10))
    await page.locator('[name=theme][value="CPS"]').check()
    await page
      .getByRole('button', { name: 'Ajouter à l’agenda et enregistrer', exact: true })
      .click()
    await expect(page.locator('#vw-editor')).not.toBeVisible()
    await expect(
      manual.getByRole('link', { name: 'Voir dans l’agenda →', exact: true }),
    ).toBeVisible()
    page.once('dialog', (d) => d.dismiss())
    await manual.getByRole('button', { name: 'Supprimer', exact: true }).click()
    await expect(manual).toHaveCount(1)
    page.once('dialog', (d) => d.accept())
    await manual.getByRole('button', { name: 'Supprimer', exact: true }).click()
    await expect(manual).toHaveCount(0)
    await page.getByRole('button', { name: 'Lancer une recherche' }).click()
    await expect(page.locator('#vw-research-dialog')).toContainText(
      'ne lance aucune recherche en arrière-plan',
    )
    await page.keyboard.press('Escape')
    const anon = await page.request.get(url, { headers: { 'X-Preview-Anonymous': 'true' } })
    expect(anon.status()).toBe(403)
    const bad = await page.request.post(origin + '/api/interne/veille', {
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      data: {},
    })
    expect(bad.status()).toBe(403)
    expect(
      (await page.request.get(origin + '/api/interne/veille')).headers()['cache-control'],
    ).toContain('no-store')
    const agenda = await page.request.get(origin + '/api/interne/agenda-evenements')
    expect((await agenda.json()).events).toHaveLength(2)
    await expect(
      page.getByRole('link', { name: 'Consulter l’ancien tableau de veille' }),
    ).toHaveCount(0)
    if (legacy.rows.length)
      await expect(page.locator('.vw-card').filter({ hasText: 'Lâche ton tel' })).toHaveCount(1)
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(
      'Veille : 7 largeurs, filtres/clavier, ajout/modification/suppression, usages, agenda, accès et CSRF : OK',
    )
  } finally {
    await browser.close()
    server.stop()
    sql.close()
  }
}
