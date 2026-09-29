// Compiled Astro page + real compiled API/service + SQLite. All remote systems
// intercepted; no production variables, real recipients, NocoDB or Brevo calls.
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { App } from 'astro/app'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { chromium, expect } from '@playwright/test'
import * as pageModule from '../dist/_worker.js/pages/interne/decision-candidature.astro.mjs'
import * as apiModule from '../dist/_worker.js/pages/api/interne/candidature-emails.astro.mjs'
const output=process.env.CHECK_SCREENSHOTS ?? '/tmp/euneos-decisions-ui'
await mkdir(output,{recursive:true})
const manifestName=(await readdir(new URL('../dist/_worker.js/',import.meta.url))).find(n=>n.startsWith('manifest_')&&n.endsWith('.mjs'))
const {manifest}=await import(new URL('../dist/_worker.js/'+manifestName,import.meta.url))
const app=new App({...manifest,sessionConfig:undefined,pageMap:new Map([
 ['src/pages/interne/decision-candidature.astro',async()=>pageModule],['src/pages/api/interne/candidature-emails.ts',async()=>apiModule],
])})
const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'decision-local',alg:'RS256',use:'sig'}
const domain='decision-ui-local.cloudflareaccess.com'
async function token(email){return new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('fixture').setAudience('test-team').setIssuer('https://'+domain).setExpirationTime('30m').sign(privateKey)}
const adminToken=await token('manager@example.invalid'),memberToken=await token('reader@example.invalid')
const originalFetch=globalThis.fetch
let sql,env,part,school,mode='normal',nocoWrites=0,mailSends=0,asAdmin=true
const template={version:'FICTIVE-v1',approvalRef:'TEST ONLY',subject:'Réponse WISE-UP — {{etablissement}}',text:'Bonjour,\n\nLa candidature de {{etablissement}} pour {{cohorte}} est acceptée.\n\nL’équipe EUNEOS'}
async function reset({approved=true,enabled=true,admin=true}={}){
  sql?.close();sql=new Database(':memory:')
  for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>/^\d.*\.sql$/.test(n)).sort())sql.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'))
  const db={prepare:q=>({bind:(...v)=>({run:async()=>({meta:{changes:sql.query(q).run(...v).changes}}),first:async()=>sql.query(q).get(...v),all:async()=>({results:sql.query(q).all(...v)})})})}
  part={Id:7,code:'DOS-TEST-007',statut:'Candidature reçue',statut_origine:'Candidature recue',etablissements_id:1,cohortes_id:2,fusionne_vers:null,notes:'PRIVATE_NOTES_MUST_NOT_BE_RENDERED'}
  school={Id:1,nom:'Collège de démonstration',ville:'Ville Exemple',referent_email:'referent@example.invalid'}
  env={INTERNAL_ACCESS_DOMAIN:domain,INTERNAL_ACCESS_AUD:'test-team',INTERNAL_ADMIN_EMAILS:'manager@example.invalid',TEAM_WORKSPACE:{},FORM_SUBMISSIONS:db,NOCODB_TOKEN:'fixture-token',BREVO_API_KEY:'fixture-key',
    CANDIDATURE_MAIL_REGISTRY_ENABLED:'true',CANDIDATURE_DECISION_SEND_ENABLED:'true',CANDIDATURE_MAIL_SEND_ENABLED:'true',CANDIDATURE_MAIL_OWNER:'site',
    CANDIDATURE_DECISIONS_ENABLED:enabled?'true':'false',CANDIDATURE_DECISION_WRITE_OWNER:'site',CANDIDATURE_DECISION_CONCURRENCY_REVIEW:enabled?'TEST ONLY EXCLUSIVE WRITER':'',
    ...(approved?{CANDIDATURE_DECISION_TEMPLATES:JSON.stringify({accepted:template,refused:{...template,text:'Proposition de refus fictive'}})}:{})}
  mode='normal';nocoWrites=0;mailSends=0;asAdmin=admin
}
globalThis.fetch=async(input,init)=>{
  const u=new URL(String(input)),method=init?.method ?? 'GET'
  if(u.hostname===domain)return Response.json({keys:[jwk]})
  if(u.origin==='https://api.brevo.com'){
    assert.equal(method,'POST');assert.equal(u.pathname,'/v3/smtp/email');mailSends++
    if(mode==='mail-uncertain')throw new Error('FICTIVE timeout')
    return Response.json({messageId:'<ui-fixture-message>'},{status:201})
  }
  assert.equal(u.origin,'https://app.nocodb.com','ALL REAL NETWORK IS FORBIDDEN')
  const [,,,,table,,id]=u.pathname.split('/')
  const rows=table==='mbunbu0f1zztce4'?[part]:table==='mg12klh5zv7b5n5'?[school]:table==='m5ayop8ul8s040l'?[{Id:2,nom:'2026–2027',active:true}]:null
  assert(rows,'Known fixture table only')
  if(method==='GET')return Response.json(id?rows.find(r=>r.Id===Number(id)):{list:rows,pageInfo:{isLastPage:true}})
  assert.equal(method,'PATCH');assert.equal(table,'mbunbu0f1zztce4');nocoWrites++
  const patch=JSON.parse(init.body);assert.deepEqual(Object.keys(patch[0]).sort(),['Id','statut'])
  Object.assign(part,patch[0])
  if(mode==='write-uncertain')throw new Error('FICTIVE response lost after commit')
  return Response.json(patch)
}
await reset()
const locals=()=>({runtime:{env}})
// Public preview and anonymous page must expose no identity or dossier data.
for(const url of ['https://pr-fictive.euneos-site.pages.dev/interne/decision-candidature?dossier=7','https://euneos.fr/interne/decision-candidature?dossier=7']){
  const response=await app.render(new Request(url),{locals:locals()})
  assert.equal(response.status,403);const text=await response.text()
  assert.doesNotMatch(text,/referent@example|Collège de démonstration|PRIVATE_NOTES|manager@example/)
}
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const u=new URL(request.url)
  if(u.pathname.startsWith('/_astro/')||u.pathname.startsWith('/fonts/')||u.pathname==='/favicon.svg')return new Response(Bun.file(new URL('../dist'+u.pathname,import.meta.url)))
  // Simulate the trusted edge Access header, never a production auth bypass.
  const headers=new Headers(request.headers);headers.set('Cf-Access-Jwt-Assertion',asAdmin?adminToken:memberToken)
  if(request.method==='POST')headers.set('Origin','https://euneos.fr')
  const rewritten=new Request('https://euneos.fr'+u.pathname+u.search,{method:request.method,headers,...(request.method==='POST'?{body:await request.text()}:{})})
  return app.render(rewritten,{locals:locals()})
}})
const browser=await chromium.launch({headless:true})
const results=[]
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    const open=async()=>{await page.goto(`http://127.0.0.1:${server.port}/interne/decision-candidature?dossier=7`);await expect(page.locator('#dm-school')).toHaveText('Collège de démonstration')}
    const preview=async()=>{await page.selectOption('#dm-kind','accepted');await page.click('#dm-prepare');await expect(page.locator('#dm-preview')).toBeVisible();await expect(page.locator('#dm-preview-to')).toHaveText('referent@example.invalid')}
    await reset();await open();await preview()
    await expect(page.locator('#dm-send')).toBeDisabled();await page.check('#dm-consent');await expect(page.locator('#dm-send')).toBeEnabled()
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow '+width)
    await page.screenshot({path:`${output}/preview-${width}.png`,fullPage:true})
    await page.click('#dm-send');await expect(page.locator('#dm-feedback')).toContainText('Email accepté par Brevo')
    assert.equal(nocoWrites,1);assert.equal(mailSends,1);assert.equal(part.statut,'Candidature acceptée')
    await page.reload();await expect(page.locator('#dm-journal')).toContainText('<ui-fixture-message>');assert.equal(mailSends,1)
    results.push({width,scenario:'approved-confirmed-and-reload',passed:true})
    await reset({approved:false});await open();await preview();await page.check('#dm-consent')
    await expect(page.locator('#dm-send')).toBeDisabled();await expect(page.locator('#dm-template-note')).toContainText('non validée')
    await page.click('#dm-save-only');await expect(page.locator('#dm-feedback')).toContainText('Aucun email envoyé')
    assert.equal(nocoWrites,1);assert.equal(mailSends,0);results.push({width,scenario:'unapproved-without-mail',passed:true})
    await reset({enabled:false});await open();await preview();await page.check('#dm-consent')
    await expect(page.locator('#dm-send')).toBeDisabled();await expect(page.locator('#dm-save-only')).toBeDisabled()
    await expect(page.locator('#dm-availability')).toContainText('désactivé');assert.equal(nocoWrites,0);results.push({width,scenario:'disabled-no-false-success',passed:true})
    await reset({admin:false});await open();await expect(page.locator('#dm-prepare')).toBeDisabled();await expect(page.locator('#dm-availability')).toContainText('Consultation seule')
    results.push({width,scenario:'read-only-member',passed:true})
    await reset();await open();await preview();part.notes='External change after preview';await page.check('#dm-consent');await page.click('#dm-send')
    await expect(page.locator('#dm-feedback')).toContainText('changé');assert.equal(nocoWrites,0);assert.equal(mailSends,0)
    await expect(page.locator('#dm-send')).toBeDisabled();results.push({width,scenario:'concurrent-change-no-retry',passed:true})
    await reset();await open();await preview();mode='write-uncertain';await page.check('#dm-consent');await page.click('#dm-send')
    await expect(page.locator('#dm-feedback')).toContainText('n’a pas pu être confirmé');assert.equal(nocoWrites,1);assert.equal(mailSends,0)
    await expect(page.locator('#dm-journal')).toContainText('Décision à vérifier');results.push({width,scenario:'write-response-lost',passed:true})
    await reset();await open();await preview();mode='mail-uncertain';await page.check('#dm-consent');await page.click('#dm-send')
    await expect(page.locator('#dm-feedback')).toContainText('Résultat d’envoi incertain');assert.equal(nocoWrites,1);assert.equal(mailSends,1)
    await expect(page.locator('#dm-journal')).toContainText('Résultat incertain');await page.screenshot({path:`${output}/uncertain-${width}.png`,fullPage:true})
    results.push({width,scenario:'status-saved-mail-uncertain',passed:true})
    assert.deepEqual(errors,[],'No browser errors');await page.close()
  }
  await writeFile(`${output}/results.json`,JSON.stringify({scenarios:results.length,results,network:'all external calls mocked',productionWrites:0,realEmails:0},null,2))
  console.log(JSON.stringify({passed:results.length,widths:[390,1440],output,realEmails:0,productionWrites:0}))
}finally{await browser.close();server.stop(true);sql?.close();globalThis.fetch=originalFetch}
