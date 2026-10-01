import type { APIRoute } from 'astro'
import { finalQuestionnairePreview } from '../../../lib/final-questionnaire-preview'
export const prerender = false
export const POST: APIRoute = (context) =>
  finalQuestionnairePreview(context.request, 'bilan-etablissement')
