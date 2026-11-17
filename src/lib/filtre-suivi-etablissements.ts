import type { EtatCandidature } from './etat-candidatures'

export type FiltreSuivi = 'en-cours' | 'programmee' | 'attente-programmation' | 'a-relancer'

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

const jourParis = (date: Date) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)

export function filtresSuivi(ligne: EtatCandidature, maintenant = new Date()): FiltreSuivi[] {
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

  const verification = ligne.verificationReponses
  if (verification && !arretee && timestamp(verification.checkedAt) && timestamp(verification.dernierRetourAt) &&
    verification.dernierRetourAt <= verification.checkedAt &&
    // A check is a snapshot, not an automatic mailbox synchronisation.
    jourParis(new Date(verification.checkedAt)) === jourParis(maintenant) &&
    Date.parse(verification.checkedAt) <= maintenant.getTime()) {
    const retours = [verification.dernierRetourAt.slice(0, 10), ligne.contact?.receivedAt]
      .filter(dateValide).sort()
    const dernierRetour = retours.at(-1)!
    const aujourdHui = jourParis(maintenant)
    const [annee, mois, jour] = aujourdHui.split('-').map(Number)
    const dernierJourMoisPrecedent = new Date(Date.UTC(annee, mois - 1, 0)).getUTCDate()
    const seuil = new Date(Date.UTC(annee, mois - 2, Math.min(jour, dernierJourMoisPrecedent))).toISOString().slice(0, 10)
    if (dernierRetour < seuil) resultat.push('a-relancer')
  }
  return resultat
}
