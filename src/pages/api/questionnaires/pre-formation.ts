import type { APIRoute } from 'astro'
import { ajouterEtablissementNewsletter, brevoEnv } from '../../../lib/brevo'
import { modeApercu } from '../../../lib/forms'
import {
  operationalError,
  operationalJson,
  readOperationalBody,
  OperationalLinkError,
} from '../../../lib/operational-links'
import { limitPublicForm, publicFormsConfig } from '../../../lib/public-forms'
import { parsePreformation, receivePreformation } from '../../../lib/preformation'
import { preformationVersion } from '../../../lib/preformation-definition'
import { preformationProjectionConfig } from '../../../lib/preformation-projection'
export const prerender = false

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await readOperationalBody(request)
    if (
      Object.keys(body).some(
        (key) => !['version', 'website', 'answers', 'newsletterOptOut'].includes(key),
      ) ||
      body.version !== preformationVersion ||
      (body.website !== undefined && body.website !== '') ||
      (Object.hasOwn(body, 'newsletterOptOut') && typeof body.newsletterOptOut !== 'boolean')
    )
      throw new OperationalLinkError(
        400,
        'champs',
        'Rechargez le formulaire et vérifiez votre saisie.',
      )
    const answers = parsePreformation(body.answers)
    if (modeApercu(request))
      return operationalJson({ state: 'complete', code: 'preview', preview: true })
    const config = publicFormsConfig(locals)
    const personProjection = await preformationProjectionConfig(locals)
    await config.db
      .prepare('SELECT receipt FROM public_preformation_projections LIMIT 1')
      .bind()
      .first()
    await config.db
      .prepare('SELECT receipt FROM public_preformation_person_claims LIMIT 1')
      .bind()
      .first()
    await config.db
      .prepare('SELECT response_key FROM google_transition_person_claims LIMIT 1')
      .bind()
      .first()
    await limitPublicForm(config.db, request)
    const result = await receivePreformation({ ...config, answers, personProjection })
    if (result.state === 'processing') return operationalJson(result, 202)
    if (body.newsletterOptOut === false) {
      try {
        if (
          await ajouterEtablissementNewsletter(brevoEnv(locals), answers.email, {
            fullName: answers.name,
          })
        )
          return operationalJson(result)
      } catch {
        // Une indisponibilité Brevo n’annule pas la réponse déjà enregistrée.
      }
      return operationalJson({ ...result, newsletterUnavailable: true })
    }
    return operationalJson(result)
  } catch (error) {
    return operationalError(error)
  }
}
