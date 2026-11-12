import {test,expect} from 'bun:test'
import {lireToutes} from '../src/lib/nocodb'

test('a cancelled public refresh does not start another source request',async()=>{
  const controller=new AbortController();controller.abort(new Error('Refresh deadline reached'))
  const original=globalThis.fetch;let calls=0
  globalThis.fetch=async()=>{calls++;throw new Error('Unexpected source request')}
  try {
    await expect(lireToutes('synthetic','cohortes','Id',controller.signal)).rejects.toThrow('Refresh deadline reached')
    expect(calls).toBe(0)
  } finally {globalThis.fetch=original}
})
test('the same refresh deadline covers pagination and stops subsequent pages',async()=>{
  const controller=new AbortController();const original=globalThis.fetch;let calls=0
  globalThis.fetch=async(_url,options)=>{
    calls++;expect(options.signal).toBe(controller.signal)
    controller.abort(new Error('Refresh deadline reached'))
    return Response.json({list:[{Id:1}],pageInfo:{isLastPage:false}})
  }
  try {
    await expect(lireToutes('synthetic','cohortes','Id',controller.signal)).rejects.toThrow('Refresh deadline reached')
    expect(calls).toBe(1)
  } finally {globalThis.fetch=original}
})
