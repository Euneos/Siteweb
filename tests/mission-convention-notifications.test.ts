import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { submitConvention, requestChanges } from '../src/lib/mission-convention'
import { saveDraft, submitDraft } from '../src/lib/mission-convention-drafts'
import { notifyConventionEvents, conventionNotificationReceipts } from '../src/lib/mission-convention-notifications'

const owner = {email:'trainer@example.test',admin:false}
const admin = {email:'manager@example.test',admin:true}
const env = {BREVO_API_KEY:'synthetic-key',BREVO_SENDER_EMAIL:'sender@example.test'}
const payload = () => ({nom:'Camille Test',structure:'Structure',identification:'secret-business-id',adresse:'Adresse privée',email:owner.email,telephone:'0102030405',frais:'aucun',detailsFrais:'',missions:[{
  etablissement:'Collège fictif',adresse:'Adresse',direction:'Direction',referent:'Référent',contact:'contact@example.test',format:'presentiel',volume:16,
  sessions:Array.from({length:4},()=>({date:'2027-01-12',duree:4,modalite:'presentiel'})),cas1:'non',classe:'',ateliers:'',cas2:'non',periodeCas2:'',accordCas2:'',
}]})
const realFetch = globalThis.fetch
afterEach(()=>{globalThis.fetch=realFetch})
function fixture() {
  const sql = new Database(':memory:')
  sql.exec('PRAGMA foreign_keys=ON')
  for (const f of ['0009_conventions_mission.sql','0012_mission_convention_drafts.sql']) sql.exec(readFileSync(`migrations/interne/${f}`,'utf8'))
  sql.query("INSERT INTO mission_conventions(id,owner_email,state,payload) VALUES('historical',?,'submitted',?)").run(owner.email,JSON.stringify(payload()))
  sql.exec(readFileSync('migrations/interne/0013_mission_convention_notifications.sql','utf8'))
  sql.exec(readFileSync('migrations/interne/0014_mission_convention_year2.sql','utf8'))
  const db = {
    batch: async (statements: {execute:()=>unknown}[]) => sql.transaction(()=>statements.map(s=>s.execute()))(),
    prepare: (q:string)=>({bind:(...args:unknown[])=>({
      first: async ()=>sql.query(q).get(...args as []),
      all: async ()=>({results:sql.query(q).all(...args as [])}),
      run: async ()=>({meta:{changes:sql.query(q).run(...args as []).changes}}),
      execute: ()=>({meta:{changes:sql.query(q).run(...args as []).changes}}),
    })}),
  } as unknown as Parameters<typeof submitConvention>[0]
  return {sql,db}
}
function mailMock(fail = false) {
  const messages: Record<string,any>[] = []
  globalThis.fetch = (async (url,init) => {
    expect(String(url)).toBe('https://api.brevo.com/v3/smtp/email')
    messages.push(JSON.parse(String(init?.body)))
    if (fail) throw new Error('Connection lost after possible acceptance')
    return Response.json({messageId:'synthetic'}, {status:201})
  }) as typeof fetch
  return messages
}
describe('notifications des conventions',()=>{
  test('soumission, corrections et signature produisent des événements atomiques, sans reprise historique',async()=>{
    const {sql,db}=fixture()
    expect(await conventionNotificationReceipts(db)).toHaveLength(0)
    const row=await submitConvention(db,owner,payload())
    expect(await conventionNotificationReceipts(db)).toHaveLength(1)
    await expect(submitConvention(db,owner,payload(),row.id)).rejects.toMatchObject({status:409})
    expect(sql.query('SELECT COUNT(*) AS n FROM mission_convention_notifications').get()).toEqual({n:1})
    await requestChanges(db,row.id,admin,'À corriger')
    await submitConvention(db,owner,payload(),row.id)
    expect(sql.query('SELECT COUNT(*) AS n FROM mission_convention_notifications').get()).toEqual({n:2})
    sql.query("UPDATE mission_conventions SET state='approved' WHERE id=?").run(row.id)
    sql.query("INSERT INTO mission_convention_files(convention_id,kind,pdf,sha256,uploaded_by) VALUES(?,'approved',?,'hash',?)").run(row.id,new Uint8Array([1]),admin.email)
    expect(sql.query('SELECT COUNT(*) AS n FROM mission_convention_notifications').get()).toEqual({n:2})
    sql.query("INSERT INTO mission_convention_files(convention_id,kind,pdf,sha256,uploaded_by) VALUES(?,'trainer_signed',?,'hash',?)").run(row.id,new Uint8Array([1]),owner.email)
    expect(sql.query('SELECT COUNT(*) AS n FROM mission_convention_notifications').get()).toEqual({n:3})
    expect(()=>sql.transaction(()=>{sql.query("INSERT INTO mission_conventions(id,owner_email,state,payload) VALUES('rollback',?,'submitted',?)").run(owner.email,JSON.stringify(payload()));throw Error('rollback')})()).toThrow()
    expect(sql.query("SELECT COUNT(*) AS n FROM mission_convention_notifications WHERE convention_id='rollback'").get()).toEqual({n:0})
    sql.close()
  })
  test('sauvegarde de brouillon silencieuse, soumission unique et email minimal vers la boîte fixe',async()=>{
    const {sql,db}=fixture(); const messages=mailMock(); const id=crypto.randomUUID()
    await saveDraft(db,owner,admin,id,0,payload(),'Note privée')
    expect(await notifyConventionEvents(db,env,id,'https://euneos.fr')).toBe('none')
    expect(messages).toHaveLength(0)
    await submitDraft(db,owner,id,1,payload())
    await Promise.all([notifyConventionEvents(db,env,id,'https://euneos.fr'),notifyConventionEvents(db,env,id,'https://euneos.fr')])
    expect(messages).toHaveLength(1)
    expect(messages[0].to).toEqual([{email:'euneosequipe@gmail.com'}])
    expect(messages[0].textContent).toContain('Camille Test')
    expect(messages[0].textContent).toContain('Collège fictif')
    expect(messages[0].textContent).toContain(`#convention-${id}`)
    expect(messages[0].textContent).not.toContain('secret-business-id')
    expect(messages[0].attachment).toBeUndefined()
    expect(await notifyConventionEvents(db,env,id,'https://euneos.fr')).toBe('sent')
    expect(messages).toHaveLength(1)
    expect((await conventionNotificationReceipts(db))[0].state).toBe('sent')
    sql.close()
  })
  test('timeout : convention conservée et aucune seconde tentative automatique',async()=>{
    const {sql,db}=fixture(); const messages=mailMock(true)
    const row=await submitConvention(db,owner,payload())
    expect(await notifyConventionEvents(db,env,row.id,'https://euneos.fr')).toBe('uncertain')
    expect(await notifyConventionEvents(db,env,row.id,'https://euneos.fr')).toBe('uncertain')
    expect(messages).toHaveLength(1)
    expect(sql.query('SELECT state FROM mission_conventions WHERE id=?').get(row.id)).toEqual({state:'submitted'})
    sql.close()
  })
  test('pas d’envoi depuis les previews ni sans configuration',async()=>{
    const {sql,db}=fixture(); const messages=mailMock()
    for (const [runtime,origin,expected] of [[env,'https://preview.pages.dev','preview'],[{...env,INTERNAL_WORKSPACE_PREVIEW:'true'},'https://euneos.fr','preview'],[{},'https://euneos.fr','unavailable']] as const) {
      const row=await submitConvention(db,owner,payload())
      expect(await notifyConventionEvents(db,runtime,row.id,origin)).toBe(expected)
    }
    expect(messages).toHaveLength(0)
    sql.close()
  })
})
