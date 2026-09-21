import { afterAll, describe, expect, test } from 'bun:test'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { getInternalContext } from '../src/lib/internal-context'
import { requireInternalAccess } from '../src/lib/internal-access'
import { POST as saveResource } from '../src/pages/api/interne/catalogue'

const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'workspace-test', alg: 'RS256', use: 'sig' }
const env = {
  INTERNAL_ACCESS_DOMAIN: 'workspace-test.cloudflareaccess.com',
  INTERNAL_ACCESS_AUD: 'team',
  RESOURCE_ACCESS_DOMAIN: 'workspace-test.cloudflareaccess.com',
  RESOURCE_ACCESS_AUD: 'trainers',
  INTERNAL_ADMIN_EMAILS: 'manager@example.test',
  TEAM_WORKSPACE: {
    prepare() {
      throw new Error('No database access expected during auth')
    },
  },
}
const realFetch = globalThis.fetch
globalThis.fetch = async (input) => {
  const url = String(input)
  if (url === `https://${env.INTERNAL_ACCESS_DOMAIN}/cdn-cgi/access/certs`)
    return Response.json({ keys: [jwk] })
  return realFetch(input)
}
afterAll(() => {
  globalThis.fetch = realFetch
})
const token = (aud, email) =>
  new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'workspace-test' })
    .setIssuer(`https://${env.INTERNAL_ACCESS_DOMAIN}`)
    .setAudience(aud)
    .setSubject('test-user')
    .setExpirationTime('5m')
    .sign(privateKey)
const request = (jwt) =>
  new Request('https://euneos.fr/interne', {
    headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {},
  })
const locals = { runtime: { env } }
describe('Séparation des accès équipe et formateurs', () => {
  test('l’écriture des ressources refuse l’audience formateurs, même avec une adresse administrateur, avant de lire la base', async () => {
    for (const [aud, email] of [
      ['trainers', 'trainer@example.test'],
      ['trainers', 'manager@example.test'],
      ['team', 'member@example.test'],
      ['another-project', 'manager@example.test'],
    ]) {
      const req = new Request('https://euneos.fr/api/interne/catalogue', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': await token(aud, email),
          Origin: 'https://euneos.fr',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      expect((await saveResource({ request: req, locals })).status).toBe(403)
    }
  })
  test('un formateur consulte les ressources mais jamais les dossiers ni les calendriers', async () => {
    const req = request(await token('trainers', 'trainer@example.test'))
    expect((await getInternalContext(req, locals, true)).identity).toEqual({
      email: 'trainer@example.test',
      admin: false,
    })
    expect((await getInternalContext(req, locals)).status).toBe(403)
    expect((await requireInternalAccess(req, env)).status).toBe(403)
  })
  test('un membre lit les deux espaces, seul un responsable identifié peut approuver', async () => {
    const req = request(await token('team', 'member@example.test'))
    expect((await getInternalContext(req, locals)).identity.admin).toBe(false)
    expect((await getInternalContext(req, locals, true)).identity.admin).toBe(false)
    const manager = request(await token('team', 'manager@example.test'))
    expect((await getInternalContext(manager, locals)).identity.admin).toBe(true)
    // The same email cannot elevate a token from the trainers-only audience.
    expect(
      (
        await getInternalContext(
          request(await token('trainers', 'manager@example.test')),
          locals,
          true,
        )
      ).identity.admin,
    ).toBe(false)
  })
  test('aucun accès implicite par un en-tête email ou une audience étrangère', async () => {
    expect((await getInternalContext(request(), locals)).status).toBe(403)
    const req = request(await token('another-project', 'manager@example.test'))
    expect((await getInternalContext(req, locals, true)).status).toBe(403)
  })
  test('absence de stockage explicite, sans inventer un calendrier vide', async () => {
    const req = request(await token('team', 'member@example.test'))
    expect(
      (await getInternalContext(req, { runtime: { env: { ...env, TEAM_WORKSPACE: undefined } } }))
        .status,
    ).toBe(503)
  })
})
