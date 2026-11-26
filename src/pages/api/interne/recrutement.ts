import type { APIRoute } from 'astro'
import { getInternalContext, privateJson, internalError, readInternalBody } from '../../../lib/internal-context'
import { recruitmentId, listRecruitment, saveRecruitment } from '../../../lib/recruitment'
export const prerender = false
export const GET: APIRoute = async ({request, locals}) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    return privateJson({ contacts: await listRecruitment(c.db) })
  } catch (e) { return internalError(e) }
}
export const PATCH: APIRoute = async ({request, locals}) => {
  try {
    const c = await getInternalContext(request, locals)
    if (c instanceof Response) return c
    const b = await readInternalBody(request)
    return privateJson({ contact: await saveRecruitment(c.db, recruitmentId(b.id), b.contact, b.version, c.identity.email) })
  } catch (e) { return internalError(e) }
}
