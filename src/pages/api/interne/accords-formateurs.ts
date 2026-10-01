import type { APIRoute } from 'astro'
import { getInternalContext } from '../../../lib/internal-context'
import { modeApercu } from '../../../lib/forms'
import {
  operationalConfig,
  operationalError,
  operationalJson,
  OperationalLinkError,
} from '../../../lib/operational-links'
import type { AccordProjection } from '../../../lib/accord-formateur-projection'
export const prerender = false
/** Private read-only proof for the catalogue/Stella. No public status lookup. */
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getInternalContext(request, locals)
    if (auth instanceof Response) return auth
    if (modeApercu(request)) return operationalJson({ preview: true, responses: [] })
    const { db } = operationalConfig(locals)
    const receipt = new URL(request.url).searchParams.get('receipt')
    if (receipt !== null && !/^[a-f0-9]{64}$/.test(receipt))
      throw new OperationalLinkError(400, 'reponse', 'Référence invalide.')
    const query = receipt
      ? 'SELECT * FROM public_accord_projections WHERE receipt=?'
      : 'SELECT * FROM public_accord_projections ORDER BY received_at DESC,receipt DESC LIMIT 100'
    const { results } = await db
      .prepare(query)
      .bind(...(receipt ? [receipt] : []))
      .all<AccordProjection>()
    return operationalJson({
      responses: results.map((row) => ({
        receipt: row.receipt,
        receivedAt: row.received_at,
        state: row.state,
        code: row.code,
        source: JSON.parse(row.payload),
        // Complete means these two agreement fields were read back at verification.
        verifiedProjection:
          row.state === 'complete'
            ? {
                trainerId: row.trainer_id,
                journeyId: row.journey_id,
                agreementDate: row.agreement_date,
              }
            : null,
        message:
          row.state === 'complete'
            ? 'Accord et date relus dans le parcours formateur ; les autres informations restent conservées dans la réponse.'
            : 'Réponse conservée ; accord non confirmé dans le parcours formateur.',
      })),
    })
  } catch (error) {
    return operationalError(error)
  }
}
