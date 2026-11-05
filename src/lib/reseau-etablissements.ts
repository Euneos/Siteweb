import { lireToutes, reconcilierActifs } from './nocodb'
import { buildMapData } from './map'

type Row = Record<string, unknown> & { Id: number }

export const formationLabels = {
  terminee: 'Formation terminée',
  en_cours: 'Formation en cours',
  a_programmer: 'Formation à programmer',
  programmee: 'Formation programmée',
} as const
export function etatFormationCarte(row: Row): keyof typeof formationLabels | null {
  if (row.statut === 'Refus' || row.statut === 'Abandon') return null
  const status = typeof row.statut_formation === 'string' ? row.statut_formation.trim() : ''
  if (status === 'Terminé') return 'terminee'
  if (status === 'En cours') return 'en_cours'
  if (status === 'Programmée') return 'programmee'
  if (status === 'À préciser' || status === 'Prévisionnelle') return 'a_programmer'
  if (!status && !row.date_debut_formation && !row.date_fin_formation) return 'a_programmer'
  return null // Never invent a state from dates or an unknown legacy value.
}

/** Display categories only: no change to candidacy decisions or training fields. */
export function construireReseauEtablissements(cohorts: Row[], participations: Row[], establishments: Row[]) {
  // Reconcile before filtering: an archived completed dossier must not resurrect.
  const current = reconcilierActifs(participations, ['etablissements_id', 'cohortes_id'])
  const included = current.filter(row => etatFormationCarte(row) !== null)
  const byId = new Map(included.map(row => [row.Id, row]))
  const map = buildMapData(cohorts, included, establishments)
  return {
    cohorts: map.cohorts.map(c => ({ value: String(c.id), label: c.label })).sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    members: map.groups.map(group => ({
      id: group.participations[0].id,
      nom: group.name,
      annee: group.cohortKnown ? String(group.cohortId) : '',
      statut: 'Suivi de formation',
      etats: [...new Set(group.participations.map(p => etatFormationCarte(byId.get(p.id)!)!))],
      formations: group.participations.map(p => ({ dossier: p.code, etat: etatFormationCarte(byId.get(p.id)!)! })),
      localisation: group.city,
      location: group.cohortKnown ? group.location : null,
      issue: group.cohortKnown ? group.issue : 'Cohorte à préciser',
      dossiers: group.participations.map(p => p.code),
    })),
    updatedAt: map.updatedAt,
  }
}

export type ReseauEtablissements = ReturnType<typeof construireReseauEtablissements>

export async function lireReseauEtablissements(token: string) {
  const [cohorts, participations, establishments] = await Promise.all([
    lireToutes(token, 'cohortes', 'Id,nom,annee_debut,annee_fin,active'),
    lireToutes(token, 'participations', 'Id,code,statut,statut_formation,date_debut_formation,date_fin_formation,etablissements_id,cohortes_id,fusionne_vers'),
    lireToutes(token, 'etablissements', 'Id,nom,type_etab,ville,cp'),
  ])
  return construireReseauEtablissements(cohorts, participations, establishments)
}
