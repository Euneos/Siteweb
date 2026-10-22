import type { APIRoute } from 'astro'
import { getInternalContext, privateJson, internalError } from '../../../lib/internal-context'
import { modeApercu } from '../../../lib/forms'
import { responseOverviews } from '../../../lib/form-response-overview'

export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const access = await getInternalContext(request, locals)
    if (access instanceof Response) return access
    if (modeApercu(request)) return privateJson({ preview: true, groups: {}, unavailable: {} })
    return privateJson(await responseOverviews(locals, access.db))
  } catch (error) { return internalError(error) }
}
