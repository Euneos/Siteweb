import {test,expect,afterEach} from 'bun:test'
import {Database} from 'bun:sqlite'
import {readFileSync} from 'node:fs'
import {acknowledgeOperational} from '../src/lib/operational-mail'
const realFetch=globalThis.fetch
let sql
const fixture=()=>{sql=new Database(':memory:');sql.exec(readFileSync(new URL('../migrations/0003_operational_links.sql',import.meta.url),'utf8'));return{db:{prepare:q=>({bind:(...v)=>({run:async()=>({meta:{changes:sql.query(q).run(...v).changes}})})})},env:{BREVO_API_KEY:'fictional',BREVO_SENDER_EMAIL:'sender@example.test'},linkHash:'a'.repeat(64),email:'recipient@example.test',kind:'contact'}}
afterEach(()=>{globalThis.fetch=realFetch;sql?.close()})
test('two competing acknowledgements cause one send, with no participant data or secret link',async()=>{
 const input=fixture();let sends=0
 globalThis.fetch=async(url,init)=>{expect(String(url)).toBe('https://api.brevo.com/v3/smtp/email');sends++;const body=JSON.parse(init.body);expect(body.to).toEqual([{email:'recipient@example.test'}]);expect(body.textContent).not.toContain(input.linkHash);return new Response('',{status:201})}
 const states=await Promise.all([acknowledgeOperational(input),acknowledgeOperational(input)])
 expect(sends).toBe(1);expect(states.sort()).toEqual(['already_claimed','sent'])
})
test('a lost provider response is recorded uncertain and never retried automatically',async()=>{
 const input=fixture();let sends=0;globalThis.fetch=async()=>{sends++;throw new Error('accepted but disconnected')}
 expect(await acknowledgeOperational(input)).toBe('uncertain');expect(await acknowledgeOperational(input)).toBe('already_claimed');expect(sends).toBe(1)
 expect(sql.query('SELECT state FROM operational_mail_receipts').get().state).toBe('uncertain')
})
test('absent Brevo config is explicitly unavailable, never a claimed successful email',async()=>{
 const input=fixture();input.env={};globalThis.fetch=async()=>{throw new Error('must not call')}
 expect(await acknowledgeOperational(input)).toBe('unavailable')
})
