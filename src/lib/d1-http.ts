import type { WorkspaceDatabase } from './internal-workspace'

type Value = string | number | null | ArrayBuffer | Uint8Array
type QueryResult = { results: unknown[]; meta?: { changes?: number } }

/**
 * La base D1 des calendriers, vue depuis un poste de l'équipe (agent ou
 * terminal) : même interface que la liaison Cloudflare utilisée par les
 * pages internes, pour que les règles de `internal-workspace` s'appliquent
 * à l'identique. Passe par l'API HTTP de Cloudflare, avec un jeton limité à D1.
 */
export function d1Http(accountId: string, databaseId: string, token: string, fetchImpl: typeof fetch = fetch): WorkspaceDatabase {
  const query = async (sql: string, params: Value[]): Promise<QueryResult> => {
    if (params.some(value => value instanceof ArrayBuffer || value instanceof Uint8Array))
      throw new Error('Les documents binaires ne sont accessibles que depuis le site privé.')
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      },
    )
    const body = (await response.json().catch(() => null)) as {
      success?: boolean
      errors?: { message: string }[]
      result?: QueryResult[]
    } | null
    if (!response.ok || !body?.success || !body.result?.[0])
      throw new Error(`Base des calendriers injoignable : ${body?.errors?.map((e) => e.message).join(' ; ') || response.status}`)
    return body.result[0]
  }
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            all: async <T>() => ({ results: (await query(sql, values)).results as T[] }),
            first: async <T>() => ((await query(sql, values)).results[0] as T | undefined) ?? null,
            run: async () => ({ meta: { changes: (await query(sql, values)).meta?.changes ?? 0 } }),
          }
        },
      }
    },
    async batch() {
      // Seule la suppression groupe ses requêtes ; elle reste réservée aux pages internes.
      throw new Error('Opération indisponible depuis le poste : supprimer une fiche se fait dans l’espace interne.')
    },
  }
}
