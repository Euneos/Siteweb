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
