import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium } from '@playwright/test'
import { tables } from '../tests/fixtures/etat-candidatures.js'
import * as compiledPage from '../dist/_worker.js/pages/etat-candidatures.astro.mjs'

// Render the actual compiled page, with synthetic data and a local signing key.
// No credentials, external requests or production bypass are used.
const output = process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-internal-table'
await mkdir(output, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'euneos-fixture.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'fixture-app',
  NOCODB_TOKEN: 'synthetic-token',
}
tables.mbunbu0f1zztce4[0].notes += '\n[EUNEOS_SUIVI_VERIFIE_V1]\n' + JSON.stringify({
  version: 1, checkedAt: '2026-09-22T12:00:00.000Z',
  dateDeReference: tables.mbunbu0f1zztce4[0].date_debut_formation,
  qualification: 'confirmée', referent: 'Référente de démonstration',
  situation: 'Calendrier vérifié dans les échanges de démonstration.',
  organisation: 'Reçu le 21/09/2026', organisationRecue: true,
  formationPrecision: 'Période indicative de démonstration.',
  sources: ['Formulaire et mail de démonstration du 21/09/2026'],
}) + '\n[/EUNEOS_SUIVI_VERIFIE_V1]'
tables.mbunbu0f1zztce4[0].notes += '\n[EUNEOS_LAST_CONTACT_V1]\n' + JSON.stringify({
  version: 1, account: 'charlotte@euneos.fr', checkedAt: '2026-09-22T12:00:00.000Z', status: 'found',
  sentAt: '2026-09-21T10:00:00.000Z', subject: 'Relance de démonstration',
  mailbox: 'Sent', uid: 42, messageId: '<fixture-42@example.test>', via: 'etablissement',
  body: 'DO-NOT-EXPOSE-EMAIL-BODY',
}) + '\n[/EUNEOS_LAST_CONTACT_V1]'
const jwt = await new SignJWT({ email: 'member@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .setSubject('fixture-user')
  .setAudience(env.INTERNAL_ACCESS_AUD)
  .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
  .setExpirationTime('10y')
  .sign(privateKey)
let dataReads = 0
let failData = false
let empty = false
let failTable = null
const RealDate = Date
// Freeze only the compiled page clock; the JWT is locally signed for this test.
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : ['2026-09-22T12:00:00Z']))
  }
  static now() {
    return RealDate.parse('2026-09-22T12:00:00Z')
  }
}
const realFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.hostname === env.INTERNAL_ACCESS_DOMAIN) return Response.json({ keys: [jwk] })
  assert.equal(url.hostname, 'app.nocodb.com', 'No unexpected network call')
  dataReads++
  if (failData) return new Response('unavailable', { status: 503 })
  const table = Object.keys(tables).find((id) => url.pathname.includes(id))
  assert(table, 'Known table only')
  if (table === failTable) return new Response('PRIVATE-UPSTREAM-DETAIL', { status: 503 })
  assert.doesNotMatch(url.searchParams.get('fields'), /email|telephone/)
  const source = empty && table === 'mbunbu0f1zztce4' ? [] : tables[table]
  const offset = Number(url.searchParams.get('offset'))
  const list = source.slice(offset, offset + 1) // server clamps even below requested size
  return Response.json({
    list,
    pageInfo: { isLastPage: offset + list.length >= source.length, totalRows: source.length },
  })
}
const manifestName = (await readdir(new URL('../dist/_worker.js/', import.meta.url))).find(
  (f) => f.startsWith('manifest_') && f.endsWith('.mjs'),
)
const { manifest } = await import(new URL(`../dist/_worker.js/${manifestName}`, import.meta.url))
const app = new App({
  ...manifest,
  sessionConfig: undefined,
  pageMap: new Map([['src/pages/etat-candidatures.astro', async () => compiledPage]]),
})
const render = (environment, token, query = '') =>
  app.render(
    new Request(`https://euneos.fr/etat-candidatures${query}`, {
      headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
    }),
    { locals: { runtime: { env: environment } } },
  )
