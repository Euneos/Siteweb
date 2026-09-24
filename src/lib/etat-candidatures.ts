import { NC, reconcilierActifs } from './nocodb'
import { validContactSource } from './google-form-contact'

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
  fusionne_vers?: number | null
  cohortes_id?: number | null
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
  notes?: string | null
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
  adultesInscrits: { id: number; nom: string; fonction: string | null }[]
  formateurs: { id: number; nom: string }[]
  contact: ContactSource | null
  provenanceInvalide: boolean
  anomaliesDates: string[]
  commenceBientot: boolean
  aVerifier: boolean
  progression: Indicateur[]
}

export interface Indicateur {
  etat: 'fait' | 'en-cours' | 'inconnu' | 'abandon'
  texte: string
}

interface PersonneNoco {
  Id: number
  nom?: string | null
  prenom?: string | null
}
interface AdulteNoco extends PersonneNoco {
  participations_id?: number | null
  fonction?: string | null
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

async function lister<T>(
  token: string,
  table: string,
  champs: string[],
  where?: string,
): Promise<T[]> {
  const resultat: T[] = []
  const limite = 100

  const ids = new Set<number>()
  let total: number | undefined
  for (;;) {
    const offset = resultat.length
    const params = new URLSearchParams({
      limit: String(limite),
      offset: String(offset),
      fields: champs.join(','),
    })
    if (where) params.set('where', where)

    const page = await lire<Reponse<T>>(token, `/tables/${table}/records?${params}`)
    if (!Array.isArray(page?.list)) throw new Error('Réponse NocoDB incomplète')
    const lignes = page.list
    const annonce = page.pageInfo?.totalRows
    if (annonce !== undefined) {
      if (
        !Number.isSafeInteger(annonce) ||
        annonce < 0 ||
        (total !== undefined && total !== annonce)
      )
        throw new Error('Pagination NocoDB incohérente : total variable ou invalide')
      total = annonce
    }
    for (const ligne of lignes) {
      const id = (ligne as { Id?: number } | null)?.Id
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || ids.has(id))
        throw new Error('Pagination NocoDB incohérente')
      ids.add(id)
    }
    resultat.push(...lignes)
    if (
      page.pageInfo?.isLastPage === true ||
      (page.pageInfo?.isLastPage === undefined && !lignes.length)
    ) {
      if (total !== undefined && total !== resultat.length)
        throw new Error('Pagination NocoDB incomplète')
      break
    }
    if (!lignes.length || resultat.length >= 10000) throw new Error('Pagination NocoDB interrompue')
  }

  return resultat
}

const present = (valeur: boolean | number | undefined) => valeur === true || valeur === 1

