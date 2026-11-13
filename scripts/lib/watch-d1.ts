import { d1Http } from '../../src/lib/d1-http'
import type { WorkspaceDatabase } from '../../src/lib/internal-workspace'

// Only the encrypted watch transport can submit these atomic insert-only batches.
// D1 /query accepts a semicolon-separated SQL batch in one transaction, as in
// the existing internal-migrations transport. Never issue sequential writes.
export function watchD1(
  account: string,
  database: string,
  token: string,
  fetcher = fetch,
): WorkspaceDatabase {
  const base = d1Http(account, database, token, fetcher)
  const statements = new WeakMap<object, string>()
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const bound = base.prepare(sql).bind(...values)
          let index = 0
          const compiled = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (match) => {
            if (match !== '?') return match
            if (index >= values.length) throw new Error('Paramètre manquant')
            const v = values[index++]
            if (v === null) return 'NULL'
            if (typeof v === 'string') return "'" + v.replaceAll("'", "''") + "'"
            if (typeof v === 'number' && Number.isFinite(v)) return String(v)
            throw new Error('Paramètre invalide')
          })
          if (index !== values.length) throw new Error('Paramètres surnuméraires')
          statements.set(bound, compiled)
          return bound
        },
      }
    },
    async batch(bound) {
      const sql = bound
        .map((statement) => {
          const query = statements.get(statement)
          if (!query) throw new Error('Requête étrangère au lot')
          return query.replace(/;\s*$/, '')
        })
        .join(';\n')
      const response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        },
      )
      const body = (await response.json()) as any
      if (
        !response.ok ||
        !body.success ||
        !Array.isArray(body.result) ||
        body.result.length !== bound.length ||
        body.result.some((r: any) => r.success === false)
      )
        throw new Error('Lot D1 non confirmé')
      return body.result.map((r: any) => ({ meta: { changes: r.meta?.changes ?? 0 } }))
    },
  }
}