let response = await render({}, undefined)
assert.equal(response.status, 503)
response = await render(env, undefined)
assert.equal(response.status, 403)
assert.equal(dataReads, 0, 'Unauthorized requests must not read NocoDB')
response = await render(env, jwt)
assert.equal(response.status, 200)
assert.match(response.headers.get('Cache-Control'), /no-store/)
let html = await response.text()
assert.match(html, /Collège de démonstration/)
assert.match(html, /Envoi non documenté/)
assert.doesNotMatch(html, /synthetic-token/)
assert.doesNotMatch(html, /ARCHIVE-NON-COURANTE/)
assert.match(html, /member@example.test/)
assert.match(html, /Relance de démonstration/)
assert.doesNotMatch(html, /webmail\.viaduc\.fr|DO-NOT-EXPOSE-EMAIL-BODY/)
const ownerJwt = await new SignJWT({ email: 'Charlotte@euneos.fr' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setSubject('owner-fixture')
  .setAudience(env.INTERNAL_ACCESS_AUD).setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
  .setExpirationTime('10y').sign(privateKey)
const ownerHtml = await (await render(env, ownerJwt)).text()
assert.match(ownerHtml, /https:\/\/webmail\.viaduc\.fr\/\?/)
assert.match(ownerHtml, /_uid=42/)
assert.doesNotMatch(ownerHtml, /DO-NOT-EXPOSE-EMAIL-BODY/)
assert.match(html, /Participants recensés/)
assert.match(html, /débuts dans les 30 jours · dates cohérentes/)
assert.match(html, /1 dossier aux\s+dates à confirmer/)
assert.doesNotMatch(html, /3 dossiers aux\s+dates à confirmer/)
assert.match(html, /Fiche contact reçue le 21\/09\/2026/)
assert.doesNotMatch(html, /Réponse du 21\/09\/2026/)
assert.match(html, /01\/10\/2026/)
assert.match(html, /01\/03\/2027/)
assert.match(html, /Prévisionnelle/)
assert.match(html, /Camille Affectation/)
assert.match(html, /Dominique Déclaration/)
assert.match(html, /Alex Exemple/)
assert.match(html, /Voir les 2 participants/)
assert.match(html, /1 identité\(s\) à compléter/)
assert.match(html, /12 adulte\(s\) déclaré\(s\) formé\(s\)/)
assert.match(html, /Deux dates contradictoires/)
assert.doesNotMatch(html, /secret@example|DO-NOT-EXPOSE|synthetic-sheet|<img src=x/)
for (const table of ['mzbpzuikti6h3pz', 'mblganql53o34gm']) {
  failTable = table
  const failed = await (await render(env, jwt)).text()
  assert.match(failed, /Données momentanément indisponibles/)
  assert.doesNotMatch(failed, /0<\/strong>|PRIVATE-UPSTREAM-DETAIL|Alex Exemple/)
}
failTable = null
const filtered = {}
for (const query of ['?filtre=bientot', '?filtre=dates', '?filtre=sans-date', '?tri=nom', '?nom=COLLEGE+DEMONSTRATION', '?nom=introuvable'])
  filtered[query] = await (await render(env, jwt, query)).text()
assert.match(filtered['?filtre=bientot'], /1 dossier\(s\) affiché\(s\)/)
assert.match(filtered['?filtre=dates'], /1 dossier\(s\) affiché\(s\)/)
assert.match(filtered['?filtre=sans-date'], /2 dossier\(s\) affiché\(s\)/)
// Legacy labels, recorded decisions and supporting documents remain independent.
const originalDossiers = structuredClone(tables.mbunbu0f1zztce4)
Object.assign(tables.mbunbu0f1zztce4[0], { statut: 'En cours d’analyse' })
Object.assign(tables.mbunbu0f1zztce4[1], { statut: 'Retenu', date_validation: '2026-09-01' })
Object.assign(tables.mbunbu0f1zztce4[3], { statut: 'Candidature acceptée', fiche_contact_recue: true, lettre_interet_signee: true })
const statusPages = {}
for (const code of ['', 'Candidature recue', 'Candidature acceptée', 'Engage', 'Abandonne', 'Refuse', 'historique', 'Retenu']) {
  const query = code ? `?${new URLSearchParams({ statut: code })}` : ''
  statusPages[query] = await (await render(env, jwt, query)).text()
}
tables.mbunbu0f1zztce4.splice(0, tables.mbunbu0f1zztce4.length, ...originalDossiers)
failData = true
const errorHtml = await (await render(env, jwt)).text()
assert.match(errorHtml, /Données momentanément indisponibles/)
assert.doesNotMatch(errorHtml, /0<\/strong>/)
failData = false
empty = true
assert.match(await (await render(env, jwt)).text(), /Aucun dossier actif dans cette cohorte/)
globalThis.fetch = realFetch
globalThis.Date = RealDate

await writeFile(`${output}/tableau-demo.html`, html)
const queryKey = (url) => {
  const params = new URL(url).searchParams
  if (params.get('tri') === 'debut') params.delete('tri')
  if (params.get('statut') === '') params.delete('statut')
  if (params.get('filtre') === 'tous') params.delete('filtre')
  return params.size ? `?${params}` : ''
}
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/status-demo')
      return new Response(statusPages[queryKey(request.url)] ?? statusPages[''], {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    if (path === '/' || path === '/etat-candidatures')
      return new Response(filtered[queryKey(request.url)] ?? html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    if (path.includes('..')) return new Response('not found', { status: 404 })
    return new Response(Bun.file(new URL(`../dist${path}`, import.meta.url)))
  },
})
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE_PATH })
try {
  const tab = await browser.newPage({ reducedMotion: 'reduce' })
  for (const width of [320, 390, 768, 860, 861, 1024, 1440, 1920]) {
    await tab.setViewportSize({ width, height: 1000 })
    await tab.goto(`http://127.0.0.1:${server.port}/`)
    await tab.evaluate(() => document.fonts.ready)
    assert(
      await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Overflow at ${width}`,
    )
    assert(await tab.getByRole('banner').isVisible(), `Shared header at ${width}`)
    const navigation = tab.getByRole('navigation', { name: 'Espace interne' })
    assert(await navigation.isVisible(), `Internal navigation at ${width}`)
    assert.equal(
      await navigation
        .getByRole('link', { name: 'Suivi des établissements' })
        .getAttribute('aria-current'),
      'page',
    )
    assert.equal(
      await navigation.getByRole('link', { name: 'Calendriers de l’équipe' }).getAttribute('href'),
      '/interne',
    )
    assert.equal(
      await navigation.getByRole('link', { name: 'Implantations' }).getAttribute('href'),
      '/interne/implantations',
    )
    assert.equal(
      await navigation.getByRole('link', { name: 'Ressources formateurs' }).getAttribute('href'),
      '/interne/ressources',
    )
    const card = tab
      .locator('.etat__dossier')
      .filter({ has: tab.getByRole('heading', { name: 'Collège de démonstration', exact: true }) })
    assert(await card.getByText('01/10/2026', { exact: true }).isVisible())
    assert(await card.getByText('01/03/2027', { exact: true }).isVisible())
    assert(await card.getByText('Camille Affectation', { exact: true }).isVisible())
    assert(await card.getByText('Dominique Déclaration', { exact: true }).isVisible())
    await card.getByText('Voir les 2 participants', { exact: true }).click()
    assert(await card.getByText('Alex Exemple', { exact: false }).isVisible())
    assert.equal(await tab.evaluate(() => window.injected), undefined)
    assert(
      await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Expanded overflow at ${width}`,
    )
    const uncertain = tab
      .locator('.etat__dossier')
      .filter({
        has: tab.getByRole('heading', { name: 'École des dates à confirmer', exact: true }),
      })
    assert(
      await uncertain
        .getByText('Début déclaré (à confirmer) : 08/10/2026', { exact: true })
        .isVisible(),
    )
    assert(
      await uncertain
        .getByText('Fin déclarée (à confirmer) : 08/04/2026', { exact: true })
        .isVisible(),
    )
    assert.deepEqual(
      (await uncertain.locator('.etat__dates dd').allTextContents())
        .slice(0, 2)
        .map((t) => t.trim()),
      ['Non renseignée', 'Non renseignée'],
    )
    assert.equal(await uncertain.getByText('Début dans les 30 jours', { exact: true }).count(), 0)
    assert(await tab.locator('.etat__progression').evaluate(el => el.open), 'Tableau ouvert dès le chargement')
    assert(await tab.locator('.etat__progression').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('.etat__dossiers')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Tableau avant les fiches détaillées')
    assert(await tab.locator('.etat__progression').evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('#formations')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Préparer les formations après le tableau')
    assert.equal(
      await tab
        .getByRole('link', { name: '1 dossier aux dates à confirmer', exact: true })
        .getAttribute('href'),
      '/etat-candidatures?filtre=dates#formations',
    )
    assert.equal(await tab.locator('thead tr').count(), 2)
    assert.equal(await tab.locator('thead tr').last().locator('th').count(), 8)
    assert.equal(await tab.locator('tbody tr').first().locator('td').count(), 13)
    assert.equal(await tab.locator('thead').getByText('Accusé de réception').count(), 0)
    if (width <= 860) assert.equal(await tab.locator('.etat__mobile-label:visible').count(), 26)
    else assert(await tab.locator('.etat__table-wrap').evaluate(el => el.scrollWidth > el.clientWidth), 'Étapes accessibles par défilement horizontal')
    assert(await tab.locator('.etat__situation').first().innerText(), 'Résumé présent')
    assert(await tab.getByText('Référente de démonstration', { exact: false }).first().isVisible())
    assert(await tab.locator('.etat__sans-date').first().isVisible(), 'Dates absentes explicitement signalées')
    assert.equal(await tab.locator('.etat__sans-affectation').first().evaluate(el => getComputedStyle(el).color), 'rgb(161, 25, 25)', 'Affectation manquante en rouge')
    assert(await tab.locator('.etat__table').getByText('Formulaire reçu', { exact: true }).isVisible(), 'Organisation distingue le formulaire de la mission')
    const opener = tab.locator('.etat__table a.etat__nom').first()
    const initialCards = await tab.locator('.etat__dossiers .etat__dossier').count()
    await opener.click()
    const detail = tab.locator('.suivi-detail[open]')
    assert(await detail.getByRole('heading', { name: 'Point de situation', exact: true }).isVisible())
    assert(await detail.getByRole('heading', { name: 'Sources de vérification' }).isVisible())
    assert(await detail.getByText('Relance de démonstration', { exact: true }).isVisible())
    assert(await detail.getByText('Formulaire et mail de démonstration du 21/09/2026', { exact: true }).isVisible())
    assert(await detail.getByText('Période indicative de démonstration.', { exact: true }).isVisible())
    assert(await detail.getByText('Évaluation scientifique : À confirmer', { exact: true }).isVisible())
    assert(await detail.getByRole('link', { name: 'Formulaires du dossier' }).isVisible())
    assert(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Panneau sans débordement à ${width}`)
    if ([390, 1440].includes(width)) await tab.screenshot({ path: `${output}/detail-${width}.png` })
    await tab.keyboard.press('Escape')
    await tab.waitForFunction(count => document.querySelectorAll('.etat__dossiers .etat__dossier').length === count, initialCards)
    assert.equal(await tab.locator('.suivi-detail[open]').count(), 0)
    assert(await opener.evaluate(el => el === document.activeElement), 'Focus restauré au dossier')
    assert.equal(await tab.locator('.etat__dossiers .etat__dossier').count(), initialCards, 'Fiche restituée après fermeture')
    await tab.locator('[data-suivi-filter]').selectOption('sans-formateur')
    assert.equal(await tab.locator('[data-suivi-row]:visible').count(), 1)
    await tab.locator('[data-suivi-filter]').selectOption('organisation')
    assert.equal(await tab.locator('[data-suivi-row]:visible').count(), 1)
    await tab.locator('[data-suivi-filter]').selectOption('tous')
    await tab.getByRole('button', { name: 'Agrandir le tableau', exact: true }).click()
    assert(await tab.getByRole('dialog').isVisible())
    assert.equal(await tab.locator('.etat__table').count(), 1, 'Une seule table, sans duplication des dossiers')
    assert(await tab.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Vue agrandie sans débordement à ${width}px`)
    if (width <= 860) assert(await tab.locator('.etat__table-wrap').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Tableau mobile sans défilement horizontal à ${width}px`)
    await tab.keyboard.press('Escape')
    assert(!await tab.getByRole('dialog').isVisible())
    assert(await tab.getByRole('button', { name: 'Agrandir le tableau', exact: true }).evaluate(el => document.activeElement === el), 'Retour du focus après Échap')
    await tab.getByRole('button', { name: 'Agrandir le tableau', exact: true }).click()
    if ([390, 1440].includes(width)) await tab.screenshot({ path: `${output}/suivi-agrandi-${width}.png` })
    await tab.getByRole('button', { name: 'Fermer la vue agrandie', exact: true }).click()
    await tab.locator('[data-suivi-inline] .etat__table').waitFor({ state: 'visible' })
    assert.equal(await tab.locator('[data-suivi-inline] .etat__table').count(), 1, 'Tableau restauré dans la page')
    if ([390, 1440].includes(width)) {
      await tab.evaluate(() => window.scrollTo(0, 0))
      await tab.screenshot({ path: `${output}/page-${width}.png` })
      await tab.locator('.etat').screenshot({ path: `${output}/tableau-${width}.png` })
      await card.screenshot({ path: `${output}/dossier-${width}.png` })
      await uncertain.screenshot({ path: `${output}/dates-a-confirmer-${width}.png` })
    }
    await tab.getByRole('combobox', { name: /Afficher/ }).selectOption('bientot')
    await tab.getByRole('button', { name: 'Appliquer', exact: true }).click()
    await tab.waitForURL('**/?statut=&filtre=bientot&tri=debut#formations')
    // The form requests the same GET page; fixture server answers both orderings.
    assert.equal(await tab.locator('.etat__dossier').count(), 1)
    assert(
      await tab
        .locator('.etat__dossier')
        .getByText('Collège de démonstration', { exact: true })
        .isVisible(),
    )
    await tab.getByRole('link', { name: '1 dossier aux dates à confirmer', exact: true }).click()
    await tab.waitForURL('**/etat-candidatures?filtre=dates#formations')
    assert.equal(await tab.locator('.etat__dossier').count(), 1)
    assert(
      await tab
        .locator('.etat__dossier')
        .getByText('École des dates à confirmer', { exact: true })
        .isVisible(),
    )
    console.log(`Tableau compilé : ${width}px OK`)
  }
  await tab.setViewportSize({ width: 390, height: 1000 })
  await tab.goto(`http://127.0.0.1:${server.port}/`)
  await tab.getByRole('searchbox', { name: 'Nom de l’établissement', exact: true }).fill('COLLEGE DEMONSTRATION')
  await tab.getByRole('button', { name: 'Filtrer par nom', exact: true }).click()
  await tab.waitForURL(url => url.searchParams.get('nom') === 'COLLEGE DEMONSTRATION')
  assert.equal(await tab.locator('.etat__table tbody tr').count(), 1, 'Recherche partielle sans accents dans le tableau')
  assert.equal(await tab.locator('.etat__dossier').count(), 1, 'Recherche appliquée aux fiches')
  assert.equal(await tab.locator('#formations input[name="nom"]').inputValue(), 'COLLEGE DEMONSTRATION', 'Recherche conservée dans les filtres de formation')
  await tab.getByRole('searchbox').fill('introuvable')
  await tab.getByRole('button', { name: 'Filtrer par nom', exact: true }).click()
  await tab.waitForURL(url => url.searchParams.get('nom') === 'introuvable')
  assert(await tab.getByText('Aucun établissement ne correspond à cette recherche.').isVisible())
  assert.equal(await tab.locator('.etat__dossier').count(), 0)
  await tab.getByRole('link', { name: 'Effacer la recherche', exact: true }).click()
  await tab.waitForURL(url => !url.searchParams.has('nom'))
  assert.equal(await tab.locator('.etat__table tbody tr').count(), 2, 'Dossiers arrêtés exclus du tableau opérationnel')
  console.log('Recherche par nom sans accents, aucun résultat, effacement et ordre des rubriques : OK')
  await tab.goto(`http://127.0.0.1:${server.port}/status-demo`)
  const statusSelect = tab.getByRole('combobox', { name: 'Statut de candidature' })
  assert.deepEqual(await statusSelect.locator('option').evaluateAll((options) => options.map((o) => [o.value, o.textContent.trim()])), [
    ['', 'Tous les statuts'],
    ['Candidature recue', 'Candidature reçue'],
    ['Candidature acceptée', 'Candidature acceptée'],
    ['Engage', 'Établissement engagé'],
    ['Abandonne', 'Abandon'],
    ['Refuse', 'Refus'],
    ['historique', 'Historiques à qualifier ou non renseignés'],
  ])
  assert.deepEqual(await tab.locator('.etat__dossier .etat__badge').allTextContents(), [
    'Candidature reçue', 'Début dans les 30 jours', 'Candidature acceptée', 'Retenu — historique à qualifier',
  ])
  await tab.screenshot({ path: `${output}/cinq-statuts-390.png`, fullPage: true })
  for (const [code, expected] of [
    ['Candidature recue', 'Candidature reçue'],
    ['Candidature acceptée', 'Candidature acceptée'],
    ['historique', 'Retenu — historique à qualifier'],
    ['Engage', null], ['Abandonne', null], ['Refuse', null],
  ]) {
    await statusSelect.selectOption(code)
    await tab.getByRole('button', { name: 'Appliquer', exact: true }).click()
    await tab.waitForURL((url) => url.searchParams.get('statut') === code)
    assert.equal(await statusSelect.inputValue(), code)
    assert.equal(await tab.locator('.etat__dossier').count(), expected ? 1 : 0)
    if (expected) assert.equal(await tab.locator('.etat__dossier .etat__badge').first().textContent(), expected)
  }
  await tab.goto(`http://127.0.0.1:${server.port}/status-demo?statut=Retenu`)
  assert.equal(await statusSelect.inputValue(), '', 'Legacy raw code is not a new choice')
  assert.equal(await tab.locator('.etat__dossier').count(), 3)
  console.log('Cinq choix, analyse réunie sous Reçue, Retenu historique, acceptation sans promotion : OK')
} finally {
  await browser.close()
  if (!process.env.KEEP_PREVIEW) server.stop()
}
if (process.env.KEEP_PREVIEW) console.log(`Rendu synthétique : http://127.0.0.1:${server.port}/`)
console.log(
  'Accès anonyme refusé avant toute lecture, accès signé, erreur source, état vide et responsive vérifiés.',
)
