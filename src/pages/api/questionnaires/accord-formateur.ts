import type { APIRoute } from 'astro'
import { modeApercu } from '../../../lib/forms'
import {
  operationalError,
  operationalJson,
  readOperationalBody,
  OperationalLinkError,
} from '../../../lib/operational-links'
import { limitPublicForm, publicFormsConfig } from '../../../lib/public-forms'
import { parseAccord, receiveAccord } from '../../../lib/accord-formateur'
import { accordVersion } from '../../../lib/accord-formateur-definition'
import { accordProjectionConfig } from '../../../lib/accord-formateur-projection'
export const prerender = false

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await readOperationalBody(request)
    if (
      Object.keys(body).some((key) => !['version', 'website', 'answers'].includes(key)) ||
      body.version !== accordVersion ||
      (body.website !== undefined && body.website !== '')
    )
      throw new OperationalLinkError(
        400,
        'champs',
        'Rechargez le formulaire et vérifiez votre saisie.',
      )
    const answers = parseAccord(body.answers)
    if (modeApercu(request))
      return operationalJson({ state: 'complete', code: 'preview', preview: true })
    const config = publicFormsConfig(locals)
    const personProjection = await accordProjectionConfig(locals)
    await config.db.prepare('SELECT receipt FROM public_accord_projections LIMIT 1').bind().first()
    await config.db.prepare('SELECT receipt FROM public_accord_claims LIMIT 1').bind().first()
    await limitPublicForm(config.db, request)
    const result = await receiveAccord({ ...config, answers, personProjection })
    return operationalJson(result, result.state === 'processing' ? 202 : 200)
  } catch (error) {
    return operationalError(error)
  }
}
