import type { APIRoute } from 'astro'
import {
  entryId,
  getInternalContext,
  internalError,
  privateJson,
  readInternalBody,
} from '../../../lib/internal-context'
import { WorkspaceError } from '../../../lib/internal-workspace'
import { listTasks, saveTask } from '../../../lib/team-tasks'
export const prerender = false

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    return privateJson({ tasks: await listTasks(context.db) })
  } catch (error) {
    return internalError(error)
  }
}
const write: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const body = await readInternalBody(request)
    if (request.method === 'PATCH' && body.version === undefined)
      throw new WorkspaceError(400, 'Version requise.')
    const task = await saveTask(
      context.db,
      context.identity,
      entryId(body.id),
      body.task,
      request.method === 'PATCH' ? body.version : undefined,
    )
    return privateJson({ task }, request.method === 'POST' ? 201 : 200)
  } catch (error) {
    return internalError(error)
  }
}
export const POST = write
export const PATCH = write
