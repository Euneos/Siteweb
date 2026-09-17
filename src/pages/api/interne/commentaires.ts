import type { APIRoute } from 'astro'
import {
  getInternalContext,
  privateJson,
  internalError,
  readInternalBody,
  entryId,
} from '../../../lib/internal-context'
import { comments, addComment } from '../../../lib/internal-workspace'
export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    return privateJson({
      comments: await comments(
        context.db,
        entryId(new URL(request.url).searchParams.get('entryId')),
      ),
    })
  } catch (error) {
    return internalError(error)
  }
}
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const body = await readInternalBody(request)
    await addComment(
      context.db,
      context.identity,
      entryId(body.entryId),
      body.content,
      entryId(body.requestId),
    )
    return privateJson({ saved: true }, 201)
  } catch (error) {
    return internalError(error)
  }
}