export async function lireEtatCohorte(
  token: string,
  maintenant = new Date(),
): Promise<EtatCohorte> {
  const cohortes = await lister<CohorteNoco>(
    token,
    NC.tables.cohortes,
    ['Id', 'nom', 'annee_debut', 'annee_fin'],
    `(annee_debut,eq,${COHORTE.debut})~and(annee_fin,eq,${COHORTE.fin})`,
  )
  if (cohortes.length !== 1) throw new Error(`Cohorte ${COHORTE.label} absente ou ambiguë`)
  const cohorte = cohortes[0]
  if (!cohorte) throw new Error(`Cohorte ${COHORTE.label} introuvable`)

  const dossiers = await lister<ParticipationNoco>(
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
      'cohortes_id',
      'fusionne_vers',
      'notes',
    ],
    `(cohortes_id,eq,${cohorte.Id})`,
  )
  // The scoped export must contain both source and canonical row in this cohort.
  // A missing/out-of-scope target fails reconciliation instead of hiding a dossier.
  if (dossiers.some((p) => p.cohortes_id !== cohorte.Id))
    throw new Error('Lecture NocoDB incohérente : participation hors cohorte')
  const participations = reconcilierActifs(dossiers, ['etablissements_id', 'cohortes_id'])

  const ids = [
    ...new Set(
      participations
        .map((p) => p.etablissements_id)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ]
  const etablissements = ids.length
    ? await lister<EtablissementNoco>(
        token,
        NC.tables.etablissements,
        ['Id', 'nom', 'type_etab', 'ville', 'region'],
        `(Id,in,${ids.join(',')})`,
      )
    : []
  const etablissementsParId = new Map(etablissements.map((e) => [e.Id, e]))

  // Include archives in child reads: never silently hide children left on an archive.
  const whereDossiers = `(participations_id,in,${dossiers.map((p) => p.Id).join(',')})`
  const [missions, adultes] = dossiers.length
    ? await Promise.all([
        lister<MissionNoco>(
          token,
          'merrsayuq3xb3uk',
          ['Id', 'participations_id', 'formateurs_id', 'statut', 'nb_adultes_formes'],
          whereDossiers,
        ),
        lister<AdulteNoco>(
          token,
          'mzbpzuikti6h3pz',
          ['Id', 'participations_id', 'nom', 'prenom', 'fonction'],
          whereDossiers,
        ),
      ])
    : [[], []]
  const actifs = new Set(participations.map((p) => p.Id))
  for (const enfant of [...missions, ...adultes]) {
    if (!enfant.participations_id || !actifs.has(enfant.participations_id))
      throw new Error(
        'Lecture NocoDB incohérente : adulte ou mission sur une archive ou hors périmètre',
      )
  }
  const idsFormateurs = [
    ...new Set(
      missions
        .filter(missionActive)
        .map((m) => m.formateurs_id)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ]
  const formateurs = idsFormateurs.length
    ? await lister<PersonneNoco>(
        token,
        NC.tables.formateurs,
        ['Id', 'nom', 'prenom'],
        `(Id,in,${idsFormateurs.join(',')})`,
      )
    : []
  const formateursParId = new Map(formateurs.map((f) => [f.Id, f]))

  const occurrences = new Map<number, number>()
  for (const participation of participations) {
    if (typeof participation.etablissements_id === 'number') {
      occurrences.set(
        participation.etablissements_id,
        (occurrences.get(participation.etablissements_id) ?? 0) + 1,
      )
    }
  }

  const lignes = participations
    .map((participation): EtatCandidature => {
      const etablissementId = participation.etablissements_id ?? null
      const etablissement = etablissementId ? etablissementsParId.get(etablissementId) : undefined
      const contactLu = lireSourceContact(participation.notes)
      const anomaliesDates = verifierDates(participation, contactLu.contact)
      const missionsDossier = missions.filter((m) => m.participations_id === participation.Id)
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
        adultesInscrits: adultes
          .filter((a) => a.participations_id === participation.Id)
          .map((a) => ({
            id: a.Id,
            nom: nomPersonne(a) || 'Identité à compléter',
            fonction: a.fonction?.trim() ? sansEmail(a.fonction.trim()) : null,
          }))
          .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
        formateurs: [
          ...new Set(
            missionsDossier
              .filter(missionActive)
              .map((m) => m.formateurs_id)
              .filter((id): id is number => typeof id === 'number'),
          ),
        ].map((id) => ({
          id,
          nom: nomPersonne(formateursParId.get(id)) || `Formateur #${id} · nom non renseigné`,
        })),
        contact: contactLu.contact,
        provenanceInvalide: contactLu.invalide,
        anomaliesDates,
        commenceBientot:
          !contactLu.invalide &&
          !anomaliesDates.length &&
          commenceDans30Jours(participation, maintenant),
        progression: progression(participation, missionsDossier),
        aVerifier:
          !etablissement ||
          (etablissementId !== null && (occurrences.get(etablissementId) ?? 0) > 1),
      }
    })
    .sort((a, b) => a.etablissement.localeCompare(b.etablissement, 'fr'))

  return {
    cohorte: COHORTE.label,
    lignes,
    etablissementsDistincts: new Set(
      lignes.map((ligne) => ligne.etablissementId).filter((id) => id !== null),
    ).size,
    lignesAVerifier: lignes.filter((ligne) => ligne.aVerifier).length,
    actualiseLe: maintenant,
  }
}

const normaliser = (v: string | null | undefined) =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

