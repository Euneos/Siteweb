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
import {
  attachReview,
  listReviews,
  reviewClient,
  reviewConfiguration,
} from '../src/lib/google-review-store'
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
    if (method !== 'GET') {
      patches.push(body)
      current = { ...current, ...body[0] }
      return body
    }
    if (path.endsWith('/records/1')) return { ...current }
    let list: any[] = path.includes('journaltest1234') ? [{ ...current }] : []
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
test('attachment is durable in D1 only, refresh restores it without changing receipt state', async () => {
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
  expect(patches).toHaveLength(0)
  expect(
    sql.query('SELECT before_detail,after_detail FROM google_review_attachments').get(),
  ).toEqual({ before_detail: row.detail_reprise, after_detail: row.detail_reprise })
  const refreshed = (await listReviews(ctx)).rows[0]
  expect(refreshed.attachment).toEqual(result.row.attachment)
  expect(refreshed.detail).toBe(row.detail_reprise)
  expect(refreshed.state).toBe('unknown')
  expect(result.row.state).toBe('unknown')
  expect(result.row.attachment?.actor).toBe('responsable@example.test')
  expect(sql.query('SELECT state FROM google_review_attachments').get()).toEqual({
    state: 'complete',
  })
  await expect(attachReview(ctx, cmd, 'autre@example.test')).rejects.toThrow()
  expect(patches.length).toBe(0)
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
const command = async (source = row) => ({
  id: 1,
  version: await reviewVersion(source),
  targetKind: 'school',
  targetId: 7,
  reason: 'Identité vérifiée',
  confirmed: true,
})
test('collector receipt written after the final read survives attachment without a NocoDB write', async () => {
  const { ctx, patches, setRow } = setup()
  const original = ctx.client
  let reads = 0
  const updated = {
    ...row,
    detail_reprise: `texte initial${OPEN}${JSON.stringify(receipt)}${CLOSE}`,
  }
  ctx.client = async (path, method = 'GET', body) => {
    const result = await original(path, method, body)
    if (path.endsWith('/records/1') && ++reads === 2) setRow(updated)
    return result
  }
  await attachReview(ctx, await command(), 'manager@example.test')
  const refreshed = (await listReviews(ctx)).rows[0]
  expect(patches).toHaveLength(0)
  expect(refreshed.detail).toBe(updated.detail_reprise)
  expect(refreshed.receipt?.targets).toEqual(receipt.targets)
  expect(refreshed.state).toBe('partial')
  expect(refreshed.attachment?.target.id).toBe(7)
})
test('source drift before insert leaves no claim and permits refreshed confirmation', async () => {
  const { ctx, sql, patches, setRow } = setup()
  const original = ctx.client
  let reads = 0
  const updated = { ...row, detail_reprise: 'Un reçu arrivé pendant la vérification' }
  ctx.client = async (path, method = 'GET', body) => {
    if (path.endsWith('/records/1') && ++reads === 2) setRow(updated)
    return original(path, method, body)
  }
  await expect(attachReview(ctx, await command(), 'manager@example.test')).rejects.toThrow(
    'Aucun rattachement',
  )
  expect(sql.query('SELECT count(*) AS n FROM google_review_attachments').get()).toEqual({ n: 0 })
  await attachReview(ctx, await command(updated), 'manager@example.test')
  expect(sql.query('SELECT state FROM google_review_attachments').get()).toEqual({
    state: 'complete',
  })
  expect(patches).toHaveLength(0)
})
test('lost D1 commit response is recovered on read and replay preserves the original audit', async () => {
  const { ctx, sql, patches } = setup()
  const prepare = ctx.db.prepare
  let loseResponse = true
  ctx.db.prepare = (query: string) => {
    if (!query.startsWith('INSERT')) return prepare(query)
    return {
      bind: (...args: any[]) => {
        const bound = prepare(query).bind(...args)
        return {
          ...bound,
          run: async () => {
            const result = await bound.run()
            if (loseResponse) {
              loseResponse = false
              throw Error('D1 response lost after commit')
            }
            return result
          },
        }
      },
    }
  }
  const cmd = await command()
  await expect(attachReview(ctx, cmd, 'first@example.test')).rejects.toThrow('response lost')
  const saved = sql.query('SELECT * FROM google_review_attachments').get()
  const refreshed = (await listReviews(ctx)).rows[0]
  expect(refreshed.attachment?.actor).toBe('first@example.test')
  expect(refreshed.operation?.state).toBe('complete')
  await expect(attachReview(ctx, cmd, 'second@example.test')).rejects.toThrow(
    'Un rattachement existe',
  )
  expect(sql.query('SELECT * FROM google_review_attachments').get()).toEqual(saved)
  expect(patches).toHaveLength(0)
})
test('D1 failure before commit leaves no reservation and retry can succeed', async () => {
  const { ctx, sql } = setup(),
    prepare = ctx.db.prepare
  ctx.db.prepare = (query: string) =>
    query.startsWith('INSERT')
      ? {
          bind: () => ({
            run: async () => {
              throw Error('Unavailable before commit')
            },
          }),
        }
      : prepare(query)
  await expect(attachReview(ctx, await command(), 'a')).rejects.toThrow()
  expect(sql.query('SELECT count(*) AS n FROM google_review_attachments').get()).toEqual({ n: 0 })
  ctx.db.prepare = prepare
  await attachReview(ctx, await command(), 'a')
  expect((await listReviews(ctx)).rows[0].attachment?.actor).toBe('a')
})
test('legacy pending remains blocked, malformed or foreign-source complete audit proves nothing', async () => {
  for (const [state, sourceKey, audit] of [
    ['pending', 'key', '{}'],
    ['complete', 'foreign', '{}'],
    ['complete', 'key', '{bad'],
  ]) {
    const { ctx, sql, patches } = setup()
    sql
      .query('INSERT INTO google_review_attachments VALUES (?,?,?,?,?,?)')
      .run(1, sourceKey, state, audit, 'before', 'after')
    const view = (await listReviews(ctx)).rows[0]
    expect(view.attachment).toBeNull()
    expect(view.operation?.state).toBe('pending')
    await expect(attachReview(ctx, await command(), 'a')).rejects.toThrow()
    expect(sql.query('SELECT state FROM google_review_attachments').get()).toEqual({ state })
    expect(patches).toHaveLength(0)
  }
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
  expect(patches.length).toBe(0)
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

test('receipt table IDs and names resolve exact school/trainer dossiers and adult relations', async () => {
  const { resolveReconciliationTargets } = await import('../src/lib/google-review')
  const tables = {
    participations: 'tableparts',
    engagements: 'tabletrainers',
    adults: 'tableadults',
  }
  const dossiers = [
    { kind: 'school' as const, id: 7, label: 'École de la Colline — Ville — 2026–2027 — DOS-7' },
    { kind: 'trainer' as const, id: 7, label: 'Alex Fictif — parcours #7' },
  ]
  const result = resolveReconciliationTargets(
    {
      ...receipt,
      version: 1,
      state: 'partial',
      targets: [
        { table: 'tableadults', id: 21, fields: ['date_pre_recu'] },
        { table: 'tableparts', id: 7, fields: ['adultes'] },
        { table: 'tabletrainers', id: 7, fields: ['accord_signe'] },
      ],
    },
    dossiers,
    [{ Id: 21, prenom: 'Camille', nom: 'Exemple', participations_id: 7 }],
    tables,
  )
  expect(result[0].label).toContain('Camille Exemple — École de la Colline')
  expect(result[1].label).toBe(dossiers[0].label)
  expect(result[2].label).toBe(dossiers[1].label)
  const alias = resolveReconciliationTargets(
    {
      ...receipt,
      version: 1,
      state: 'partial',
      targets: [
        { table: 'adults', id: 21, fields: [] },
        { table: 'participations', id: 99, fields: [] },
      ],
    },
    dossiers,
    [{ Id: 21, prenom: 'Camille', nom: 'Exemple', participations_id: 7 }],
    tables,
  )
  expect(alias[0].label).toContain('École de la Colline')
  expect(alias[1].label).toContain('nom non résolu')
})
