import { NC } from './nocodb'

const API = 'https://app.nocodb.com/api/v2'
const COHORTE = { debut: 2026, fin: 2027, label: '2026–2027' } as const

interface Reponse<T> {
  list?: T[]
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

  for (let offset = 0; ; offset += limite) {
    const params = new URLSearchParams({
      limit: String(limite),
      offset: String(offset),
      fields: champs.join(','),
    })
    if (where) params.set('where', where)

    const page = await lire<Reponse<T>>(token, `/tables/${table}/records?${params}`)
    const lignes = page.list ?? []
    resultat.push(...lignes)
    if (lignes.length < limite) break
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
