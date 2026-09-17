import { describe, expect, test } from 'bun:test'
import { generateKeyPair, SignJWT } from 'jose'
import { requireInternalAccess } from '../src/lib/internal-access'

const issuer = 'https://euneos-test.cloudflareaccess.com'
const env = { INTERNAL_ACCESS_DOMAIN: 'euneos-test.cloudflareaccess.com', INTERNAL_ACCESS_AUD: 'test-app' }
const { privateKey, publicKey } = await generateKeyPair('RS256')
const request = (jwt) => new Request('https://pr-3.euneos-site.pages.dev/etat-candidatures', { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} })
const sign = (options = {}) => new SignJWT({ email: options.email === null ? undefined : options.email ?? 'member@example.test' })
  .setProtectedHeader({ alg: 'RS256' }).setSubject('member').setIssuer(options.iss ?? issuer)
  .setAudience(options.aud ?? 'test-app').setExpirationTime(options.exp ?? '5m').sign(privateKey)
const keys = async () => publicKey

describe('Protection de la page interne', () => {
  test('ferme l’accès en l’absence de configuration', async () => {
    const response = await requireInternalAccess(request(), {})
    expect(response?.status).toBe(503)
    expect(response?.headers.get('Cache-Control')).toContain('no-store')
  })
  test('refuse un visiteur non connecté, y compris sur le domaine preview', async () => {
    expect((await requireInternalAccess(request(), env, keys))?.status).toBe(403)
  })
  test('autorise un jeton signé pour cette application', async () => {
    expect(await requireInternalAccess(request(await sign()), env, keys)).toBeNull()
  })
  test.each([
    { aud: 'other-app' }, { iss: 'https://other.cloudflareaccess.com' }, { exp: '-1m' }, { email: null },
  ])('refuse un jeton hors périmètre, expiré ou sans identité : %j', async options => {
    expect((await requireInternalAccess(request(await sign(options)), env, keys))?.status).toBe(403)
  })
  test('refuse un jeton falsifié et un simple en-tête email', async () => {
    const forged = new Request(request('not.a.valid-signature'), { headers: { 'Cf-Access-Authenticated-User-Email': 'member@example.test' } })
    expect((await requireInternalAccess(forged, env, keys))?.status).toBe(403)
    expect((await requireInternalAccess(request('not.a.valid-signature'), env, keys))?.status).toBe(403)
  })
})
