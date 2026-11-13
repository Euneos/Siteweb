import type { APIRoute } from 'astro'
import { WorkspaceError } from '../../../lib/internal-workspace'
import {
  getInternalContext,
  privateJson,
  internalError,
  readInternalBody,
  entryId,
} from '../../../lib/internal-context'
import {
  listAgenda,
  removeAgendaEvent,
  lastAgendaCheck,
  decideAgendaEvent,
  importAgendaEvent,
} from '../../../lib/event-agenda'
export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    return privateJson({
      events: await listAgenda(c.db),
      deletedEvents: (await listAgenda(c.db, true)).filter((e) => e.deleted_at),
      checkedAt: await lastAgendaCheck(c.db),
    })
  } catch (e) {
    return internalError(e)
  }
}
// Dedicated human action: the newsletter import operation has no decision fields.
export const PATCH: APIRoute = async ({ request, locals }) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    const b = await readInternalBody(request)
    if (b.action === 'restore')
      await removeAgendaEvent(c.db, entryId(b.id), b.version, c.identity.email, true)
    else await decideAgendaEvent(c.db, entryId(b.id), b, c.identity.email)
    return privateJson({ saved: true })
  } catch (e) {
    return internalError(e)
  }
}
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    const b = await readInternalBody(request)
    const id = await importAgendaEvent(
      c.db,
      b.action === 'manual'
        ? { ...(b.event as Record<string, unknown>), sources: ['Saisie manuelle par l’équipe'] }
        : b.event,
      b.existingId ? entryId(b.existingId) : undefined,
    )
    if (
      b.action === 'manual' &&
      (await listAgenda(c.db, true)).find((e) => e.id === id)?.deleted_at
    )
      throw new WorkspaceError(
        409,
        'Cet événement est dans la corbeille. Restaurez-le pour le remettre dans l’agenda.',
      )
    return privateJson({ id })
  } catch (e) {
    return internalError(e)
  }
}

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    const b = await readInternalBody(request)
    await removeAgendaEvent(c.db, entryId(b.id), b.version, c.identity.email)
    return privateJson({ deleted: true })
  } catch (e) {
    return internalError(e)
  }
}
