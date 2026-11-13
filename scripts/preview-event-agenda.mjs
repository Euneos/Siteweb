import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import { importAgendaEvent, listAgenda, decideAgendaEvent } from '../src/lib/event-agenda.ts'
import { agendaPreviewFacts } from './lib/event-agenda-preview.ts'
// Local preview harness only. Synthetic JWT, in-memory SQL and invented events.
// No production Access bypass is added to the application.
const sql = new Database(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
for (const name of (await readdir(new URL('../migrations/interne/', import.meta.url)))
  .filter((f) => f.endsWith('.sql'))
  .sort())
  sql.exec(await readFile(new URL('../migrations/interne/' + name, import.meta.url), 'utf8'))
const db = {
  prepare(q) {
    return {
      bind(...v) {
        return {
          all: async () => ({ results: sql.query(q).all(...v) }),
          first: async () => sql.query(q).get(...v),
          run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
        }
      },
    }
  },
  batch: async (stmts) => sql.transaction(() => stmts.map((s) => s.execute()))(),
}
const saved = process.env.AGENDA_PREVIEW_STATE
  ? JSON.parse(await readFile(process.env.AGENDA_PREVIEW_STATE, 'utf8')).events
  : null
const facts = saved || agendaPreviewFacts(),
  ids = []
for (const e of facts) ids.push(await importAgendaEvent(db, e))
if (saved) {
  for (const [i, e] of saved.entries())
    await decideAgendaEvent(
      db,
      ids[i],
      { version: 1, status: e.status, attendance: e.attendance },
      'apercu@example.test',
    )
} else {
  await decideAgendaEvent(
    db,
    ids[1],
    { version: 1, status: 'confirmé', attendance: ['Pauline'] },
    'apercu@example.test',
  )
  await decideAgendaEvent(
    db,
    ids[3],
    { version: 1, status: 'rejeté', attendance: [] },
    'apercu@example.test',
  )
  await decideAgendaEvent(
    db,
    ids[5],
    { version: 1, status: 'confirmé', attendance: ['Candice', 'CA'] },
    'apercu@example.test',
  )
}
const { publicKey, privateKey } = await generateKeyPair('RS256'),
  jwk = { ...(await exportJWK(publicKey)), kid: 'agenda-local', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'agenda-local.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'agenda-local',
  INTERNAL_ADMIN_EMAILS: 'apercu@example.test',
  EVENT_AGENDA_PREVIEW: 'true',
  TEAM_WORKSPACE: db,
}
const token = await new SignJWT({ email: 'apercu@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
  .setSubject('local-preview-only')
  .setAudience(env.INTERNAL_ACCESS_AUD)
  .setIssuer('https://' + env.INTERNAL_ACCESS_DOMAIN)
  .setExpirationTime('7d')
  .sign(privateKey)
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, ...rest) => {
  if (String(input) === 'https://' + env.INTERNAL_ACCESS_DOMAIN + '/cdn-cgi/access/certs')
    return Response.json({ keys: [jwk] })
  throw new Error('External network is disabled in the preview fixture')
}
const worker = new URL('../dist/_worker.js/', import.meta.url),
  manifestName = (await readdir(worker)).find(
    (f) => f.startsWith('manifest_') && f.endsWith('.mjs'),
  ),
  { manifest } = await import(new URL(manifestName, worker))
const paths = ['interne/communication/agenda-evenements.astro', 'api/interne/agenda-evenements.ts']
const pageMap = new Map(
  paths.map((p) => [
    'src/pages/' + p,
    () => import(new URL('pages/' + p.replace(/\.(astro|ts)$/, '.astro.mjs'), worker)),
  ]),
)
const app = new App({ ...manifest, sessionConfig: undefined, pageMap }),
  serve = process.argv.includes('--serve')
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: serve ? 4350 : 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/interne/') || url.pathname.startsWith('/api/interne/')) {
      const headers = new Headers(request.headers)
      if (headers.get('X-Agenda-Anonymous') !== 'true')
        headers.set('Cf-Access-Jwt-Assertion', token)
      return app.render(new Request(request, { headers }), { locals: { runtime: { env } } })
    }
    if (/^\/(_astro|fonts)\//.test(url.pathname) || url.pathname === '/favicon.svg')
      return new Response(Bun.file(new URL('../dist' + url.pathname, import.meta.url)))
    return new Response('Aperçu local : ouvrir /interne/communication/agenda-evenements', {
      status: 404,
    })
  },
})
const origin = `http://127.0.0.1:${server.port}`,
  url = origin + '/interne/communication/agenda-evenements'
