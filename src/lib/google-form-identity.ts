import { digest } from './google-form-sync'

export type IdentityReceipt = {
  source_row: number
  revision: number
  fingerprint: string
  raw_payload: string
  response_key: string
}
export type IdentityRow<T extends IdentityReceipt> = {
  row: number
  /** Immutable lineage number; deliberately no longer a physical Sheet row. */
  logicalRow: number
  fingerprint: string
  timestamp: string
  previous?: T
  maxRevision: number
  ambiguous: boolean
}

/** Sheets exports have no immutable Google response ID. Reconcile the COMPLETE
 * snapshot as a multiset, never by physical row, email or a set of hashes.
 * Keep the original timestamp of each lineage. Legacy sort-induced revisions
 * that copied another response into that lineage remain evidence, not identities.
 * Matching equal payloads consumes one identity at a time, preserving multiplicity.
 * An unresolved timestamp collision is captured separately, never auto-projected.
 */
export async function reconcileGoogleRows<T extends IdentityReceipt>(
  rows: { row: number; timestamp: string; fields: unknown }[],
  receipts: T[],
  firstRow: number,
): Promise<IdentityRow<T>[]> {
  const stampKey = (value: string) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
    return m
      ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}`
      : value
  }
  const lineages = new Map<number, T[]>()
  for (const receipt of receipts) {
    const history = lineages.get(receipt.source_row) ?? []
    history.push(receipt)
    lineages.set(receipt.source_row, history)
  }
  const buckets = new Map<string, { latest: T; max: number }[]>()
  for (const history of lineages.values()) {
    history.sort((a, b) => a.revision - b.revision)
    const stamp = JSON.parse(history[0].raw_payload).timestamp
    if (typeof stamp !== 'string' || !stamp.trim()) throw new Error('identity_history_invalid')
    const sameIdentity = history.filter(
      (r) => stampKey(JSON.parse(r.raw_payload).timestamp) === stampKey(stamp),
    )
    const list = buckets.get(stampKey(stamp)) ?? []
    list.push({ latest: sameIdentity.at(-1)!, max: history.at(-1)!.revision })
    buckets.set(stampKey(stamp), list)
  }
  const current = await Promise.all(
    rows.map(async (r) => ({ ...r, fingerprint: await digest(JSON.stringify(r.fields)) })),
  )
  const byStamp = new Map<string, typeof current>()
  for (const row of current) {
    const list = byStamp.get(stampKey(row.timestamp)) ?? []
    list.push(row)
    byStamp.set(stampKey(row.timestamp), list)
  }
  let next = Math.max(firstRow - 1, ...lineages.keys()) + 1
  const result: IdentityRow<T>[] = []
  for (const [stamp, group] of byStamp) {
    const prior = [...(buckets.get(stampKey(stamp)) ?? [])].sort(
      (a, b) => a.latest.source_row - b.latest.source_row,
    )
    const left = [...group]
    const assign = (r: (typeof current)[number], p: (typeof prior)[number]) => {
      result.push({
        row: r.row,
        logicalRow: p.latest.source_row,
        fingerprint: r.fingerprint,
        timestamp: stamp,
        previous: p.latest,
        maxRevision: p.max,
        ambiguous: false,
      })
      prior.splice(prior.indexOf(p), 1)
      left.splice(left.indexOf(r), 1)
    }
    // Match all exact content first, across the entire snapshot (not scan window).
    for (const r of group) {
      const p = prior.find((p) => p.latest.fingerprint === r.fingerprint)
      if (p) assign(r, p)
    }
    // One remaining response and lineage permits an edit, including A -> B -> A.
    if (left.length === 1 && prior.length === 1) assign(left[0], prior[0])
    for (const r of left)
      result.push({
        row: r.row,
        logicalRow: next++,
        fingerprint: r.fingerprint,
        timestamp: stamp,
        maxRevision: 0,
        ambiguous: prior.length > 0 || group.length > 1,
      })
  }
  // A replaced timestamp at an occupied position cannot prove a new response:
  // it may be an edited old timestamp. Preserve it, but never auto-project it.
  const assigned = new Set(result.filter((r) => r.previous).map((r) => r.logicalRow))
  const disappearedPositions = new Set(
    [...lineages.entries()]
      .filter(([logical]) => !assigned.has(logical))
      .map(([logical, history]) => {
        const payload = JSON.parse(history.at(-1)!.raw_payload)
        return typeof payload.physicalRow === 'number' ? payload.physicalRow : logical
      }),
  )
  for (const row of result)
    if (!row.previous && disappearedPositions.has(row.row)) row.ambiguous = true
  return result.sort((a, b) => a.row - b.row)
}
