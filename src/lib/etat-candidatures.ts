import { NC } from './nocodb'

const API = 'https://app.nocodb.com/api/v2'
const COHORTE = { debut: 2026, fin: 2027, label: '2026–2027' } as const

interface Reponse<T> {
  list: T[]
  pageInfo?: { isLastPage?: boolean; totalRows?: number }
}

interface CohorteNoco {
  Id: number
  nom?: string
  annee_debut?: number
  annee_fin?: number
}

interface ParticipationNoco {
  Id: number
  code?: string
  statut?: string
  date_candidature?: string | null
  date_validation?: string | null
  lettre_interet_signee?: boolean | number
  fiche_contact_recue?: boolean | number
  date_debut_formation?: string | null
  date_fin_formation?: string | null
  statut_formation?: string | null
  etablissements_id?: number | null
}

interface EtablissementNoco {
  Id: number
  nom?: string
  type_etab?: string | null
  ville?: string | null
  region?: string | null
}

export interface EtatCandidature {
  id: number
  code: string
  statut: string
  dateCandidature: string | null
  dateValidation: string | null
  lettreSignee: boolean
  ficheContactRecue: boolean
  dateDebutFormation: string | null
  dateFinFormation: string | null
  statutFormation: string | null
  etablissementId: number | null
  etablissement: string
  typeEtablissement: string | null
  ville: string | null
  region: string | null
  aVerifier: boolean
  progression: Indicateur[]
}

export interface Indicateur {
  etat: 'fait' | 'en-cours' | 'inconnu' | 'abandon'
  texte: string
}

interface MissionNoco {
  Id: number
  participations_id?: number
  formateurs_id?: number | null
  statut?: string | null
  date_debut?: string | null
  date_fin_reelle?: string | null
  nb_adultes_formes?: number | null
}

export interface EtatCohorte {
  cohorte: typeof COHORTE.label
  lignes: EtatCandidature[]
  etablissementsDistincts: number
  lignesAVerifier: number
  actualiseLe: Date
}

