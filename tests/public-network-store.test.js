import {test,expect,afterEach} from 'bun:test'
import {Database} from 'bun:sqlite'
import {readFileSync} from 'node:fs'
import {readPublicNetworkSnapshot} from '../src/lib/public-network-store'
const connections=[]
function fixture(){
  const sql=new Database(':memory:');connections.push(sql)
  sql.exec(readFileSync(new URL('../migrations/interne/0018_public_network_snapshot.sql',import.meta.url),'utf8'))
  const db={prepare(query){return {bind(...values){const stmt=sql.query(query);return {first:async()=>stmt.get(...values),run:async()=>({meta:{changes:stmt.run(...values).changes}})}}}}}
  return {sql,db}
}
afterEach(()=>connections.splice(0).forEach(db=>db.close()))
const network=(name='École publique')=>({locations:[{name,city:'Toulouse',location:null,formations:[]}],periods:[],trainerLocations:[],readAt:'2026-11-12T00:00:00Z'})
test('stores one anonymous snapshot and reuses it across separate readers for one minute',async()=>{
  const {db,sql}=fixture();let calls=0,time=100_000
  const load=async()=>{calls++;return network()}
  const a=await readPublicNetworkSnapshot(db,load,{now:()=>time})
  const b=await readPublicNetworkSnapshot(db,load,{now:()=>time+59_999})
  expect(calls).toBe(1);expect(b).toEqual(a)
  const row=sql.query('SELECT * FROM public_network_snapshots').get()
  expect(JSON.parse(row.payload)).toEqual(network());expect(row.lease_token).toBeNull()
})
test('cold simultaneous requests share the database lease, not just an in-memory promise',async()=>{
  const {db}=fixture();let calls=0,finish,notifyWait
  const waiting=new Promise(resolve=>notifyWait=resolve)
  const load=()=>{calls++;return new Promise(resolve=>finish=resolve)}
  const first=readPublicNetworkSnapshot(db,load,{now:()=>100_000})
  while(!finish) await new Promise(resolve=>setTimeout(resolve,0))
  const second=readPublicNetworkSnapshot(db,load,{now:()=>100_000,wait:async()=>{notifyWait();await new Promise(resolve=>setTimeout(resolve,1))}})
  await waiting;finish(network())
  expect(await second).toEqual(await first);expect(calls).toBe(1)
})
test('serves the last complete map while exactly one background refresh updates all pages',async()=>{
  const {db}=fixture();let time=100_000,finish,calls=0;const work=[]
  await readPublicNetworkSnapshot(db,async()=>network('Avant'),{now:()=>time})
  time+=60_001
  const load=()=>{calls++;return new Promise(resolve=>finish=resolve)}
  const stale=await readPublicNetworkSnapshot(db,load,{now:()=>time,background:p=>work.push(p)})
  const other=await readPublicNetworkSnapshot(db,load,{now:()=>time,background:p=>work.push(p)})
  expect(stale.data.locations[0].name).toBe('Avant');expect(other).toEqual(stale)
  expect(calls).toBe(1);expect(work).toHaveLength(1)
  finish(network('Après'));await work[0]
  const current=await readPublicNetworkSnapshot(db,load,{now:()=>time})
  expect(current.data.locations[0].name).toBe('Après');expect(current.refreshedAt).toBe(time)
})
test('a temporary NocoDB failure preserves complete data and its original update date',async()=>{
  const {db,sql}=fixture();let time=100_000,calls=0
  await readPublicNetworkSnapshot(db,async()=>network(),{now:()=>time})
  time+=60_001
  const load=async()=>{calls++;throw new Error('NocoDB 429 /synthetic: rate limited')}
  const result=await readPublicNetworkSnapshot(db,load,{now:()=>time})
  expect(result.refreshedAt).toBe(100_000);expect(result.data).toEqual(network())
  await readPublicNetworkSnapshot(db,load,{now:()=>time+1000})
  expect(calls).toBe(1);expect(sql.query('SELECT lease_until FROM public_network_snapshots').get().lease_until).toBe(time+30_000)
  time+=30_001
  expect((await readPublicNetworkSnapshot(db,async()=>network('Rétabli'),{now:()=>time})).data.locations[0].name).toBe('Rétabli')
})
test('an expired owner cannot overwrite a newer refresh',async()=>{
  const {db,sql}=fixture();let time=100_000,finish
  const old=readPublicNetworkSnapshot(db,()=>new Promise(resolve=>finish=resolve),{now:()=>time})
  const rejected=old.then(()=>null,error=>error)
  while(!finish) await new Promise(resolve=>setTimeout(resolve,0))
  time+=240_001
  await readPublicNetworkSnapshot(db,async()=>network('Nouveau'),{now:()=>time})
  finish(network('Ancien'));expect((await rejected)?.message).toContain('lease expired')
  expect(JSON.parse(sql.query('SELECT payload FROM public_network_snapshots').get().payload).locations[0].name).toBe('Nouveau')
})
test('no initial snapshot is invented if NocoDB fails',async()=>{
  const {db,sql}=fixture()
  await expect(readPublicNetworkSnapshot(db,async()=>{throw new Error('NocoDB 503 /synthetic')},{now:()=>100_000})).rejects.toThrow('503')
  expect(sql.query('SELECT payload FROM public_network_snapshots').get().payload).toBeNull()
  expect(()=>sql.exec("INSERT INTO public_network_snapshots (id,payload) VALUES ('other','{}')")).toThrow()
})
