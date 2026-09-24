import type { APIRoute } from 'astro'
import { getInternalContext } from '../../../lib/internal-context'
import { lireToutes } from '../../../lib/nocodb'
import { modeApercu } from '../../../lib/forms'
import {
  closedDossier,
  issueOperationalLink,
  operationalConfig,
  operationalError,
  operationalJson,
  operationalKind,
  OperationalLinkError,
  readOperationalBody,
  operationalLinkColumns,
  savedOperationalLinks,
} from '../../../lib/operational-links'
import { listOperationalSubmissions } from '../../../lib/operational-store'
export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getInternalContext(request, locals)
    if (auth instanceof Response) return auth
    if (modeApercu(request))
      return operationalJson({ enabled: false, dossiers: [], submissions: [], preview: true })
    const { db, token } = operationalConfig(locals)
    const [schools, parts, cohorts, submissions] = await Promise.all([
      lireToutes(token, 'etablissements', 'Id,nom,ville'),
      lireToutes(
        token,
        'participations',
        'Id,code,statut,etablissements_id,cohortes_id,fusionne_vers,' +
          Object.values(operationalLinkColumns).join(','),
      ),
      lireToutes(token, 'cohortes', 'Id,nom,annee_debut,annee_fin,active'),
      listOperationalSubmissions(db),
    ])
    const active = cohorts.filter((c) => c.active === true || c.active === 1)
    if (active.length !== 1)
      throw new OperationalLinkError(
        409,
        'cohorte',
        'La campagne active doit être précisée dans la base.',
      )
    const cohort = active[0],
      names = new Map(schools.map((s) => [s.Id, s]))
    const dossiers = await Promise.all(
      parts
        .filter((p) => p.cohortes_id === cohort.Id && !closedDossier(p.statut))
        .map(async (p) => {
          const school = names.get(Number(p.etablissements_id))
          if (!school) throw new Error('Missing school')
          return {
            participationId: p.Id,
            schoolName: String(school.nom ?? ''),
            city: String(school.ville ?? ''),
            cohortLabel: `${cohort.annee_debut}–${cohort.annee_fin}`,
            code: String(p.code ?? `DOS-${String(p.Id).padStart(4, '0')}`),
            links: await savedOperationalLinks(db, p),
          }
        }),
    )
    dossiers.sort((a, b) => a.schoolName.localeCompare(b.schoolName, 'fr'))
    return operationalJson({ enabled: true, dossiers, submissions })
  } catch (error) {
    return operationalError(error)
  }
}
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const auth = await getInternalContext(request, locals)
    if (auth instanceof Response) return auth
    const body = await readOperationalBody(request)
    if (modeApercu(request))
      throw new OperationalLinkError(
        409,
        'apercu',
        'Les liens réels se créent depuis le site en production.',
      )
    const { db, token } = operationalConfig(locals)
    const kind = operationalKind(body.kind)
    const result = await issueOperationalLink({
      db,
      token,
      participationId: body.participationId,
      kind,
      issuer: auth.identity.email,
    })
    return operationalJson(result, 201)
  } catch (error) {
    return operationalError(error)
  }
}
