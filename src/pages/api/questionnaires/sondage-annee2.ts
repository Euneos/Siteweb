import type { APIRoute } from 'astro'
import { modeApercu } from '../../../lib/forms'
import {
  operationalError,
  operationalJson,
  OperationalLinkError,
  readOperationalBody,
} from '../../../lib/operational-links'
import { limitPublicForm, publicFormsConfig } from '../../../lib/public-forms'
import { hashOperational, operationalRequest } from '../../../lib/operational-data'
import { parseSurvey } from '../../../lib/sondage-annee2'
export const prerender = false
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await readOperationalBody(request)
    if (
      Object.keys(body).some((key) => !['version', 'website', 'answers'].includes(key)) ||
      body.version !== 'sondage-annee2-v1' ||
      body.website !== ''
    )
      throw new OperationalLinkError(
        400,
        'champs',
        'Rechargez le formulaire et vérifiez votre saisie.',
      )
    let answers: ReturnType<typeof parseSurvey>
    try {
      answers = parseSurvey(body.answers)
    } catch (error) {
      throw new OperationalLinkError(400, 'champs', (error as Error).message)
    }
    if (modeApercu(request)) return operationalJson({ state: 'complete', preview: true })
    const { db, token, table } = publicFormsConfig(locals)
    await limitPublicForm(db, request)
    const payload = JSON.stringify({ version: body.version, answers })
    const receipt = await hashOperational(payload)
    await db
      .prepare(
        'INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash) VALUES (?,?,?)',
      )
      .bind(receipt, 'sondage-annee2', receipt)
      .run()
    const fields = {
      cle_reponse: receipt,
      formulaire: 'Sondage WISE-UP — deuxième année',
      etablissement: answers.school,
      ville: answers.city,
      referent_email: answers.email,
      reponses: payload,
      source_url: 'https://euneos.fr/suivi/sondage-annee2',
    }
    const lookup = (await operationalRequest(
      token,
      `/tables/${table}/records?${new URLSearchParams({ where: `(cle_reponse,eq,${receipt})`, limit: '2' })}`,
    )) as { list: Record<string, unknown>[] }
    if (!Array.isArray(lookup.list) || lookup.list.length > 1)
      throw new Error('Ambiguous source receipt')
    let source = lookup.list[0]
    if (!source) {
      const claim = await db
        .prepare(
          'UPDATE public_form_receipts SET capture_started=1 WHERE receipt=? AND capture_started=0 AND noco_id IS NULL',
        )
        .bind(receipt)
        .run()
      if (claim.meta.changes !== 1) return operationalJson({ state: 'processing' }, 202)
      const saved = (await operationalRequest(token, `/tables/${table}/records`, 'POST', [
        {
          ...fields,
          statut_reprise: 'À vérifier',
          detail_reprise:
            'Sondage de poursuite après formation et quatre ateliers. Réponse à examiner par l’équipe ; aucune modification automatique du dossier.',
        },
      ])) as { Id: number } | { Id: number }[]
      const id = Array.isArray(saved) ? saved[0]?.Id : saved?.Id
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid receipt')
      source = (await operationalRequest(token, `/tables/${table}/records/${id}`)) as Record<
        string,
        unknown
      >
    }
    if (
      !Number.isSafeInteger(source.Id) ||
      Object.entries(fields).some(([key, value]) => source[key] !== value)
    )
      throw new Error('Source readback mismatch')
    await db
      .prepare(
        "UPDATE public_form_receipts SET noco_id=?,state='complete',code='received' WHERE receipt=?",
      )
      .bind(Number(source.Id), receipt)
      .run()
    return operationalJson({ state: 'complete' })
  } catch (error) {
    return operationalError(error)
  }
}
