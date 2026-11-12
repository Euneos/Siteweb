import type { WorkspaceDatabase } from './internal-workspace'
import type { lireCartePublique } from './public-network'

type Network = Awaited<ReturnType<typeof lireCartePublique>>
type Row = {payload: string | null; refreshed_at: number; lease_until: number}
type Snapshot = {data: Network; refreshedAt: number}
type Options = {now?: () => number; wait?: (ms: number) => Promise<void>; background?: (work: Promise<unknown>) => void}
const KEY = 'network-v1'
const FRESH = 60_000
const LEASE = 240_000
const RETRY = 30_000

/** Shared anonymous snapshot; one refresh across all visitors, pages and Worker instances. */
export async function readPublicNetworkSnapshot(db: WorkspaceDatabase, load: () => Promise<Network>, options: Options = {}): Promise<Snapshot> {
  const now = options.now ?? Date.now
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  await db.prepare('INSERT INTO public_network_snapshots (id) VALUES (?) ON CONFLICT(id) DO NOTHING').bind(KEY).run()
  const read = () => db.prepare('SELECT payload, refreshed_at, lease_until FROM public_network_snapshots WHERE id = ?').bind(KEY).first<Row>()
  for (let attempt = 0; attempt < 60; attempt++) {
    const row = await read()
    const cached = row?.payload ? {data:JSON.parse(row.payload) as Network,refreshedAt:row.refreshed_at} : null
    if (cached && now() - cached.refreshedAt < FRESH) return cached
    const token = crypto.randomUUID()
    const claimed = await db.prepare('UPDATE public_network_snapshots SET lease_token = ?, lease_until = ? WHERE id = ? AND lease_until <= ? AND refreshed_at = ? RETURNING id')
      .bind(token, now() + LEASE, KEY, now(), row?.refreshed_at ?? 0).first<{id:string}>()
    if (claimed) {
      const refresh = async (): Promise<Snapshot> => {
        try {
          const data = await load()
          const refreshedAt = now()
          const result = await db.prepare('UPDATE public_network_snapshots SET payload = ?, refreshed_at = ?, lease_until = 0, lease_token = NULL WHERE id = ? AND lease_token = ?')
            .bind(JSON.stringify(data),refreshedAt,KEY,token).run()
          if (result.meta.changes !== 1) throw new Error('Public network refresh lease expired')
          return {data,refreshedAt}
        } catch (error) {
          await db.prepare('UPDATE public_network_snapshots SET lease_until = ?, lease_token = NULL WHERE id = ? AND lease_token = ?')
            .bind(now() + RETRY,KEY,token).run()
          // Never log NocoDB response bodies or personal records.
          const status = error instanceof Error ? error.message.match(/^NocoDB (\d{3}) /)?.[1] : undefined
          console.warn('[public-network] refresh unavailable', status ?? 'source_or_storage')
          if (cached) return cached
          throw error
        }
      }
      const work = refresh()
      if (cached && options.background) { options.background(work); return cached }
      return work
    }
    if (cached) return cached
    // Cold start: wait for the one owner, rather than start another NocoDB read.
    await wait(1000)
  }
  throw new Error('Public network initial refresh still pending')
}
