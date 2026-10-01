import type { APIContext } from 'astro'
import { modeApercu } from './forms'
import {
  operationalError,
  operationalJson,
  readOperationalBody,
  OperationalLinkError,
} from './operational-links'
import { limitPublicForm, publicFormsConfig } from './public-forms'
import { parsePostformation, receivePostformation } from './postformation'
import { postformationDefinition, type PostformationSlug } from './postformation-definition'
import { postformationProjectionConfig } from './postformation-projection'
export async function postformationReady(locals: unknown, slug: PostformationSlug) {
  const config = publicFormsConfig(locals),
    definition = postformationDefinition(slug)!
  const personProjection = await postformationProjectionConfig(locals, definition)
  for (const table of [
    'public_form_receipts',
    'public_postformation_projections',
    'public_postformation_claims',
  ])
    await config.db.prepare(`SELECT receipt FROM ${table} LIMIT 1`).bind().first()
  return { ...config, definition, personProjection }
}
export async function postformationPost({ request, locals }: APIContext, slug: PostformationSlug) {
  try {
    const definition = postformationDefinition(slug)!,
      body = await readOperationalBody(request)
    if (
      Object.keys(body).some((k) => !['version', 'website', 'answers'].includes(k)) ||
      body.version !== definition.version ||
      (body.website !== undefined && body.website !== '')
    )
      throw new OperationalLinkError(
        400,
        'champs',
        'Rechargez le formulaire et vérifiez votre saisie.',
      )
    const answers = parsePostformation(definition, body.answers)
    if (modeApercu(request))
      return operationalJson({ state: 'complete', code: 'preview', preview: true })
    const config = await postformationReady(locals, slug)
    await limitPublicForm(config.db, request)
    const result = await receivePostformation({ ...config, answers })
    return operationalJson(result, result.state === 'processing' ? 202 : 200)
  } catch (error) {
    return operationalError(error)
  }
}
