import type { EtatCandidature } from './etat-candidatures'

export type FiltreSuivi = 'en-cours' | 'programmee' | 'attente-programmation' | 'autres'

/** A dated, human-verified incoming-mail check, never inferred from sent mail. */
export interface VerificationReponses {
  checkedAt: string
  dernierRetourAt: string
}

const dateValide = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value
const timestamp = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

export function lireVerificationReponses(notes?: string | null): VerificationReponses | null {
  const start = '[EUNEOS_REPONSES_VERIFIEES_V1]', end = '[/EUNEOS_REPONSES_VERIFIEES_V1]'
  if (!notes || notes.split(start).length !== 2 || notes.split(end).length !== 2) return null
  const a = notes.indexOf(start) + start.length, b = notes.indexOf(end)
  if (b < a) return null
  try {
    const v = JSON.parse(notes.slice(a, b))
    if (v.version !== 1 || !timestamp(v.checkedAt) || !timestamp(v.dernierRetourAt) ||
      v.dernierRetourAt > v.checkedAt) return null
    return { checkedAt: v.checkedAt, dernierRetourAt: v.dernierRetourAt }
  } catch { return null }
}

export function filtresSuivi(ligne: EtatCandidature): FiltreSuivi[] {
  const resultat: FiltreSuivi[] = []
  const statut = (ligne.statutFormation ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const arretee = ['termine', 'terminee', 'annule', 'annulee', 'abandonne', 'abandonnee'].includes(statut)
  const dates = [ligne.dateDebutFormation, ligne.dateFinFormation,
    ligne.contact?.formation.start, ligne.contact?.formation.end]
  const datesPresentes = dates.some(Boolean)
  if (!arretee) {
    if (statut === 'en cours') resultat.push('en-cours')
    else if (!ligne.provenanceInvalide && !ligne.anomaliesDates.length && dates.some(dateValide)) resultat.push('programmee')
    else if (!datesPresentes && !ligne.provenanceInvalide && ligne.formateurs.length) resultat.push('attente-programmation')
  }

  // The fourth filter is the exact complement of the first three, not a mailbox diagnosis.
  if (!resultat.length) resultat.push('autres')
  return resultat
}
