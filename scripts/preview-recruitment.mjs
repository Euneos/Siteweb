// Loopback-only compiled-page fixture. Never connects to production or bypasses deployed Access.
// RECRUITMENT_MANIFEST=/private/contacts.json RECRUITMENT_OUTPUT=/private/screens bun scripts/preview-recruitment.mjs [--serve]
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import { recruitmentFields, importRecruitment, listRecruitment } from '../src/lib/recruitment.ts'
const sql = new Database(':memory:')
sql.exec(await readFile(new URL('../migrations/interne/0031_recruitment_campaign.sql',import.meta.url),'utf8'))
const db = {
  prepare(q) { return { bind(...v) { return {
    all: async () => ({ results: sql.query(q).all(...v) }),
    first: async () => sql.query(q).get(...v),
    run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
  } } } },
}
const rows = process.env.RECRUITMENT_MANIFEST
  ? JSON.parse(await readFile(process.env.RECRUITMENT_MANIFEST,'utf8'))
  : Array.from({length:3},(_,i) => ({
    ...Object.fromEntries(recruitmentFields.map(f=>[f,''])),
    id:`PROS-000${i+1}`, establishment:`Collège exemple ${i+1}`, city:'Toulouse',
    contact:'Direction', email:'direction@example.test', sent_on:'2026-11-20',
    response:'Non vérifiée', source:'Source fictive de recette',
    status:i===0?'À rappeler':i===2?'Non intéressé':'En attente de retour', next_action:'Rappeler, date à préciser',
  }))
for(const r of rows) await importRecruitment(db,r,'fixture@example.test')
const {publicKey,privateKey}=await generateKeyPair('RS256')
const jwk={...(await exportJWK(publicKey)),kid:'recruitment-local',alg:'RS256',use:'sig'}
const env={INTERNAL_ACCESS_DOMAIN:'recruitment-local.cloudflareaccess.com',INTERNAL_ACCESS_AUD:'recruitment-local',TEAM_WORKSPACE:db}
const token=await new SignJWT({email:'charlotte@example.test'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('local').setAudience(env.INTERNAL_ACCESS_AUD).setIssuer('https://'+env.INTERNAL_ACCESS_DOMAIN).setExpirationTime('1d').sign(privateKey)
globalThis.fetch=async input=>{
  if(String(input)==='https://'+env.INTERNAL_ACCESS_DOMAIN+'/cdn-cgi/access/certs')return Response.json({keys:[jwk]})
  throw new Error('External network disabled in local fixture')
}
const worker=new URL('../dist/_worker.js/',import.meta.url)
const manifestName=(await readdir(worker)).find(f=>f.startsWith('manifest_')&&f.endsWith('.mjs'))
const {manifest}=await import(new URL(manifestName,worker))
const paths=['interne/recrutement.astro','api/interne/recrutement.ts']
const pageMap=new Map(paths.map(p=>['src/pages/'+p,()=>import(new URL('pages/'+p.replace(/\.(astro|ts)$/,'.astro.mjs'),worker))]))
const app=new App({...manifest,sessionConfig:undefined,pageMap})
const serve=process.argv.includes('--serve')
const server=Bun.serve({
  hostname:'127.0.0.1',port:serve?4355:0,
  async fetch(request) {
    const u=new URL(request.url)
    if(['/interne/recrutement','/api/interne/recrutement'].includes(u.pathname)) {
      const headers=new Headers(request.headers)
      if(headers.get('X-Recruitment-Anonymous')!=='true')headers.set('Cf-Access-Jwt-Assertion',token)
      return app.render(new Request(request,{headers}),{locals:{runtime:{env}}})
    }
    if(/^\/(_astro|fonts)\//.test(u.pathname)||u.pathname==='/favicon.svg')
      return new Response(Bun.file(new URL('../dist'+u.pathname,import.meta.url)))
    return new Response('Aperçu local uniquement',{status:404})
  },
})
const origin=`http://127.0.0.1:${server.port}`, url=origin+'/interne/recrutement'
if(serve) console.log('Aperçu local, modifications non conservées : '+url)
else {
  const output=process.env.RECRUITMENT_OUTPUT||join(tmpdir(),'euneos-recruitment-preview')
  await mkdir(output,{recursive:true})
  const browser=await chromium.launch()
  try {
    const page=await browser.newPage(),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    const anonymous=await page.request.get(url,{headers:{'X-Recruitment-Anonymous':'true'}})
    assert.equal(anonymous.status(),403)
    const anonApi=await page.request.get(origin+'/api/interne/recrutement',{headers:{'X-Recruitment-Anonymous':'true'}})
    assert.equal(anonApi.status(),403)
    for(const width of [320,390,768,860,861,1024,1440]) {
      await page.setViewportSize({width,height:1000})
      await page.goto(url)
      await expect(page.locator('[data-recruitment-card]')).toHaveCount(rows.length)
      for (const badge of await page.locator('[data-status="Non intéressé"] .recruitment-badge').all()) {
        await expect(badge).toHaveCSS('background-color', 'rgb(180, 35, 24)')
        await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)')
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'closed horizontal overflow')
      const first=page.locator('summary').first()
      await first.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('details').first()).toHaveAttribute('open','')
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'open horizontal overflow')
      if([390,1440].includes(width)) {
        await page.screenshot({path:join(output,`recrutement-${width}.png`),fullPage:false})
        await page.locator('details').first().screenshot({path:join(output,`fiche-${width}.png`)})
      }
      await page.locator('#recruitment-search').fill(rows[0].id)
      await expect(page.locator('[data-recruitment-card]:visible')).toHaveCount(1)
      await page.locator('#recruitment-search').fill('aucun-contact-correspondant')
      await expect(page.locator('[data-recruitment-card]:visible')).toHaveCount(0)
      await page.locator('#recruitment-search').fill('')
      await page.locator('#recruitment-status').selectOption('À rappeler')
      await expect(page.locator('[data-recruitment-card]:visible')).toHaveCount(rows.filter(r=>r.status==='À rappeler').length)
    }
    await page.goto(url)
    const firstForm=page.locator('[data-recruitment-form]').first()
    await page.locator('summary').first().click()
    await firstForm.locator('[name=notes]').fill('Note de recette locale uniquement')
    await firstForm.getByRole('button',{name:'Enregistrer la fiche'}).click()
    await expect(page.locator('details').first()).not.toHaveAttribute('open','')
    const saved=(await listRecruitment(db))[0]
    assert.equal(saved.notes,'Note de recette locale uniquement')
    assert.equal(saved.version,2)
    // Stale update and cross-site writes cannot modify a contact.
    const stale=await page.request.patch(origin+'/api/interne/recrutement',{headers:{Origin:origin},data:{id:saved.id,version:1,contact:saved}})
    assert.equal(stale.status(),409)
    const cross=await page.request.patch(origin+'/api/interne/recrutement',{headers:{Origin:'https://external.example'},data:{id:saved.id,version:2,contact:saved}})
    assert.equal(cross.status(),403)
    assert.equal((await listRecruitment(db))[0].version,2)
    assert.deepEqual(errors,[])
    console.log(`Recette OK : ${rows.length} contacts, 7 largeurs, recherche, filtre, clavier, sauvegarde relue, concurrence, accès privé. Captures : ${output}`)
  } finally {await browser.close();server.stop(true);sql.close()}
}
