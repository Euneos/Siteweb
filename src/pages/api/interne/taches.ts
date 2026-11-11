import type { APIRoute } from 'astro'
import {
  entryId,
  getInternalContext,
  internalError,
  privateJson,
  readInternalBody,
  internalEnvironment,
} from '../../../lib/internal-context'
import { WorkspaceError } from '../../../lib/internal-workspace'
import { listTasks, saveTask, deleteTask } from '../../../lib/team-tasks'
import { notifyTaskAssignment, type NotificationState } from '../../../lib/team-task-notifications'
export const prerender = false

export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    return privateJson({
      tasks: await listTasks(context.db),
      deletedTasks: await listTasks(context.db, true),
    })
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
    let notification: NotificationState = 'uncertain'
    try {
      notification = await notifyTaskAssignment(
        context.db,
        internalEnvironment(locals),
        task.id,
        request.method === 'PATCH' ? (body.version as number) + 1 : 1,
        new URL(request.url).origin,
      )
    } catch {
      // The task is saved: a notification failure must not invite a duplicate creation.
    }
    return privateJson({ task, notification }, request.method === 'POST' ? 201 : 200)
  } catch (error) {
    return internalError(error)
  }
}
export const POST = write
export const PATCH = write

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals)
    if (context instanceof Response) return context
    const body = await readInternalBody(request)
    await deleteTask(context.db, context.identity, entryId(body.id), body.version)
    return privateJson({ deleted: true })
  } catch (error) {
    return internalError(error)
  }
}
