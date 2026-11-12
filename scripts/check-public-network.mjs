// Compiled, local-only public map checks. All records and credentials are synthetic.
import assert from 'node:assert/strict'
import { readdir, mkdir } from 'node:fs/promises'
import { App } from 'astro/app'
import { chromium, expect } from '@playwright/test'
import { NC } from '../src/lib/nocodb'

const cohorts = [{Id:1,nom:'2025-2026',annee_debut:2025,annee_fin:2026},{Id:2,nom:'2026-2027',annee_debut:2026,annee_fin:2027,active:true}]
const schools = [
  {Id:1,nom:"Sainte Thérèse de l'Enfant Jésus",ville:'Toulouse',cp:'31500'},
  {Id:2,nom:'CLG CHARLOUN RIEU',ville:'Saint-Martin-de-Crau',cp:'13310'},
  {Id:3,nom:'collège paul emile victor',ville:'Vidauban',cp:'83550'},
  {Id:4,nom:'Candidature non validée',ville:'Metz',cp:'57000'},
  {Id:5,nom:'Abandon à exclure',ville:'Tours',cp:'37000'},
  {Id:6,nom:'Collège La Viadène',ville:'Saint-Amans-des-Cots',cp:'12460'},
]
const participations = schools.map((s,i) => ({Id:s.Id,etablissements_id:s.Id,cohortes_id:i===2?1:2,code:`DOS-${900+i}`,statut:i===3?'Candidature reçue':i===4?'Abandon':i===5?'Candidature acceptée':'Établissement engagé',statut_formation:i===1?'En cours':i===2||i===4?'Terminé':'À préciser'}))
const people = [{Id:1,nom:'SECRET_FORMED',prenom:'PRIVATE',ville:'Toulouse',cp:'31000'},{Id:2,nom:'SECRET_TRAINEE',ville:'Orsay',cp:'91400'},{Id:3,nom:'SECRET_UNLOCATED',ville:'Commune inconnue',cp:''},{Id:4,nom:'SECRET_REJECTED',ville:'Paris',cp:'75001'}]
const paths = [{Id:1,formateurs_id:1,statut:'Formateur validé'},{Id:2,formateurs_id:1,cohortes_id:2,statut:'En cours de formation'},{Id:3,formateurs_id:2,statut:'En cours de formation'},{Id:4,formateurs_id:3,statut:'En cours de formation'},{Id:5,formateurs_id:4,statut:'Refuse'}]
const tables = {[NC.tables.cohortes]:cohorts,[NC.tables.etablissements]:schools,[NC.tables.participations]:participations,[NC.tables.formateurs]:people,[NC.tables.engagements]:paths}
const env = {NOCODB_TOKEN:'synthetic-public-map-token'}
let fail = false, reads = 0
const originalFetch = globalThis.fetch
// The production readers, including pagination and residence overrides, run unchanged.
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input))
  assert.equal(url.hostname,'app.nocodb.com')
  assert.equal(options?.method,'GET')
  reads++
  if (fail) return new Response('Unavailable',{status:503})
  const rows = tables[url.pathname.split('/')[4]]
  assert(rows, 'Unexpected private source')
  const offset = Number(url.searchParams.get('offset'))
  return Response.json({list:rows.slice(offset,offset+2),pageInfo:{isLastPage:offset+2>=rows.length}})
}
const worker = new URL('../dist/_worker.js/',import.meta.url)
const manifestName = (await readdir(worker)).find(n=>n.startsWith('manifest_')&&n.endsWith('.mjs'))
const {manifest} = await import(new URL(manifestName,worker))
const app = new App({...manifest,sessionConfig:undefined,pageMap:new Map([['src/pages/oùnoustrouver.astro',()=>import(new URL('pages/oùnoustrouver.astro.mjs',worker))]])})
const render = request => app.render(request,{locals:{runtime:{env}}})
const request = () => new Request('http://localhost/o%C3%B9noustrouver')
function payload(html) {
  const match = html.match(/<script[^>]*id="trouver-data"[^>]*>([\s\S]*?)<\/script>/)
  assert(match,'Public map data absent')
  return JSON.parse(match[1])
}
const output = process.env.CHECK_SCREENSHOTS
let server, browser
try {
  const response = await render(request())
  assert.equal(response.status,200)
  assert.match(response.headers.get('cache-control'),/no-store/)
  let html = await response.text(), data = payload(html)
  assert.equal(data.locations.length,4)
  assert.equal(data.trainerLocations.length,3)
  assert.equal(data.trainerLocations.filter(t=>t.trainingState==='en_formation').length,2)
  assert.equal(data.locations.find(s=>s.name==='Collège La Viadène').formations[0].state,'en_cours')
  assert(data.locations.some(s=>s.name==='Collège Charloun Rieu'))
  assert(data.locations.some(s=>s.name==='Collège Paul Emile Victor'))
  assert(!/DOS-|SECRET_|PRIVATE|synthetic-public-map-token|Aperçu local/.test(html))
  // A change in the internal database must be reflected on the very next request.
  const before = reads
  participations[3].statut='Candidature acceptée'
  paths[2].statut='Formateur validé'
  data=payload(await (await render(request())).text())
  assert(reads>before,'The page reused stale data')
  assert.equal(data.locations.length,5)
  assert.equal(data.trainerLocations.filter(t=>t.trainingState==='en_formation').length,1)
  participations[3].statut='Candidature reçue'; paths[2].statut='En cours de formation'
  fail=true
  const unavailable = await render(request())
  assert.equal(unavailable.status,503)
  assert.equal(payload(await unavailable.text()),null)
  fail=false
  server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    const path=decodeURI(new URL(request.url).pathname)
    if(path.startsWith('/_astro/')||path.startsWith('/maps/')||path.startsWith('/fonts/')) return new Response(Bun.file(`dist${path}`))
    return render(request)
  }})
  browser=await chromium.launch({headless:true})
  const page=await browser.newPage()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.port}/o%C3%B9noustrouver`)
  const popup=page.getByRole('button',{name:'Fermer la fenêtre',exact:true})
  if(await popup.isVisible()) await popup.click()
  await expect(page.locator('#ca-markers button')).not.toHaveCount(0)
  await expect(page.locator('#ca-map-schools li, #ct-map-schools li')).toHaveCount(0)
  await page.getByRole('button',{name:'Occitanie : 2 établissement(s)',exact:true}).click()
  await expect(page.locator('#ca-map-schools')).toContainText("Sainte Thérèse de l'Enfant Jésus")
  await expect(page.locator('#ca-map-schools')).toContainText('Formation en cours')
  await expect(page.locator('#ca-map-schools strong').first()).toBeVisible()
  await page.locator('#ca-map-all').click()
  await expect(page.locator('#ca-map-schools li')).toHaveCount(0)
  await page.getByRole('button',{name:'Île-de-France : 1 formateur(s)',exact:true}).click()
  await expect(page.locator('#ct-map-schools')).toContainText('en cours de formation')
  await expect(page.locator('#ct-map-schools')).not.toContainText('validé')
  if(output) await mkdir(output,{recursive:true})
  const widths = [...new Set([...Array.from({length:141},(_,i)=>320+i*16),390,599,600,601,859,860,861,1099,1100,1101,3440,3840])].sort((a,b)=>a-b)
  for(const width of widths) {
    await page.setViewportSize({width,height:1000})
    await page.evaluate(()=>document.fonts.ready)
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}`)
    for(const prefix of ['ca','ct']) {
      const names=await page.locator(`#${prefix}-markers button`).evaluateAll(bs=>bs.map(b=>b.getAttribute('aria-label').split(' : ')[0]))
      assert.equal(names.length,new Set(names).size,`Repeated region at ${width}`)
    }
    if(output&&[390,1440].includes(width)) await page.screenshot({path:`${output}/public-network-${width}.png`,fullPage:true})
  }
  assert.deepEqual(errors,[])
  console.log('Public map: live refresh, no cache, privacy, filtering, regional grouping and responsive layout verified.')
} finally {await browser?.close();server?.stop(true);globalThis.fetch=originalFetch}
