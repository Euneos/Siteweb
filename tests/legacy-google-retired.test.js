import { test, expect } from 'bun:test'
import { GET, POST } from '../src/pages/api/hook/google-forms'
for (const [method, handler] of [['GET', GET], ['POST', POST]]) {
  test(`legacy Google ${method} is retired without reading any credential or database`, async () => {
    const response = await handler(new Proxy({}, { get() { throw new Error('No environment or request should be read') } }))
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ code: 'legacy_retired' })
  })
}
