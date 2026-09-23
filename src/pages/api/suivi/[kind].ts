import type { APIRoute } from 'astro'
import { modeApercu } from '../../../lib/forms'
import { brevoEnv } from '../../../lib/brevo'
import { OperationalDataError, parseOperationalInput } from '../../../lib/operational-data'
import { enregistrerOperational } from '../../../lib/operational-store'
import {
  operationalConfig,
  operationalError,
  operationalJson,
  operationalKind,
  OperationalLinkError,
  operationalTarget,
  readOperationalBody,
  resolveOperationalLink,
} from '../../../lib/operational-links'
import { acknowledgeOperational } from '../../../lib/operational-mail'
export const prerender = false

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const kind = operationalKind(params.kind)
    const body = await readOperationalBody(request)
    const { token: submittedToken, ...answers } = body
    const data = parseOperationalInput(answers, kind)
    if (modeApercu(request)) {
      if (submittedToken !== 'demo')
        throw new OperationalLinkError(
          403,
          'apercu',
          'Cet aperçu utilise uniquement des données fictives.',
        )
      return operationalJson({
        state: 'complete',
        preview: true,
        code: 'preview',
        duplicate: false,
        createdAdults: 0,
      })
    }
    const { db, token } = operationalConfig(locals)
    const { hash, target } = await resolveOperationalLink(db, submittedToken, kind)
    const current = await operationalTarget(token, target.participationId)
    if (JSON.stringify(current) !== JSON.stringify(target))
      throw new OperationalLinkError(
        409,
        'dossier',
        'Ce dossier a changé. Demandez un nouveau lien à l’équipe EUNEOS.',
      )
    const result = await enregistrerOperational({ db, token, linkHash: hash, target, kind, data })
    if (result.code === 'payload_changed')
      return operationalJson(
        {
          ...result,
          message:
            'Ce lien a déjà reçu une autre réponse. Cette nouvelle saisie n’a pas été enregistrée : conservez-la et demandez un nouveau lien à l’équipe EUNEOS.',
        },
        409,
      )
    if (result.state === 'retryable')
      return operationalJson(
        {
          ...result,
          message:
            'Vos réponses n’ont pas encore été enregistrées. Conservez votre saisie et réessayez plus tard.',
        },
        503,
      )
    let acknowledgement: string | undefined
    if (result.state === 'complete' && !result.duplicate) {
      try {
        acknowledgement = await acknowledgeOperational({
          db,
          env: brevoEnv(locals),
          linkHash: hash,
          email: data.referrer.email,
          kind,
        })
      } catch {
        acknowledgement = 'uncertain'
      }
    }
    return operationalJson(
      { ...result, acknowledgement },
      result.state === 'processing' ? 202 : 200,
    )
  } catch (error) {
    if (error instanceof OperationalDataError)
      return operationalJson({ code: error.code, message: error.message }, error.status)
    return operationalError(error)
  }
}