async function lire<T>(token: string, chemin: string): Promise<T> {
  const reponse = await fetch(`${API}${chemin}`, {
    headers: { 'xc-token': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  })
  if (!reponse.ok) {
    throw new Error(`NocoDB ${reponse.status}`)
  }
  return reponse.json() as Promise<T>
}

async function lister<T>(token: string, table: string, champs: string[], where?: string): Promise<T[]> {
  const resultat: T[] = []
  const limite = 100

  const ids = new Set<number>()
  for (;;) {
    const offset = resultat.length
    const params = new URLSearchParams({
      limit: String(limite),
      offset: String(offset),
      fields: champs.join(','),
    })
    if (where) params.set('where', where)

    const page = await lire<Reponse<T>>(token, `/tables/${table}/records?${params}`)
    if (!Array.isArray(page.list)) throw new Error('Réponse NocoDB incomplète')
    const lignes = page.list
    for (const ligne of lignes) {
      const id = (ligne as { Id?: number }).Id
      if (typeof id !== 'number' || ids.has(id)) throw new Error('Pagination NocoDB incohérente')
      ids.add(id)
    }
    resultat.push(...lignes)
    if (page.pageInfo?.isLastPage === true || (page.pageInfo?.isLastPage === undefined && lignes.length < limite)) break
    if (!lignes.length || resultat.length >= 10000) throw new Error('Pagination NocoDB interrompue')
  }

  return resultat
}

const present = (valeur: boolean | number | undefined) => valeur === true || valeur === 1

export async function lireEtatCohorte(token: string): Promise<EtatCohorte> {
  const cohortes = await lister<CohorteNoco>(
    token,
    NC.tables.cohortes,
    ['Id', 'nom', 'annee_debut', 'annee_fin'],
    `(annee_debut,eq,${COHORTE.debut})~and(annee_fin,eq,${COHORTE.fin})`,
  )
  if (cohortes.length !== 1) throw new Error(`Cohorte ${COHORTE.label} absente ou ambiguë`)
  const cohorte = cohortes[0]
  if (!cohorte) throw new Error(`Cohorte ${COHORTE.label} introuvable`)

  const participations = await lister<ParticipationNoco>(
    token,
    NC.tables.participations,
    [
      'Id',
      'code',
      'statut',
      'date_candidature',
      'date_validation',
      'lettre_interet_signee',
      'fiche_contact_recue',
      'date_debut_formation',
      'date_fin_formation',
      'statut_formation',
      'etablissements_id',
    ],
    `(cohortes_id,eq,${cohorte.Id})`,
  )

  const ids = [...new Set(participations.map((p) => p.etablissements_id).filter((id): id is number => typeof id === 'number'))]
  const etablissements = ids.length
    ? await lister<EtablissementNoco>(
        token,
        NC.tables.etablissements,
        ['Id', 'nom', 'type_etab', 'ville', 'region'],
        `(Id,in,${ids.join(',')})`,
      )
    : []
  const etablissementsParId = new Map(etablissements.map((e) => [e.Id, e]))

  const missions = participations.length
    ? await lister<MissionNoco>(token, 'merrsayuq3xb3uk',
        ['Id', 'participations_id', 'formateurs_id', 'statut', 'date_debut', 'date_fin_reelle', 'nb_adultes_formes'],
        `(participations_id,in,${participations.map(p => p.Id).join(',')})`)
    : []

  const occurrences = new Map<number, number>()
  for (const participation of participations) {
    if (typeof participation.etablissements_id === 'number') {
      occurrences.set(participation.etablissements_id, (occurrences.get(participation.etablissements_id) ?? 0) + 1)
    }
  }

  const lignes = participations
    .map((participation): EtatCandidature => {
      const etablissementId = participation.etablissements_id ?? null
      const etablissement = etablissementId ? etablissementsParId.get(etablissementId) : undefined
      return {
        id: participation.Id,
        code: participation.code?.trim() || 'Sans code',
        statut: participation.statut?.trim() || 'Non renseigné',
        dateCandidature: participation.date_candidature ?? null,
        dateValidation: participation.date_validation ?? null,
        lettreSignee: present(participation.lettre_interet_signee),
        ficheContactRecue: present(participation.fiche_contact_recue),
        dateDebutFormation: participation.date_debut_formation ?? null,
        dateFinFormation: participation.date_fin_formation ?? null,
        statutFormation: participation.statut_formation?.trim() || null,
        etablissementId,
        etablissement: etablissement?.nom?.trim() || 'Établissement non relié',
        typeEtablissement: etablissement?.type_etab?.trim() || null,
        ville: etablissement?.ville?.trim() || null,
        region: etablissement?.region?.trim() || null,
        progression: progression(participation, missions.filter(m => m.participations_id === participation.Id)),
        aVerifier: !etablissement || (etablissementId !== null && (occurrences.get(etablissementId) ?? 0) > 1),
      }
    })
    .sort((a, b) => a.etablissement.localeCompare(b.etablissement, 'fr'))

  return {
    cohorte: COHORTE.label,
    lignes,
    etablissementsDistincts: new Set(lignes.map((ligne) => ligne.etablissementId).filter((id) => id !== null)).size,
    lignesAVerifier: lignes.filter((ligne) => ligne.aVerifier).length,
    actualiseLe: new Date(),
  }
}


const normaliser = (v: string | null | undefined) => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** Each cell states its evidence; a later status never proves an earlier email. */
export function progression(p: ParticipationNoco, missions: MissionNoco[]): Indicateur[] {
  const statut = normaliser(p.statut)
  const arret = ['abandonne', 'refuse'].includes(statut)
  const inconnu = (texte = 'Non renseigné'): Indicateur => ({ etat: 'inconnu', texte })
  const fait = (texte: string): Indicateur => ({ etat: 'fait', texte })
  const encours = (texte: string): Indicateur => ({ etat: 'en-cours', texte })
  const accepte = ['retenu', 'engage', 'candidature acceptee', 'valide'].includes(statut)
  const missionsActives = missions.filter(m => !['annulee', 'abandonnee', 'refusee'].includes(normaliser(m.statut)))
  const nombreFormes = missionsActives.reduce((n, m) => n + Math.max(0, m.nb_adultes_formes ?? 0), 0)
  return [
    p.date_candidature ? fait(`Reçue le ${dateFr(p.date_candidature)}`) : inconnu('Date non renseignée'),
    statut === 'accuse reception' ? fait('Statut « Accusé réception »') : inconnu('Envoi non documenté'),
    arret ? { etat: 'abandon', texte: p.statut ?? 'Arrêté' } : accepte ? fait('Décision enregistrée') : ['en discussion', 'en cours d’analyse', "en cours d'analyse", 'en qualification'].includes(statut) ? encours('En cours d’analyse') : inconnu('Analyse non renseignée'),
    arret ? { etat: 'abandon', texte: p.statut ?? 'Arrêté' } : p.date_validation ? fait(`Acceptée le ${dateFr(p.date_validation)}`) : accepte ? fait('Acceptée · date non renseignée') : inconnu(),
    present(p.lettre_interet_signee) ? fait('Signée · selon le suivi') : inconnu('Signature non renseignée'),
    present(p.fiche_contact_recue) ? fait('Fiche reçue') : inconnu(),
    missionsActives.some(m => m.formateurs_id) ? fait('Formateur relié à une mission') : inconnu('Aucune affectation renseignée'),
    missionsActives.length ? encours(`${missionsActives.length} mission(s) · ${[...new Set(missionsActives.map(m => m.statut).filter(Boolean))].join(', ') || 'état non renseigné'}`) : inconnu('Aucune mission renseignée'),
    nombreFormes > 0 ? encours(`${nombreFormes} adulte(s) déclaré(s) formé(s) · suivi à vérifier`) : p.date_debut_formation ? encours(`Début renseigné : ${dateFr(p.date_debut_formation)}`) : inconnu('Formation non documentée'),
    inconnu('Ateliers et évaluation non documentés dans cette vue'),
  ]
}

function dateFr(date: string): string {
  const parts = date.slice(0, 10).split('-')
  return parts.length === 3 ? parts.reverse().join('/') : date
}
