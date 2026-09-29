import { test, expect } from 'bun:test'
import { GET, POST } from '../src/pages/api/hook/google-forms'
for (const [method, handler] of [
  ['GET', GET],
  ['POST', POST],
]) {
  test(`legacy Google ${method} is retired by default without reading credentials or databases`, async () => {
    const response = await handler({
      request: new Proxy(
        {},
        {
          get() {
            throw new Error('Request must not be read')
          },
        },
      ),
      locals: {
        runtime: {
          env: {
            get GOOGLE_FORMS_SYNC_SECRET() {
              throw new Error('Secret must not be read')
            },
            get FORM_SUBMISSIONS() {
              throw new Error('DB must not be read')
            },
          },
        },
      },
    })
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ code: 'legacy_retired' })
  })
}