/** Each cell states its evidence; a later status never proves an earlier email. */
export function progression(p: ParticipationNoco, missions: MissionNoco[]): Indicateur[] {
  const statut = normaliser(p.statut)
  const arret = ['abandonne', 'refuse'].includes(statut)
  const inconnu = (texte = 'Non renseigné'): Indicateur => ({ etat: 'inconnu', texte })
  const fait = (texte: string): Indicateur => ({ etat: 'fait', texte })
  const encours = (texte: string): Indicateur => ({ etat: 'en-cours', texte })
  const accepte = ['retenu', 'engage', 'candidature acceptee', 'valide'].includes(statut)
  const missionsActives = missions.filter(missionActive)
  const nombreFormes = missionsActives.reduce(
    (n, m) => n + Math.max(0, m.nb_adultes_formes ?? 0),
    0,
  )
  return [
    p.date_candidature
      ? fait(`Reçue le ${dateFr(p.date_candidature)}`)
      : inconnu('Date non renseignée'),
    statut === 'accuse reception'
      ? fait('Statut « Accusé réception »')
      : inconnu('Envoi non documenté'),
    arret
      ? { etat: 'abandon', texte: p.statut ?? 'Arrêté' }
      : accepte
        ? fait('Décision enregistrée')
        : [
              'en discussion',
              'en cours d’analyse',
              "en cours d'analyse",
              'en qualification',
            ].includes(statut)
          ? encours('En cours d’analyse')
          : inconnu('Analyse non renseignée'),
    arret
      ? { etat: 'abandon', texte: p.statut ?? 'Arrêté' }
      : p.date_validation
        ? fait(`Acceptée le ${dateFr(p.date_validation)}`)
        : accepte
          ? fait('Acceptée · date non renseignée')
          : inconnu(),
    present(p.lettre_interet_signee)
      ? fait('Signée · selon le suivi')
      : inconnu('Signature non renseignée'),
    present(p.fiche_contact_recue) ? fait('Fiche reçue') : inconnu(),
    missionsActives.some((m) => m.formateurs_id)
      ? fait('Formateur relié à une mission')
      : inconnu('Aucune affectation renseignée'),
    missionsActives.length
      ? encours(
          `${missionsActives.length} mission(s) · ${[...new Set(missionsActives.map((m) => m.statut).filter(Boolean))].join(', ') || 'état non renseigné'}`,
        )
      : inconnu('Aucune mission renseignée'),
    nombreFormes > 0
      ? encours(`${nombreFormes} adulte(s) déclaré(s) formé(s) · suivi à vérifier`)
      : p.date_debut_formation
        ? encours(`Début renseigné : ${dateFr(p.date_debut_formation)}`)
        : inconnu('Formation non documentée'),
    inconnu('Ateliers et évaluation non documentés dans cette vue'),
  ]
}

function dateFr(date: string): string {
  const parts = date.slice(0, 10).split('-')
  return parts.length === 3 ? parts.reverse().join('/') : date
}

const missionActive = (m: MissionNoco) =>
  !['annulee', 'abandonnee', 'refusee'].includes(normaliser(m.statut))
const nomPersonne = (p?: PersonneNoco) =>
  sansEmail([p?.prenom?.trim(), p?.nom?.trim()].filter(Boolean).join(' '))

/** Only this allowlisted projection can reach HTML; raw notes and emails stay server-side. */
export interface ContactSource {
  receivedAt: string | null
  readAt: string
  formation: {
    start: string | null
    end: string | null
    kind: 'previsionnelle' | 'deploiement'
    format: string
    planning: string
    issues: string[]
  }
  declaredTrainers: string[]
  participants: { declared: string; unresolved: string[]; importedCount: number }
}

const isoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const texte = (v: unknown): v is string => typeof v === 'string' && v.length <= 10_000
const tableauTextes = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 500 && v.every(texte)
const dateNullable = (v: unknown) => v === null || isoDate(v)
const isoTimestamp = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  isoDate(v.slice(0, 10)) &&
  Number(v.slice(11, 13)) < 24 &&
  Number(v.slice(14, 16)) < 60 &&
  Number(v.slice(17, 19)) < 60 &&
  Number.isFinite(Date.parse(v))
const objet = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
// Free-text source fields may contain an email; omit it from the visible projection too.
const sansEmail = (v: string) => v.replace(/[^\s<>()";,]+@[^\s<>()";,]+/g, '[coordonnée masquée]')

