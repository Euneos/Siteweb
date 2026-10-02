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
import {
  correctionContext,
  getCorrectionOptions,
  listCorrections,
  prepareCorrection,
  confirmCorrection,
  checkCorrection,
} from '../../../lib/google-review-correction-store'
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
    const env = internalEnvironment(locals)
    const sourceId = new URL(request.url).searchParams.get('sourceId')
    if (sourceId !== null)
      return privateJson(
        await getCorrectionOptions(correctionContext(env, auth.db), Number(sourceId)),
      )
    const result = await listReviews(reviewConfiguration(env, auth.db))
    return privateJson({ ...result, rows: await listCorrections({ db: auth.db }, result.rows) })
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
    if (body.action !== undefined) {
      const context = correctionContext(internalEnvironment(locals), auth.db)
      if (body.action === 'prepare-correction')
        return privateJson(await prepareCorrection(context, body, auth.identity.email))
      if (body.action === 'confirm-correction')
        return privateJson(await confirmCorrection(context, body, auth.identity.email))
      if (body.action === 'check-correction')
        return privateJson(await checkCorrection(context, body, auth.identity.email))
      return privateJson({ error: 'Action non prise en charge.' }, 400)
    }
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