if (serve) console.log('Aperçu local — événements fictifs : ' + url)
else {
  const output = new URL('../preview-agenda/', import.meta.url)
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' }),
      errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const width of [320, 390, 768, 860, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(url)
      await expect(page.locator('.agenda-month')).toHaveCount(13)
      await expect(page.locator('.agenda-next .agenda-event')).toHaveCount(3)
      await expect(page.locator('.agenda-event--rejected')).toHaveCount(1)
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'horizontal page overflow',
      )
      await page.getByRole('button', { name: 'Occitanie', exact: true }).click()
      await expect(page.locator('#agenda-months')).not.toContainText(
        'Journée d’étude : écrans et adolescence',
      )
      await expect(page.locator('#agenda-next')).not.toContainText(
        'Journée d’étude : écrans et adolescence',
      )
      await page.getByRole('button', { name: 'Tous', exact: true }).click()
      await page.getByRole('button', { name: 'Numérique', exact: true }).click()
      await expect(page.locator('#agenda-months .agenda-event')).toHaveCount(2)
      await page.getByRole('button', { name: 'Numérique', exact: true }).click()
      await page.locator('.agenda-legend [data-tag-value="Présence Euneos"]').click()
      await expect(page.locator('#agenda-months .agenda-event')).toHaveCount(facts.length - 2)
      await page.getByRole('button', { name: 'Effacer les filtres', exact: true }).click()
      // Tags on cards and in the legend filter without changing team decisions.
      await page
        .locator('#agenda-months [data-tag-filter="attendance"][data-tag-value="Pauline"]')
        .click()
      await expect(page.locator('#agenda-months .agenda-event')).toHaveCount(1)
      await expect(page.locator('#agenda-months')).toContainText('Pauline')
      await page.getByRole('button', { name: 'Effacer les filtres', exact: true }).click()
      await expect(page.locator('#agenda-months .agenda-event')).toHaveCount(facts.length)
      await page.locator('.agenda-legend [data-tag-value="gratuit"]').click()
      for (const card of await page.locator('#agenda-months .agenda-event').all())
        await expect(card.locator('[data-tag-value="gratuit"]')).toHaveCount(1)
      await page.locator('.agenda-legend [data-tag-value="confirmé"]').click()
      await expect(page.locator('#agenda-next .agenda-event')).toHaveCount(0)
      for (const card of await page.locator('#agenda-months .agenda-event').all())
        await expect(card.locator('[data-tag-value="confirmé"]')).toHaveCount(1)
      await page.locator('.agenda-legend [data-tag-value="gratuit"]').click()
      await expect(page.locator('#agenda-months .agenda-event')).toHaveCount(2)
      await page.getByRole('button', { name: 'Retirer le filtre : confirmé', exact: true }).click()
      await expect(page.locator('#agenda-months .agenda-event')).toHaveCount(facts.length)
      await page.locator('.agenda-legend [data-tag-value="en ligne"]').focus()
      await page.keyboard.press('Enter')
      for (const card of await page.locator('#agenda-months .agenda-event').all())
        await expect(card.locator('[data-tag-value="en ligne"]')).toHaveCount(1)
      await page.getByRole('button', { name: 'Effacer les filtres', exact: true }).click()
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: new URL(`agenda-${width}.png`, output).pathname,
          fullPage: true,
        })
    }
    await page.setViewportSize({ width: 1440, height: 1250 })
    await page.screenshot({ path: new URL('agenda-apercu.png', output).pathname, fullPage: false })
    await page
      .getByRole('button', {
        name: 'Voir la fiche : Rencontre santé mentale des jeunes',
        exact: true,
      })
      .first()
      .click()
    await expect(page.locator('#agenda-dialog')).toBeVisible()
    await page.locator('#agenda-status').selectOption('confirmé')
    await page.getByLabel('Charlotte', { exact: true }).check()
    await page.getByRole('button', { name: 'Enregistrer la décision', exact: true }).click()
    await expect(page.locator('#agenda-dialog')).not.toBeVisible()
    await expect(page.locator('#agenda-next')).not.toContainText(
      'Rencontre santé mentale des jeunes',
    )
    await page.reload()
    await expect(page.locator('#agenda-months')).toContainText('Charlotte')
    // Newsletter refresh preserves the actual decision and its presence, not just display state.
    await importAgendaEvent(db, {
      ...facts[0],
      interest: 'Intérêt mis à jour sans toucher à la décision',
      sources: ['Deuxième exemple fictif de newsletter'],
    })
    await page.reload()
    await expect(page.locator('#agenda-months')).toContainText('Charlotte')
    assert.equal((await listAgenda(db)).find((e) => e.id === ids[0]).status, 'confirmé')
    await page.setViewportSize({ width: 390, height: 1000 })
    const manualTitle = 'Événement manuel de recette ' + 'A'.repeat(240)
    await page.getByRole('button', { name: 'Ajouter un événement', exact: true }).click()
    await page.locator('#manual-title').fill(manualTitle)
    await page.locator('#manual-starts_on').fill(facts[6].starts_on)
    await page.locator('#manual-organizer').fill('Organisateur fictif')
    await page.locator('#manual-modality').selectOption('en ligne')
    await page.locator('#manual-interest').fill('Exemple de saisie manuelle pour vérifier la page.')
    await page.locator('#agenda-add-dialog').getByLabel('éducation', { exact: true }).check()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({
      path: new URL('agenda-ajout-390.png', output).pathname,
      fullPage: false,
    })
    await page.getByRole('button', { name: 'Ajouter l’événement', exact: true }).click()
    await expect(page.locator('#agenda-add-dialog')).not.toBeVisible()
    await expect(page.locator('#agenda-months')).toContainText(manualTitle)
    await page.getByRole('button', { name: `Voir la fiche : ${manualTitle}`, exact: true }).click()
    await page.getByRole('button', { name: 'Supprimer cet événement', exact: true }).click()
    await page.getByRole('button', { name: 'Supprimer l’événement', exact: true }).click()
    await expect(page.locator('#agenda-remove-dialog')).not.toBeVisible()
    await expect(page.locator('#agenda-months')).not.toContainText(manualTitle)
    const manual = (await listAgenda(db, true)).find((e) => e.title === manualTitle)
    await importAgendaEvent(db, { ...manual, sources: ['Autre annonce fictive du même événement'] })
    await page.reload()
    await expect(page.locator('#agenda-months')).not.toContainText(manualTitle)
    await page.getByRole('button', { name: 'Corbeille (1)', exact: true }).click()
    assert(
      await page
        .locator('#agenda-trash-dialog')
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      'Long event title overflows the trash dialog',
    )
    await page.getByRole('button', { name: 'Restaurer', exact: true }).click()
    await expect(page.locator('#agenda-trash-list')).toContainText('La corbeille est vide.')
    await page.locator('#agenda-trash-close').click()
    await expect(page.locator('#agenda-months')).toContainText(manualTitle)
    await page.getByRole('button', { name: 'Contrôle à la demande', exact: true }).click()
    await expect(page.locator('#agenda-help-dialog')).toContainText('à tout moment')
    await page.keyboard.press('Escape')
    const anon = await originalFetch(origin + '/api/interne/agenda-evenements', {
      headers: { 'X-Agenda-Anonymous': 'true' },
    })
    assert.equal(anon.status, 403)
    const csrf = await originalFetch(origin + '/api/interne/agenda-evenements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' },
      body: '{}',
    })
    assert.equal(csrf.status, 403)
    assert.deepEqual(errors, [])
    await writeFile(
      new URL('checks.json', output),
      JSON.stringify(
        {
          widths: [320, 390, 768, 860, 1024, 1440],
          months: 13,
          filters: true,
          decisions: true,
          preservedAfterImport: true,
          accessControls: true,
          manualAdd: true,
          trashAndRestore: true,
          catchUp: true,
          jsErrors: errors,
        },
        null,
        2,
      ),
    )
    console.log(
      'Agenda : 6 largeurs, 13 mois, filtres, décisions persistantes, import sans écrasement et accès privé validés.',
    )
  } finally {
    await browser.close()
    server.stop()
    sql.close()
    globalThis.fetch = originalFetch
  }
}
