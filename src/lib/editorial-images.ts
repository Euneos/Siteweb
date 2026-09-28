import { getEntry, WorkspaceError, type WorkspaceDatabase } from './internal-workspace'
import { MAX_IMAGE_BYTES, prepareEditorialImage } from './editorial-image-format'

export interface ImageBucket {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string; cacheControl: string } },
  ): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>
  delete(key: string): Promise<void>
}
export type ImageSlot = {
  version: number
  image: null | {
    id: string
    content_type: string
    size: number
    width: number
    height: number
  }
}
export const imageKey = (id: string) => `editorial/${id}`
const conflict = () =>
  new WorkspaceError(
    409,
    'Le visuel a changé. Actualisez-le avant de réessayer ; votre sélection est conservée.',
  )
export async function requireEditorialEntry(db: WorkspaceDatabase, entryId: string) {
  // Existing permissions: every authenticated team member may edit editorial entries.
  if ((await getEntry(db, entryId)).kind !== 'editorial')
    throw new WorkspaceError(403, 'Les visuels sont réservés aux fiches éditoriales.')
}
export async function readImageSlot(db: WorkspaceDatabase, entryId: string): Promise<ImageSlot> {
  const row = await db
    .prepare(
      `SELECT s.version, i.id, i.content_type, i.size, i.width, i.height
    FROM workspace_entry_images s LEFT JOIN workspace_images i ON i.id=s.image_id
    WHERE s.entry_id=?`,
    )
    .bind(entryId)
    .first<ImageSlot['image'] & { version: number }>()
  if (!row) return { version: 0, image: null }
  const { version, ...image } = row
  return { version, image: image.id ? image : null }
}
export async function readImageBytes(request: Request) {
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_IMAGE_BYTES)
    throw new WorkspaceError(413, 'Choisissez une image de 5 Mo maximum.')
  const reader = request.body?.getReader()
  if (!reader) throw new WorkspaceError(400, 'Image absente.')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel()
        throw new WorkspaceError(413, 'Choisissez une image de 5 Mo maximum.')
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return prepareEditorialImage(bytes, request.headers.get('Content-Type') ?? '')
}
/** Retired objects cannot be reattached. A failed delete stays queued for the next
 * write. Pending objects after an ambiguous failure require operator reconciliation. */
export async function cleanRetiredImages(db: WorkspaceDatabase, bucket: ImageBucket) {
  try {
    const { results } = await db
      .prepare("SELECT id FROM workspace_images WHERE state='retired' ORDER BY created_at LIMIT 10")
      .bind()
      .all<{ id: string }>()
    for (const { id } of results) {
      await bucket.delete(imageKey(id))
      await db.prepare("DELETE FROM workspace_images WHERE id=? AND state='retired'").bind(id).run()
    }
    const remaining = await db
      .prepare("SELECT id FROM workspace_images WHERE state='retired' LIMIT 1")
      .bind()
      .first()
    return !remaining
  } catch {
    return false
  }
}
export async function saveEditorialImage(
  db: WorkspaceDatabase,
  bucket: ImageBucket,
  entryId: string,
  version: number,
  image: Awaited<ReturnType<typeof readImageBytes>>,
) {
  const id = crypto.randomUUID()
  // Record the candidate before touching R2: even ambiguous failures are traceable.
  await db
    .prepare(
      'INSERT INTO workspace_images (id,entry_id,content_type,size,width,height) VALUES (?,?,?,?,?,?)',
    )
    .bind(id, entryId, image.contentType, image.bytes.length, image.width, image.height)
    .run()
  await bucket.put(imageKey(id), image.bytes, {
    httpMetadata: { contentType: image.contentType, cacheControl: 'private, no-store' },
  })
  // Do not delete the candidate on a thrown/ambiguous database response: the
  // pointer may have committed. Only a confirmed CAS failure makes it disposable.
  const result =
    version === 0
      ? await db
          .prepare(
            'INSERT INTO workspace_entry_images (entry_id,image_id) VALUES (?,?) ON CONFLICT(entry_id) DO NOTHING RETURNING version',
          )
          .bind(entryId, id)
          .first<{ version: number }>()
      : await db
          .prepare(
            'UPDATE workspace_entry_images SET image_id=?, version=version+1 WHERE entry_id=? AND version=? RETURNING version',
          )
          .bind(id, entryId, version)
          .first<{ version: number }>()
  if (!result) {
    await db
      .prepare("UPDATE workspace_images SET state='retired' WHERE id=? AND state='pending'")
      .bind(id)
      .run()
    await cleanRetiredImages(db, bucket)
    throw conflict()
  }
  const cleanupComplete = await cleanRetiredImages(db, bucket)
  return {
    version: version + 1,
    image: {
      id,
      content_type: image.contentType,
      size: image.bytes.length,
      width: image.width,
      height: image.height,
    },
    cleanupComplete,
  }
}
export async function deleteEditorialImage(
  db: WorkspaceDatabase,
  bucket: ImageBucket,
  entryId: string,
  version: number,
) {
  const result = await db
    .prepare(
      'UPDATE workspace_entry_images SET image_id=NULL, version=version+1 WHERE entry_id=? AND version=? AND image_id IS NOT NULL RETURNING version',
    )
    .bind(entryId, version)
    .first<{ version: number }>()
  if (!result) throw conflict()
  return {
    version: version + 1,
    image: null,
    cleanupComplete: await cleanRetiredImages(db, bucket),
  }
}
