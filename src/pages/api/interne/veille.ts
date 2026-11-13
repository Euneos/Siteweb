import type { APIRoute } from 'astro'
import {
  getInternalContext,
  privateJson,
  internalError,
  readInternalBody,
  entryId,
} from '../../../lib/internal-context'
import { WorkspaceError } from '../../../lib/internal-workspace'
import { watchSnapshot, saveWatch, deleteWatch } from '../../../lib/thematic-watch'
export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    return privateJson(await watchSnapshot(c.db))
  } catch (e) {
    return internalError(e)
  }
}
const write: APIRoute = async ({ request, locals }) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    const b = await readInternalBody(request)
    const result = await saveWatch(
      c.db,
      b.item,
      c.identity.email,
      request.method === 'PATCH' ? { id: entryId(b.id), version: b.version } : {},
    )
    return privateJson(result, request.method === 'POST' ? 201 : 200)
  } catch (e) {
    return internalError(e)
  }
}
export const POST = write
export const PATCH = write
export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    const b = await readInternalBody(request)
    if (b.confirmed !== true) throw new WorkspaceError(400, 'Confirmez la suppression.')
    await deleteWatch(c.db, entryId(b.id), b.version, c.identity.email)
    return privateJson({ deleted: true })
  } catch (e) {
    return internalError(e)
  }
}
