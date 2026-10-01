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
import { parseFinalQuestionnaire } from './final-questionnaire'

/** Preparation only. Never load private configuration, a database or a transport.
 * Even a valid production request must fail before collecting any answers. */
export async function finalQuestionnairePreview(request: Request, slug: FinalQuestionnaireSlug) {
  try {
    if (!modeApercu(request))
      throw new OperationalLinkError(
        503,
        'projection_unavailable',
        'Ce formulaire est momentanément indisponible. Contactez l’équipe EUNEOS.',
      )
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
    parseFinalQuestionnaire(def, body.answers)
    return operationalJson({ state: 'complete', code: 'preview', preview: true })
  } catch (error) {
    return operationalError(error)
  }
}
