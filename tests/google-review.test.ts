import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  reconciliation,
  reviewView,
  reviewVersion,
  parseReviewCommand,
  RECONCILIATION_OPEN as OPEN,
  RECONCILIATION_CLOSE as CLOSE,
} from '../src/lib/google-review'
import { attachReview, reviewClient, reviewConfiguration } from '../src/lib/google-review-store'
import { readInternalBody } from '../src/lib/internal-context'
import { GET, POST } from '../src/pages/api/interne/reponses-google'
const receipt = {
  version: 1,
  sourceKey: 'key',
  targets: [{ table: 'participations', id: 7, fields: ['date_debut_formation'] }],
  state: 'partial',
  reasons: ['Fin inconnue'],
  at: '2026-10-01T12:00:00Z',
}
const row = {
  Id: 1,
  cle_reponse: 'key',
  reponses: JSON.stringify([{ question: 'École', answer: '<script>source</script>' }]),
  statut_reprise: 'Source conservée — reprise initiale',
  detail_reprise: 'texte initial',
}
test('historical source-preserved status never claims integration or nonintegration', async () => {
  expect((await reviewView(row)).state).toBe('unknown')
  expect(
    reconciliation({ ...row, detail_reprise: `avant${OPEN}${JSON.stringify(receipt)}${CLOSE}` })
      ?.state,
  ).toBe('partial')
  expect(
    reconciliation({
      ...row,
      detail_reprise: `${OPEN}${JSON.stringify({ ...receipt, sourceKey: 'other' })}${CLOSE}`,
    }),
  ).toBeNull()
  expect((await reviewView(row)).answers[0].answer).toBe('<script>source</script>')
})
test('latest valid source-bound receipt wins; malformed receipts stay unknown', () => {
  const details = `${OPEN}${JSON.stringify(receipt)}${CLOSE}${OPEN}${JSON.stringify({ ...receipt, state: 'integrated' })}${CLOSE}`
  expect(reconciliation({ ...row, detail_reprise: details })?.state).toBe('integrated')
  expect(reconciliation({ ...row, detail_reprise: `${OPEN}{bad}${CLOSE}` })).toBeNull()
})
test('explicit confirmation and exact allowed fields required', async () => {
  const command = {
    id: 1,
    version: await reviewVersion(row),
    targetKind: 'school',
    targetId: 7,
    reason: 'source vérifiée',
    confirmed: true,
  }
  expect(parseReviewCommand(command).targetId).toBe(7)
  for (const patch of [
    { confirmed: false },
    { targetId: '7' },
    { targetId: -1 },
    { reason: '' },
    { state: 'integrated' },
    { targetKind: 'adults' },
  ])
    expect(() => parseReviewCommand({ ...command, ...patch })).toThrow()
})
function setup() {
  const sql = new Database(':memory:')
  sql.exec(
    'CREATE TABLE google_review_attachments(journal_id INTEGER PRIMARY KEY,source_key TEXT,state TEXT,audit_json TEXT,before_detail TEXT,after_detail TEXT)',
  )
  const db: any = {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        run: async () => ({ meta: { changes: sql.query(query).run(...args).changes } }),
        first: async () => sql.query(query).get(...args),
        all: async () => ({ results: sql.query(query).all(...args) }),
      }),
    }),
  }
  let current = { ...row },
    patches: any[] = []
  const client = async (path: string, method = 'GET', body?: any) => {
    if (method === 'PATCH') {
      patches.push(body)
      current = { ...current, ...body[0] }
      return body
    }
    if (path.endsWith('/records/1')) return { ...current }
    let list: any[] = []
    if (path.includes('mg12klh5zv7b5n5')) list = [{ Id: 3, nom: 'École test', ville: 'Ville' }]
    if (path.includes('mbunbu0f1zztce4'))
      list = [{ Id: 7, etablissements_id: 3, cohortes_id: 2, code: 'DOS-7' }]
    if (path.includes('m5ayop8ul8s040l')) list = [{ Id: 2, nom: '2026–2027' }]
    return { list, pageInfo: { isLastPage: true } }
  }
  return {
    ctx: { db, client, table: 'journaltest1234' },
    patches,
    sql,
    setRow: (value: any) => (current = value),
  }
}
test('confirmed attachment preserves source and history, patches no business field, records audit', async () => {
  const { ctx, patches, sql } = setup()
  const cmd = {
    id: 1,
    version: await reviewVersion(row),
    targetKind: 'school',
    targetId: 7,
    reason: 'Identité et cohorte confirmées',
    confirmed: true,
  }
  const result = await attachReview(ctx, cmd, 'responsable@example.test')
  expect(patches.length).toBe(1)
  expect(Object.keys(patches[0][0]).sort()).toEqual(['Id', 'detail_reprise'])
  expect(patches[0][0].detail_reprise.startsWith('texte initial\n')).toBe(true)
  expect(result.row.state).toBe('unknown')
  expect(result.row.attachment?.actor).toBe('responsable@example.test')
  expect(sql.query('SELECT state FROM google_review_attachments').get()).toEqual({
    state: 'complete',
  })
  await expect(attachReview(ctx, cmd, 'autre@example.test')).rejects.toThrow()
  expect(patches.length).toBe(1)
})
test('source change and unknown target refuse before any write', async () => {
  const { ctx, patches, setRow } = setup(),
    cmd = {
      id: 1,
      version: await reviewVersion(row),
      targetKind: 'school',
      targetId: 7,
      reason: 'Vérifié',
      confirmed: true,
    }
  setRow({ ...row, reponses: 'changed' })
  await expect(attachReview(ctx, cmd, 'a')).rejects.toThrow()
  setRow(row)
  await expect(attachReview(ctx, { ...cmd, targetId: 999 }, 'a')).rejects.toThrow()
  expect(patches.length).toBe(0)
})
test('ambiguous write retains durable pending claim and cannot be retried', async () => {
  const { ctx, sql } = setup(),
    original = ctx.client
  let writes = 0
  ctx.client = async (path, method = 'GET', body) => {
    if (method === 'PATCH') {
      writes++
      throw Error('timeout')
    }
    return original(path, method, body)
  }
  const cmd = {
    id: 1,
    version: await reviewVersion(row),
    targetKind: 'school',
    targetId: 7,
    reason: 'Vérifié',
    confirmed: true,
  }
  await expect(attachReview(ctx, cmd, 'a')).rejects.toThrow()
  await expect(attachReview(ctx, cmd, 'a')).rejects.toThrow()
  expect(writes).toBe(1)
  expect(sql.query('SELECT state FROM google_review_attachments').get()).toEqual({
    state: 'pending',
  })
})
test('configuration fails closed; CSRF rejects absent or foreign Origin', async () => {
  expect(() => reviewConfiguration({}, {} as any)).toThrow()
  for (const origin of ['', 'https://evil.test'])
    await expect(
      readInternalBody(
        new Request('https://euneos.fr/api/interne/reponses-google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin },
          body: '{}',
        }),
      ),
    ).rejects.toThrow()
  for (const route of [GET, POST]) {
    const response = await route({
      request: new Request('https://euneos.fr/api/interne/reponses-google'),
      locals: {},
    } as any)
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  }
})
test('bounded 429 retries, no retry on uncertain write and redirects forbidden', async () => {
  let calls = 0
  const delays: number[] = []
  const client = reviewClient(
    'secret',
    (async (_url: any, init: any) => {
      expect(init.redirect).toBe('manual')
      calls++
      return calls === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '2' } })
        : Response.json({ ok: true })
    }) as unknown as typeof fetch,
    async (ms) => {
      delays.push(ms)
    },
  )
  expect(await client('/tables/test/records')).toEqual({ ok: true })
  expect(calls).toBe(2)
  expect(delays).toContain(2000)
  let writes = 0
  const failing = reviewClient(
    'secret',
    (async () => {
      writes++
      return new Response('', { status: 503 })
    }) as unknown as typeof fetch,
    async () => {},
  )
  await expect(failing('/tables/test/records', 'PATCH', [])).rejects.toThrow()
  expect(writes).toBe(1)
})

