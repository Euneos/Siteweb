import type { APIRoute } from 'astro'
import {
  getInternalContext,
  internalEnvironment,
  internalError,
  privateJson,
  readInternalBody,
} from '../../../lib/internal-context'
import { modeApercu } from '../../../lib/forms'
import { attachReview, listReviews, reviewConfiguration } from '../../../lib/google-review-store'
export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getInternalContext(request, locals)
    if (auth instanceof Response) return auth
    if (modeApercu(request))
      return privateJson(
        { error: 'Les réponses privées ne sont pas accessibles depuis un aperçu public.' },
        403,
      )
    return privateJson(await listReviews(reviewConfiguration(internalEnvironment(locals), auth.db)))
  } catch (error) {
    return internalError(error)
  }
}
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getInternalContext(request, locals)
    if (auth instanceof Response) return auth
    if (!auth.identity.admin)
      return privateJson({ error: 'Le rattachement est réservé aux responsables.' }, 403)
    const body = await readInternalBody(request)
    if (modeApercu(request))
      return privateJson({ error: 'Aucun rattachement réel depuis un aperçu public.' }, 403)
    return privateJson(
      await attachReview(
        reviewConfiguration(internalEnvironment(locals), auth.db),
        body,
        auth.identity.email,
      ),
    )
  } catch (error) {
    return internalError(error)
  }
}
