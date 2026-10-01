import type { APIRoute } from 'astro'
import { modeApercu } from '../../../lib/forms'
import {
  operationalError,
  operationalJson,
  readOperationalBody,
  OperationalLinkError,
} from '../../../lib/operational-links'
import { limitPublicForm, publicFormsConfig } from '../../../lib/public-forms'
import { parseBilan, receiveBilan } from '../../../lib/bilan-formateur'
import { bilanVersion } from '../../../lib/bilan-formateur-definition'
import { bilanConfig } from '../../../lib/bilan-formateur-plan'
export const prerender = false

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await readOperationalBody(request)
    if (
      Object.keys(body).some((key) => !['version', 'website', 'answers'].includes(key)) ||
      body.version !== bilanVersion ||
      (body.website !== undefined && body.website !== '')
    )
      throw new OperationalLinkError(
        400,
        'champs',
        'Rechargez le formulaire et vérifiez votre saisie.',
      )
    const answers = parseBilan(body.answers)
    if (modeApercu(request))
      return operationalJson({ state: 'complete', code: 'preview', preview: true })
    const config = publicFormsConfig(locals)
    const configProjection = bilanConfig(locals)
    await config.db
      .prepare('SELECT receipt FROM public_bilan_formateur_projections LIMIT 1')
      .bind()
      .first()
    await config.db
      .prepare('SELECT receipt FROM public_bilan_formateur_claims LIMIT 1')
      .bind()
      .first()
    await limitPublicForm(config.db, request)
    const result = await receiveBilan({ ...config, answers, config: configProjection })
    return operationalJson(result, result.state === 'processing' ? 202 : 200)
  } catch (error) {
    return operationalError(error)
  }
}