export function lireSourceContact(notes?: string | null): {
  contact: ContactSource | null
  invalide: boolean
} {
  const debut = '[EUNEOS_CONTACT_V1]',
    fin = '[/EUNEOS_CONTACT_V1]'
  const absent = { contact: null, invalide: false }
  const invalide = { contact: null, invalide: true }
  if (!notes || (!notes.includes(debut) && !notes.includes(fin))) return absent
  if (notes.length > 200_000 || notes.split(debut).length !== 2 || notes.split(fin).length !== 2)
    return invalide
  const start = notes.indexOf(debut) + debut.length,
    end = notes.indexOf(fin)
  if (end < start) return invalide
  try {
    const c: unknown = JSON.parse(notes.slice(start, end).trim())
    if (
      !objet(c) ||
      c.version !== 1 ||
      !objet(c.source) ||
      !objet(c.formation) ||
      !objet(c.participants)
    )
      return invalide
    const { source: s, formation: f, participants: p } = c
    if (
      !validContactSource(s) ||
      !(dateNullable(c.receivedAt) || isoTimestamp(c.receivedAt)) ||
      !dateNullable(f.start) ||
      !dateNullable(f.end) ||
      !['previsionnelle', 'deploiement'].includes(String(f.kind)) ||
      !texte(f.format) ||
      !texte(f.planning) ||
      !tableauTextes(f.issues) ||
      !texte(p.declared) ||
      !tableauTextes(p.unresolved) ||
      !Number.isSafeInteger(p.importedCount) ||
      Number(p.importedCount) < 0 ||
      !Array.isArray(c.declaredTrainers) ||
      c.declaredTrainers.length > 100 ||
      !c.declaredTrainers.every(
        (t) =>
          objet(t) && texte(t.name) && t.name.trim() && (t.email === undefined || texte(t.email)),
      )
    )
      return invalide
    return {
      invalide: false,
      contact: {
        receivedAt: typeof c.receivedAt === 'string' ? c.receivedAt.slice(0, 10) : null,
        readAt: s.readAt,
        formation: {
          start: f.start as string | null,
          end: f.end as string | null,
          kind: f.kind as ContactSource['formation']['kind'],
          format: sansEmail(f.format),
          planning: sansEmail(f.planning),
          issues: f.issues.map(sansEmail),
        },
        declaredTrainers: c.declaredTrainers.map((t) => sansEmail(t.name)),
        participants: {
          declared: sansEmail(p.declared),
          unresolved: p.unresolved.map(sansEmail),
          importedCount: Number(p.importedCount),
        },
      },
    }
  } catch {
    return invalide
  }
}

export function verifierDates(
  p: ParticipationNoco,
  contact: ContactSource | null = null,
): string[] {
  const debut = p.date_debut_formation,
    fin = p.date_fin_formation
  const erreurs = [...(contact?.formation.issues ?? [])]
  if (debut && !isoDate(debut)) erreurs.push('Date de début invalide dans le dossier.')
  if (fin && !isoDate(fin)) erreurs.push('Date de fin invalide dans le dossier.')
  if (debut && fin && isoDate(debut) && isoDate(fin) && fin < debut)
    erreurs.push('La fin précède le début dans le dossier.')
  if (
    [debut, fin].some(
      (d) =>
        d &&
        isoDate(d) &&
        (d.slice(0, 4) < String(COHORTE.debut) || d.slice(0, 4) > String(COHORTE.fin)),
    )
  )
    erreurs.push('Date hors des années de cette cohorte : à confirmer.')
  const source = contact?.formation
  if (source?.start && source.end && source.end < source.start)
    erreurs.push('La fin précède le début dans la fiche source.')
  if (
    source &&
    ((debut && source.start && debut !== source.start) || (fin && source.end && fin !== source.end))
  )
    erreurs.push('Les dates du dossier et de la fiche source diffèrent : à confirmer.')
  return [...new Set(erreurs)]
}

/** Calendar days in Paris, inclusive today and day 30; no DST-dependent 24h arithmetic. */
export function commenceDans30Jours(p: ParticipationNoco, maintenant: Date): boolean {
  if (
    ['abandonne', 'refuse'].includes(normaliser(p.statut)) ||
    ['annulee', 'abandonnee', 'terminee'].includes(normaliser(p.statut_formation)) ||
    !isoDate(p.date_debut_formation)
  )
    return false
  const jour = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(maintenant)
  const ecart = (Date.parse(p.date_debut_formation) - Date.parse(jour)) / 86_400_000
  return ecart >= 0 && ecart <= 30
}

export function dateFormationFr(date: string | null): string {
  return !date ? 'Non renseignée' : isoDate(date) ? dateFr(date) : 'Date invalide · à vérifier'
}

export function selectionnerDossiers(
  lignes: EtatCandidature[],
  filtre = 'tous',
  tri = 'debut',
): EtatCandidature[] {
  return lignes
    .filter((l) =>
      filtre === 'bientot'
        ? l.commenceBientot
        : filtre === 'dates'
          ? l.anomaliesDates.length > 0 || l.provenanceInvalide
          : filtre === 'sans-date'
            ? !l.dateDebutFormation
            : true,
    )
    .sort((a, b) => {
      if (tri !== 'nom') {
        const da = isoDate(a.dateDebutFormation) ? a.dateDebutFormation : '9999'
        const db = isoDate(b.dateDebutFormation) ? b.dateDebutFormation : '9999'
        if (da !== db) return da.localeCompare(db)
      }
      return a.etablissement.localeCompare(b.etablissement, 'fr') || a.id - b.id
    })
}
