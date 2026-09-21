import type { APIRoute } from 'astro'
import {
  getInternalContext,
  privateJson,
  internalError,
  readInternalBody,
  entryId,
} from '../../../lib/internal-context'
import { listEntries, getEntry, hoursByPerson, saveEntry } from '../../../lib/internal-workspace'
export const prerender = false

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const url = new URL(request.url)
    if (url.searchParams.has('entryId')) {
      const entry = await getEntry(context.db, entryId(url.searchParams.get('entryId')))
      return privateJson({ entry, identity: context.identity })
    }
    const entries = await listEntries(
      context.db,
      url.searchParams.get('month') ?? '',
      url.searchParams.get('kind') ?? '',
    )
    return privateJson({ entries, totals: hoursByPerson(entries), identity: context.identity })
  } catch (error) {
    return internalError(error)
  }
}
const write: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const body = await readInternalBody(request)
    const id = request.method === 'PATCH' ? entryId(body.id) : undefined
    const savedId = await saveEntry(
      context.db,
      context.identity,
      body.entry,
      id,
      body.version as number | undefined,
      id ? undefined : entryId(body.requestId),
    )
    return privateJson({ id: savedId }, id ? 200 : 201)
  } catch (error) {
    return internalError(error)
  }
}
export const POST = write
export const PATCH = write
