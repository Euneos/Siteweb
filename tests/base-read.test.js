import { test, expect } from 'bun:test'

test('NocoDB pagination includes the second page despite a server-clamped page size', async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.NOCODB_TOKEN
  process.env.NOCODB_TOKEN = 'test-only'
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(url)
    const offset = Number(new URL(url).searchParams.get('offset'))
    return Response.json({
      list: Array.from({ length: offset === 0 ? 100 : 5 }, (_, i) => ({ Id: offset + i + 1 })),
      pageInfo: { isLastPage: offset !== 0, totalRows: 105 },
    })
  }
  try {
    const { lire } = await import('../scripts/base.mjs')
    const rows = await lire('engagements', '&fields=Id,statut')
    expect(rows).toHaveLength(105)
    expect(rows.at(-1).Id).toBe(105)
    expect(new URL(urls[1]).searchParams.get('offset')).toBe('100')
    expect(new URL(urls[1]).searchParams.get('fields')).toBe('Id,statut')
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken == null) delete process.env.NOCODB_TOKEN
    else process.env.NOCODB_TOKEN = originalToken
  }
})
