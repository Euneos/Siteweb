import type { APIRoute } from 'astro'
import {
  entryId,
  getInternalContext,
  internalEnvironment,
  internalError,
  privateHeaders,
  privateJson,
} from '../../../lib/internal-context'
import { WorkspaceError } from '../../../lib/internal-workspace'
import {
  deleteEditorialImage,
  imageKey,
  readImageBytes,
  readImageSlot,
  requireEditorialEntry,
  saveEditorialImage,
  type ImageBucket,
} from '../../../lib/editorial-images'
export const prerender = false

const handle: APIRoute = async ({ request, locals }) => {
  try {
    // Authenticate first, including raw image responses and direct pages.dev URLs.
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const url = new URL(request.url)
    const id = entryId(url.searchParams.get('entryId'))
    const writing = request.method !== 'GET'
    let version = 0
    if (writing) {
      if (
        request.headers.get('Origin') !== url.origin ||
        request.headers.get('Sec-Fetch-Site') === 'cross-site'
      )
        throw new WorkspaceError(403, 'Rechargez cette page avant de réessayer.')
      const match = /^"(0|[1-9]\d*)"$/.exec(request.headers.get('If-Match') ?? '')
      version = match ? Number(match[1]) : NaN
      if (!Number.isSafeInteger(version))
        throw new WorkspaceError(428, 'Actualisez le visuel avant de le modifier.')
    }
    await requireEditorialEntry(context.db, id)
    const bucket = internalEnvironment(locals).EDITORIAL_IMAGES as ImageBucket | undefined
    if (!bucket)
      throw new WorkspaceError(
        503,
        'L’ajout de visuels est en préparation. Le reste de la fiche reste disponible.',
      )
    const slot = await readImageSlot(context.db, id)
    if (writing && slot.version !== version)
      throw new WorkspaceError(
        409,
        'Le visuel a changé. Actualisez-le avant de réessayer ; votre sélection est conservée.',
      )
    if (request.method === 'PUT') {
      const result = await saveEditorialImage(
        context.db,
        bucket,
        id,
        version,
        await readImageBytes(request),
      )
      return privateJson(result)
    }
    if (request.method === 'DELETE')
      return privateJson(await deleteEditorialImage(context.db, bucket, id, version))
    if (!url.searchParams.has('imageId')) return privateJson(slot)
    // Old/replaced URLs stop working; knowing an object UUID grants no access.
    if (slot.image?.id !== entryId(url.searchParams.get('imageId')))
      throw new WorkspaceError(404, 'Visuel introuvable.')
    const object = await bucket.get(imageKey(slot.image.id))
    if (!object) throw new WorkspaceError(503, 'Le visuel est temporairement indisponible.')
    return new Response(object.body, {
      headers: {
        ...privateHeaders,
        'Content-Type': slot.image.content_type,
        'Content-Length': String(object.size),
        'Content-Disposition': `inline; filename="visuel.${slot.image.content_type === 'image/png' ? 'png' : 'jpg'}"`,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    })
  } catch (error) {
    return internalError(error)
  }
}
export const GET = handle
export const PUT = handle
export const DELETE = handle
