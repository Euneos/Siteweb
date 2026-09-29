import type { APIRoute } from 'astro'
import {
  getInternalContext,
  internalEnvironment,
  internalError,
  privateJson,
  readInternalBody,
} from '../../../lib/internal-context'
import { modeApercu } from '../../../lib/forms'
import { submissionDatabase } from '../../../lib/candidature-store'
import { jeton } from '../../../lib/nocodb'
import {
  CandidatureMailError,
  cancelDecisionDraft,
  confirmDecisionMail,
  dispatchCandidatureMail,
  listCandidatureMails,
  prepareDecisionMail,
  reconcileCandidatureMail,
  registryEnabled,
  retryRejectedMail,
  type CandidatureMailEnv,
} from '../../../lib/candidature-mail'
export const prerender = false
const errorResponse = (error: unknown) =>
  error instanceof CandidatureMailError
    ? privateJson({ error: error.message }, error.status)
    : internalError(error)
function context(locals: unknown) {
  const db = submissionDatabase(locals),
    token = jeton(locals),
    env = internalEnvironment(locals) as CandidatureMailEnv
  if (!db || !token || !registryEnabled(env))
    throw new CandidatureMailError(503, 'Le registre des emails est en préparation.')
  return { db, token, env }
}
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getInternalContext(request, locals)
    if (auth instanceof Response) return auth
    if (modeApercu(request)) return privateJson({ enabled: false, preview: true, mails: [] })
    const ctx = context(locals)
    const id = Number(new URL(request.url).searchParams.get('participationId'))
    return privateJson({ enabled: true, mails: await listCandidatureMails(ctx.db, id) })
  } catch (error) {
    return errorResponse(error)
  }
}
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getInternalContext(request, locals)
    if (auth instanceof Response) return auth
    if (!auth.identity.admin)
      return privateJson({ error: 'Cette action est réservée aux responsables.' }, 403)
    const body = await readInternalBody(request)
    if (modeApercu(request))
      return privateJson({ error: 'Aucun email réel depuis un aperçu.' }, 409)
    const ctx = context(locals),
      actor = auth.identity.email
    if (body.action === 'prepare') {
      if (body.kind !== 'accepted' && body.kind !== 'refused')
        throw new CandidatureMailError(400, 'Décision invalide.')
      return privateJson(
        await prepareDecisionMail({
          ...ctx,
          participationId: body.participationId as number,
          kind: body.kind,
          actor,
        }),
        201,
      )
    }
    if (typeof body.id !== 'string' || body.id.length > 150)
      throw new CandidatureMailError(400, 'Identifiant invalide.')
    if (body.action === 'confirm')
      return privateJson(
        await confirmDecisionMail({
          ...ctx,
          id: body.id,
          previewHash: String(body.previewHash ?? ''),
          confirm: body.confirm === true,
          actor,
        }),
      )
    if (body.action === 'cancel') {
      await cancelDecisionDraft(ctx.db, body.id, actor)
      return privateJson({ cancelled: true })
    }
    if (body.action === 'dispatch' && body.confirm === true)
      return privateJson(await dispatchCandidatureMail({ ...ctx, id: body.id }))
    if (body.action === 'reconcile')
      return privateJson(await reconcileCandidatureMail({ ...ctx, id: body.id }))
    if (body.action === 'retry-rejected' && body.confirm === true)
      return privateJson(await retryRejectedMail(ctx.db, body.id))
    throw new CandidatureMailError(400, 'Action inconnue ou non confirmée.')
  } catch (error) {
    return errorResponse(error)
  }
}
