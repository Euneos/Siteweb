import { internalEnvironment } from './internal-context'
import { operationalConfig } from './operational-links'
import { operationalRequest } from './operational-data'
import { lireToutes } from './nocodb'
import type { WorkspaceDatabase } from './internal-workspace'

export type Respondent = {
  id: string
  name: string
  school: string
  role: string
  receivedAt: string
  dossierId?: number
}
export type ResponseOverview = { rows: Respondent[]; note: string }
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const keys: Record<string, string> = {
  contact: 'contact', deploiement: 'deploiement', participants: 'participants',
  'activites-jeunes': 'activites-jeunes', pre_formation_adultes: 'pre-formation',
  post_formation_adultes: 'post-formation', suivi_adultes_j45: 'suivi-j45',
  evaluation_fin_formation: 'evaluation-formation', bilan_etablissement: 'bilan-etablissement',
  bilan_formateur: 'bilan-formateur', accord_formateur: 'accord-formateur',
}

/** Read the full source journal, not the catalogue's 50-row detail preview. */
export async function readResponseSources(token: string, table: string) {
  const rows: Record<string, unknown>[] = []
  const ids = new Set<number>()
  for (;;) {
    const page = await operationalRequest(token, `/tables/${table}/records?limit=200&offset=${rows.length}&sort=Id`) as {
      list: Record<string, unknown>[]; pageInfo?: { isLastPage?: boolean }
    }
    if (!Array.isArray(page.list)) throw new Error('Invalid response journal')
    for (const row of page.list) {
      if (!Number.isSafeInteger(row.Id) || ids.has(Number(row.Id))) throw new Error('Invalid response pagination')
      ids.add(Number(row.Id))
    }
    rows.push(...page.list)
    if (page.pageInfo?.isLastPage === true) return rows
    if (!page.list.length) {
      if (page.pageInfo?.isLastPage === false) throw new Error('Incomplete response journal')
      return rows
    }
  }
}

export function publicRespondent(row: Record<string, unknown>): { key: string; person: Respondent } {
  const source = JSON.parse(String(row.reponses))
  const key = keys[source.kind]
  if (!key) throw new Error('Unknown response kind')
  const questionnaire = Array.isArray(source.answers)
  const answers = questionnaire
    ? Object.fromEntries(source.answers.map((a: { key: string; value: unknown }) => [a.key, a.value]))
    : source.answers
  const name = questionnaire
    ? text(answers.name) || [text(answers.firstName), text(answers.lastName)].filter(Boolean).join(' ')
    : text(answers?.referrer?.name)
  // A form's intended audience does not establish a person's actual function.
  const role = questionnaire
    ? text(answers.role) || (['bilan-formateur', 'accord-formateur'].includes(key) ? 'Formateur' : '')
    : 'Référent déclaré'
  return { key, person: {
    id: `Réponse #${row.Id}`, name: name || 'Nom non recueilli',
    school: text(row.etablissement) || 'Établissement non renseigné',
    role: role || 'Rôle non recueilli',
    receivedAt: text(source.receivedAt) || text(row.CreatedAt),
    ...(Number.isSafeInteger(row.dossier_id) && Number(row.dossier_id) > 0 ? { dossierId: Number(row.dossier_id) } : {}),
  } }
}

