import { afterEach, beforeEach, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { POST, GET } from '../src/pages/api/interne/candidature-emails'
import { POST as candidaturePost } from '../src/pages/api/candidature-etablissement'
import { NC } from '../src/lib/nocodb'
const issuer = 'https://candidature-mail-test.cloudflareaccess.com'
const { privateKey, publicKey } = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(publicKey)), kid: 'candidate-mail', alg: 'RS256', use: 'sig' }
const originalFetch = globalThis.fetch
let sql: Database, env: any, calls: any[], parts: any[], schools: any[]
beforeEach(() => {
  sql = new Database(':memory:')
  for (const f of ['0001_form_submissions.sql', '0007_candidature_mails.sql', '0008_candidature_decisions.sql'])
    sql.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'))
  const db = {
    prepare: (q: string) => ({
      bind: (...v: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
        first: async () => sql.query(q).get(...v),
        all: async () => ({ results: sql.query(q).all(...v) }),
      }),
    }),
  }
  env = {
    INTERNAL_ACCESS_DOMAIN: new URL(issuer).hostname,
    INTERNAL_ACCESS_AUD: 'team',
    INTERNAL_ADMIN_EMAILS: 'manager@example.invalid',
    TEAM_WORKSPACE: {},
    FORM_SUBMISSIONS: db,
    NOCODB_TOKEN: 'fake',
    BREVO_API_KEY: 'fake',
    CANDIDATURE_MAIL_REGISTRY_ENABLED: 'true',
    CANDIDATURE_ACK_REGISTRY_ENABLED: 'true',
    CANDIDATURE_MAIL_SEND_ENABLED: 'true',
    CANDIDATURE_MAIL_OWNER: 'site',
  }
  calls = []
  parts = []
  schools = []
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const u = new URL(String(input))
    calls.push({ url: u.href, method: init?.method ?? 'GET' })
    if (u.href === issuer + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] })
    if (u.href === 'https://api.brevo.com/v3/smtp/email')
      return Response.json({ messageId: '<route-test>' }, { status: 201 })
    if (u.origin !== 'https://app.nocodb.com') throw new Error('NO_REAL_NETWORK')
    const [, , , , table, operation, id] = u.pathname.split('/')
    const rows =
      table === NC.tables.etablissements
        ? schools
        : table === NC.tables.participations
          ? parts
          : table === NC.tables.cohortes
            ? [{ Id: 2, active: true, nom: '2026–2027' }]
            : null
    if (!rows) throw new Error('UNEXPECTED_TABLE')
    if (!init?.method || init.method === 'GET')
      return Response.json(
        id ? rows.find((r) => r.Id === Number(id)) : { list: rows, pageInfo: { isLastPage: true } },
      )
    if (init.method !== 'POST') throw new Error('UNEXPECTED_MUTATION')
    const body = JSON.parse(String(init.body))
    if (operation === 'links') {
      const row = parts.find((r) => r.Id === Number(u.pathname.split('/')[8]))
      row[
        u.pathname.includes(NC.liens['participations.etablissement'])
          ? 'etablissements_id'
          : 'cohortes_id'
      ] = body[0].Id
      return Response.json(true)
    }
    const row = { ...body[0], Id: table === NC.tables.etablissements ? 1 : 7 }
    rows.push(row)
    return Response.json([row])
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
  sql.close()
})
async function jwt(email = 'manager@example.invalid', aud = 'team') {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(issuer)
    .setAudience(aud)
    .setSubject('fictive')
    .setExpirationTime('5m')
    .sign(privateKey)
}
const locals = () => ({ runtime: { env } })
async function internal(
  body?: any,
  email = 'manager@example.invalid',
  origin = 'https://euneos.fr',
  headers: Record<string, string> = {},
) {
  const req = new Request(origin + '/api/interne/candidature-emails?participationId=7', {
    method: body ? 'POST' : 'GET',
    headers: {
      'Cf-Access-Jwt-Assertion': await jwt(email),
      'Content-Type': 'application/json',
      Origin: origin,
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return body
    ? POST({ request: req, locals: locals() } as any)
    : GET({ request: req, locals: locals() } as any)
}
const mailCalls = () => calls.filter((c) => c.url.startsWith('https://api.brevo.com'))
const data = {
  nom_etab: 'Collège fictif',
  type_etab: 'Collège',
  adresse: 'Adresse fictive',
  ville: 'Ville fictive',
  cp: '01000',
  region: 'Occitanie',
  academie: 'Fictive',
  referent_nom: 'Personne fictive',
  referent_fonction: 'CPE',
  referent_email: 'test@example.invalid',
  besoin_partage: 'Oui, clairement',
  nb_professionnels: '10 à 20',
  faisabilite: 'Facilement envisageable',
  accord_direction: 'Oui',
  demarrage_souhaite: 'Dans le trimestre à venir',
  enjeux: 'Usages numériques',
  consentement: 'Oui, je confirme',
}
async function submit(origin = 'https://euneos.fr') {
  const form = new FormData()
  Object.entries(data).forEach(([k, v]) => form.set(k, v))
  return candidaturePost({
    request: new Request(origin + '/api/candidature-etablissement', {
      method: 'POST',
      headers: { Origin: origin },
      body: form,
    }),
    locals: locals(),
    redirect: (url: string, status: number) =>
      new Response(null, { status, headers: { Location: url } }),
  } as any)
}
test('public route journals new AR with message id, duplicate produces no second email', async () => {
  const r = await submit()
  expect(r.status).toBe(303)
  expect(r.headers.get('Location')).toContain('email=1')
  expect(sql.query('SELECT state,message_id FROM candidature_mails').get()).toEqual({
    state: 'accepted',
    message_id: '<route-test>',
  })
  expect((await submit()).headers.get('Location')).toContain('ok=deja')
  expect(mailCalls()).toHaveLength(1)
})
test('public preview never writes D1/Noco/Brevo', async () => {
  expect((await submit('https://pr-test.euneos-site.pages.dev')).headers.get('Location')).toContain(
    'preview=1',
  )
  expect(calls).toHaveLength(0)
  expect(sql.query('SELECT * FROM candidature_mails').all()).toHaveLength(0)
})
test('disabled dispatch saves candidature and durable AR without claiming email success', async () => {
  env.CANDIDATURE_MAIL_SEND_ENABLED = 'false'
  const r = await submit()
  expect(r.headers.get('Location')).toBe('/candidater/etablissement?ok=1')
  expect(mailCalls()).toHaveLength(0)
  expect(sql.query('SELECT state FROM candidature_mails').get()).toEqual({ state: 'queued' })
})
test('registry off retains old path and does not make a competing queue', async () => {
  delete env.CANDIDATURE_MAIL_REGISTRY_ENABLED
  await submit()
  expect(mailCalls()).toHaveLength(1)
  expect(sql.query('SELECT * FROM candidature_mails').all()).toHaveLength(0)
})
for (const acknowledgementFlag of [undefined, 'false']) {
  test(`decision registry does not transfer acknowledgements while ACK flag is ${acknowledgementFlag}`, async () => {
    env.CANDIDATURE_ACK_REGISTRY_ENABLED = acknowledgementFlag
    const result = await submit()
    expect(result.headers.get('Location')).toContain('email=1')
    expect(mailCalls()).toHaveLength(1)
    expect(sql.query('SELECT * FROM candidature_mails').all()).toHaveLength(0)
    const view = await internal()
    expect(view.status).toBe(200)
    expect((await view.json()).enabled).toBe(true)
  })
}
test('internal routes reject anonymous, trainer audience, member mutation, CSRF and preview', async () => {
  expect(
    (
      await GET({
        request: new Request('https://euneos.fr/api/interne/candidature-emails'),
        locals: locals(),
      } as any)
    ).status,
  ).toBe(403)
  expect(
    (
      await internal(
        { action: 'prepare', kind: 'accepted', participationId: 7 },
        'member@example.invalid',
      )
    ).status,
  ).toBe(403)
  expect(
    (
      await internal({ action: 'prepare' }, undefined, undefined, {
        Origin: 'https://evil.invalid',
      })
    ).status,
  ).toBe(403)
  expect(
    (await internal({ action: 'prepare' }, undefined, 'https://pr-test.euneos-site.pages.dev'))
      .status,
  ).toBe(409)
  const r = await GET({
    request: new Request('https://euneos.fr/api/interne/candidature-emails?participationId=7', {
      headers: { 'Cf-Access-Jwt-Assertion': await jwt('manager@example.invalid', 'trainers') },
    }),
    locals: locals(),
  } as any)
  expect(r.status).toBe(403)
  expect(mailCalls()).toHaveLength(0)
})
test('internal view is private; authenticated proposals cannot send without an approved model', async () => {
  await submit()
  parts[0].statut = 'Candidature reçue'
  const view = await internal()
  expect(view.status).toBe(200)
  expect(view.headers.get('Cache-Control')).toContain('no-store')
  const p = await internal({ action: 'prepare', kind: 'accepted', participationId: 7 })
  expect(p.status).toBe(201)
  const draft = await p.json()
  expect(draft.canConfirm).toBe(false)
  parts[0].statut = 'Candidature acceptée'
  expect(
    (
      await internal({
        action: 'confirm',
        id: draft.id,
        previewHash: draft.preview_hash,
        confirm: true,
      })
    ).status,
  ).toBe(409)
  expect(mailCalls()).toHaveLength(1)
})
test('generic NocoDB migration payload is not a mail command', async () => {
  const response = await internal({ data: { rows: [{ Id: 7, statut: 'Candidature acceptée' }] } })
  expect(response.status).toBe(400)
  expect(mailCalls()).toHaveLength(0)
})