test('two concurrent confirmations write once and keep one audit', async () => {
  const { ctx, patches, sql } = setup()
  const cmd = {
    id: 1,
    version: await reviewVersion(row),
    targetKind: 'school',
    targetId: 7,
    reason: 'Vérifié',
    confirmed: true,
  }
  const result = await Promise.allSettled([
    attachReview(ctx, cmd, 'a'),
    attachReview(ctx, cmd, 'b'),
  ])
  expect(result.filter((r) => r.status === 'fulfilled').length).toBe(1)
  expect(patches.length).toBe(1)
  expect(sql.query('SELECT count(*) AS total FROM google_review_attachments').get()).toEqual({
    total: 1,
  })
})

test('team JWT required, trainer audience rejected, nonadmins read only, public preview blocked', async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose')
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'google-review', alg: 'RS256', use: 'sig' }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: any) => {
    if (String(input) === 'https://google-review-test.cloudflareaccess.com/cdn-cgi/access/certs')
      return Response.json({ keys: [jwk] })
    throw Error('No business request expected')
  }) as unknown as typeof fetch
  try {
    const env = {
      INTERNAL_ACCESS_DOMAIN: 'google-review-test.cloudflareaccess.com',
      INTERNAL_ACCESS_AUD: 'team',
      INTERNAL_ADMIN_EMAILS: 'manager@example.test',
      TEAM_WORKSPACE: {},
    }
    const token = async (aud: string, email: string) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: 'RS256', kid: 'google-review' })
        .setIssuer('https://google-review-test.cloudflareaccess.com')
        .setAudience(aud)
        .setSubject('user')
        .setExpirationTime('5m')
        .sign(privateKey)
    const req = async (
      aud: string,
      email: string,
      host = 'euneos.fr',
      origin = 'https://euneos.fr',
    ) =>
      new Request(`https://${host}/api/interne/reponses-google`, {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': await token(aud, email),
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: '{}',
      })
    const locals = { runtime: { env } }
    expect(
      (await POST({ request: await req('trainer', 'manager@example.test'), locals } as any)).status,
    ).toBe(403)
    expect(
      (await POST({ request: await req('team', 'member@example.test'), locals } as any)).status,
    ).toBe(403)
    expect(
      (
        await POST({
          request: await req('team', 'manager@example.test', 'euneos.fr', 'https://evil.test'),
          locals,
        } as any)
      ).status,
    ).toBe(403)
    const preview = await POST({
      request: await req(
        'team',
        'manager@example.test',
        'pr-test.euneos-site.pages.dev',
        'https://pr-test.euneos-site.pages.dev',
      ),
      locals,
    } as any)
    expect(preview.status).toBe(403)
    expect(preview.headers.get('Cache-Control')).toContain('no-store')
    expect(
      (
        await GET({
          request: await req('team', 'manager@example.test', 'pr-test.euneos-site.pages.dev'),
          locals,
        } as any)
      ).status,
    ).toBe(403)
  } finally {
    globalThis.fetch = realFetch
  }
})
