import { createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { parseEntry } from '../../src/lib/internal-workspace'

// Offline staging only. Never fetches Notion, changes source pages, or writes D1.
// Keep the original export separately: normalized fields are not the full source.
const required = (value: unknown, name: string, max = 6000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0'))
    throw new Error(`Invalid ${name}`)
  return value.trim()
}
const timestamp = (value: unknown) => {
  const result = required(value, 'timestamp', 32)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)
  )
    throw new Error('Invalid timestamp')
  return result
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object')
  return value as Record<string, unknown>
}
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const stableId = (s: string) => {
  const h = hash(s)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function importWorkspaceSnapshot(db: Database, input: unknown) {
  const snapshot = object(input)
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.entries))
    throw new Error('Expected schemaVersion 1 and entries array')
  timestamp(snapshot.exportedAt)
  const seen = new Set<string>(),
    commentsSeen = new Set<string>()
  const normalized = snapshot.entries.map((raw) => {
    const row = object(raw),
      sourceId = required(row.sourceId, 'sourceId', 200)
    if (seen.has(sourceId)) throw new Error('Duplicate sourceId in snapshot')
    seen.add(sourceId)
    const entry = parseEntry(row.entry)
    const author = required(row.author, 'author', 200),
      createdAt = timestamp(row.createdAt)
    // Missing comments is not equivalent to a verified empty list.
    if (!Array.isArray(row.comments))
      throw new Error('Comments must be explicitly supplied for each entry')
    const comments = row.comments
      .map((rawComment) => {
        const c = object(rawComment),
          sourceId = required(c.sourceId, 'comment sourceId', 200)
        if (commentsSeen.has(sourceId)) throw new Error('Duplicate comment sourceId')
        commentsSeen.add(sourceId)
        return {
          sourceId,
          author: required(c.author, 'comment author', 200),
          content: required(c.content, 'comment content'),
          createdAt: timestamp(c.createdAt),
        }
      })
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    // Preserve all original properties, including caps/location/media not mapped
    // to the first UI. They must be reviewed before a production cutover.
    const original = object(row.original)
    const sourcePayload = stableJson({ original, entry, author, createdAt, comments })
    return {
      sourceId,
      entry,
      author,
      createdAt,
      comments,
      sourcePayload,
      fingerprint: hash(sourcePayload),
    }
  })
  let inserted = 0,
    skipped = 0,
    insertedComments = 0
  db.transaction(() => {
    for (const row of normalized) {
      const previous = db
        .query('SELECT source_fingerprint FROM workspace_entries WHERE source_id=?')
        .get(row.sourceId) as { source_fingerprint: string } | null
      if (previous) {
        if (previous.source_fingerprint !== row.fingerprint)
          throw new Error(`Source changed: ${row.sourceId}. Reconcile before reimporting.`)
        skipped++
        continue // Also preserves edits made in the destination.
      }
      const id = stableId(`entry:${row.sourceId}`),
        e = row.entry
      db.query(
        `INSERT INTO workspace_entries (id,kind,title,starts_on,ends_on,person,activity,channel,attendance,location,status,hours,notes,content,link,created_by,updated_by,source_id,source_payload,source_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        e.kind,
        e.title,
        e.starts_on,
        e.ends_on,
        e.person,
        e.activity,
        e.channel,
        e.attendance,
        e.location,
        e.status,
        e.hours,
        e.notes,
        e.content,
        e.link,
        row.author,
        row.author,
        row.sourceId,
        row.sourcePayload,
        row.fingerprint,
        row.createdAt,
        row.createdAt,
      )
      for (const c of row.comments)
        db.query(
          'INSERT INTO workspace_comments (id,entry_id,author,content,created_at) VALUES (?,?,?,?,?)',
        ).run(stableId(`comment:${c.sourceId}`), id, c.author, c.content, c.createdAt)
      inserted++
      insertedComments += row.comments.length
    }
  })()
  return { entries: normalized.length, inserted, skipped, comments: insertedComments }
}