export async function responseOverviews(locals: unknown, workspace: WorkspaceDatabase) {
  const { db, token } = operationalConfig(locals)
  const table = internalEnvironment(locals).PUBLIC_FORMS_TABLE
  const groups: Record<string, ResponseOverview> = {}
  const unavailable: Record<string, string> = {
    'contact-public': 'Répondants non disponibles ici : demandes transmises par e-mail.',
    newsletter: 'Répondants non disponibles ici : inscriptions suivies dans Brevo.',
  }
  // Isolate sources: a missing registry must not hide the other counts.
  await Promise.all([
    (async () => {
      const publicKeys = Object.values(keys)
      try {
        if (typeof table !== 'string' || !/^[a-z0-9]{10,30}$/.test(table)) throw new Error('Missing source')
        const [sources, personal, parts, schools] = await Promise.all([
          readResponseSources(token, table),
          db.prepare(`SELECT s.receipt,s.kind,s.target_id,s.school_id,s.created_at
            FROM operational_submissions s WHERE s.state='complete'
            AND NOT EXISTS (SELECT 1 FROM public_form_receipts p WHERE p.receipt=s.link_hash)`)
            .bind().all<{ receipt: string; kind: string; target_id: number; school_id: number; created_at: string }>(),
          lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers'),
          lireToutes(token, 'etablissements', 'Id,nom'),
        ])
        const active = new Set(parts.map(p => p.Id))
        const collected: Record<string, ResponseOverview> = Object.fromEntries(publicKeys.map(key => [key, {
          rows: [], note: 'Réponses conservées sur le site, toutes années. Les anciens formulaires Google ne sont pas inclus.',
        }]))
        const receipts = new Set<string>()
        for (const row of sources) {
          if (row.fusionne_vers != null || (row.dossier_id && !active.has(Number(row.dossier_id)))) continue
          const receipt = text(row.cle_reponse)
          if (receipt && receipts.has(receipt)) continue
          if (receipt) receipts.add(receipt)
          const { key, person } = publicRespondent(row)
          collected[key].rows.push(person)
        }
        for (const row of personal.results) {
          if (!active.has(row.target_id) || !collected[row.kind]) continue
          collected[row.kind].rows.push({
            id: `Dossier #${row.target_id}`, name: 'Nom non conservé dans ce registre',
            school: text(schools.find(s => s.Id === row.school_id)?.nom) || 'Établissement non renseigné',
            role: 'Rôle non conservé', receivedAt: row.created_at, dossierId: row.target_id,
          })
        }
        Object.assign(groups, collected)
      } catch {
        for (const key of publicKeys) unavailable[key] = 'Réponses momentanément indisponibles.'
      }
    })(),
    (async () => {
      const applicationKeys = ['candidature-etablissement', 'candidature-formateur']
      try {
        const [applications, schools, trainers, parts, engagements] = await Promise.all([
          db.prepare("SELECT form_type,parent_id,record_id,created_at FROM form_submissions WHERE state='complete'")
            .bind().all<{ form_type: string; parent_id: number; record_id: number; created_at: string }>(),
          lireToutes(token, 'etablissements', 'Id,nom,referent_nom,referent_fonction'),
          lireToutes(token, 'formateurs', 'Id,nom,prenom,fusionne_vers'),
          lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers'),
          lireToutes(token, 'engagements', 'Id,formateurs_id,cohortes_id,fusionne_vers'),
        ])
        for (const key of applicationKeys) groups[key] = { rows: [], note: 'Candidatures reçues sur le site uniquement ; identité actuelle du dossier. Imports historiques non inclus.' }
        const seen = new Set<string>()
        for (const row of applications.results) {
          const school = row.form_type === 'etablissement'
          const key = school ? applicationKeys[0] : applicationKeys[1]
          const record = (school ? parts : engagements).find(p => p.Id === row.record_id)
          const person = (school ? schools : trainers).find(p => p.Id === row.parent_id && p.fusionne_vers == null)
          const id = `${key}:${school ? row.record_id : row.parent_id}`
          if (!record || !person || seen.has(id)) continue
          seen.add(id)
          groups[key].rows.push({
            id: `${school ? 'Dossier' : 'Formateur'} #${school ? row.record_id : row.parent_id}`,
            name: school ? text(person.referent_nom) || 'Nom non renseigné' : [text(person.prenom), text(person.nom)].filter(Boolean).join(' ') || 'Nom non renseigné',
            school: school ? text(person.nom) : 'Établissement non renseigné',
            role: school ? 'Référent' : 'Candidat formateur', receivedAt: row.created_at,
            ...(school ? { dossierId: row.record_id } : {}),
          })
        }
      } catch {
        for (const key of applicationKeys) { delete groups[key]; unavailable[key] = 'Candidatures momentanément indisponibles.' }
      }
    })(),
    (async () => {
      try {
        const { results } = await workspace.prepare('SELECT id,payload,created_at FROM mission_conventions ORDER BY created_at DESC').bind()
          .all<{ id: string; payload: string; created_at: string }>()
        groups['convention-mission'] = { note: 'Conventions transmises, hors brouillons.', rows: results.map(row => {
          const payload = JSON.parse(row.payload)
          return { id: `Convention ${row.id}`, name: text(payload.nom) || 'Nom non renseigné',
            school: payload.missions.map((m: { etablissement: string }) => m.etablissement).join(' · ') || 'Établissement non renseigné',
            role: 'Formateur', receivedAt: row.created_at }
        }) }
      } catch { unavailable['convention-mission'] = 'Conventions momentanément indisponibles.' }
    })(),
  ])
  for (const group of Object.values(groups)) group.rows.sort((a, b) =>
    (Date.parse(b.receivedAt) || 0) - (Date.parse(a.receivedAt) || 0) || b.id.localeCompare(a.id, 'fr', { numeric: true }))
  return { groups, unavailable }
}
