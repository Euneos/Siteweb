import { modeApercu } from './forms'
import {
  operationalError,
  operationalJson,
  OperationalLinkError,
  readOperationalBody,
} from './operational-links'
import {
  finalQuestionnaireDefinition,
  type FinalQuestionnaireSlug,
} from './final-questionnaire-definition'
import { publicFormsConfig, limitPublicForm } from './public-forms'
import { finalProjectionConfig, requireFinalSchema } from './final-questionnaire-plan'
import { requireFinalRegistry } from './final-questionnaire-store'
import { parseFinalQuestionnaire, receiveFinalQuestionnaire } from './final-questionnaire'

/** The preview branch never reads configuration/storage; production requires all gates. */
export async function finalQuestionnairePreview(
  request: Request,
  slug: FinalQuestionnaireSlug,
  locals?: unknown,
) {
  try {
    const def = finalQuestionnaireDefinition(slug)!
    const body = await readOperationalBody(request)
    if (
      Object.keys(body).some((k) => !['version', 'website', 'answers'].includes(k)) ||
      body.version !== def.version ||
      (body.website !== undefined && body.website !== '')
    )
      throw new OperationalLinkError(
        400,
        'champs',
        'Rechargez le formulaire et vérifiez votre saisie.',
      )
    const answers = parseFinalQuestionnaire(def, body.answers)
    if (modeApercu(request))
      return operationalJson({ state: 'complete', code: 'preview', preview: true })
    const config = publicFormsConfig(locals),
      personProjection = finalProjectionConfig(locals, def)
    await requireFinalRegistry(config.db)
    await limitPublicForm(config.db, request)
    await requireFinalSchema(personProjection, config.token)
    const result = await receiveFinalQuestionnaire({
      ...config,
      definition: def,
      answers,
      personProjection,
    })
    return operationalJson(result, result.state === 'processing' ? 202 : 200)
  } catch (error) {
    return operationalError(error)
  }
}
