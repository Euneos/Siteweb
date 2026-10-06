import { test, expect } from 'bun:test'
import { studyToken, studyEmail } from '../src/lib/study-access'

test('étude : signature, expiration et absence de jeton', async () => {
  const token = await studyToken('lectrice@example.com', 'secret-test', 1000)
  expect(await studyEmail(token, 'secret-test', 2000)).toBe('lectrice@example.com')
  expect(await studyEmail(token, 'autre-secret', 2000)).toBeNull()
  expect(await studyEmail(token, 'secret-test', 8 * 86400000)).toBeNull()
  expect(await studyEmail('', 'secret-test')).toBeNull()
  expect(await studyEmail(token + '00', 'secret-test', 2000)).toBeNull()
})


test('PDF immédiatement disponible après formulaire accepté, sans requête Brevo supplémentaire', async () => {
  const { GET } = await import('../src/pages/api/etude')
  const token = await studyToken('nouvelle-adresse@example.com', 'test-key')
  const response = await GET({
    request: new Request('https://euneos.fr/api/etude?token=' + encodeURIComponent(token)),
    locals: { runtime: { env: { BREVO_API_KEY: 'test-key' } } },
  } as any)
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Disposition')).toContain('attachment')
  expect((await response.arrayBuffer()).byteLength).toBe(1146279)
})

test('PDF refusé sans jeton de formulaire accepté', async () => {
  const { GET } = await import('../src/pages/api/etude')
  const response = await GET({
    request: new Request('https://euneos.fr/api/etude'),
    locals: { runtime: { env: { BREVO_API_KEY: 'test-key' } } },
  } as any)
  expect(response.status).toBe(403)
})
