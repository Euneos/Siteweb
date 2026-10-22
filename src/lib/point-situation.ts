import type { EtatCandidature } from './etat-candidatures'
import { statutCandidature } from './statut-candidature'

export type SituationVerifiee = {
  version: 1
  text: string
  checkedAt: string
  sourceAt: string
  sourceKind: 'mail-envoye' | 'echange-interne'
  sourceMessageIds: string[]
}

export function lireSituationVerifiee(notes: string | null | undefined): SituationVerifiee | null {
  const startTag = '[EUNEOS_SITUATION_V1]', endTag = '[/EUNEOS_SITUATION_V1]'
  if (!notes) return null
  const start = notes.indexOf(startTag), end = notes.indexOf(endTag)
  if (start < 0 || end <= start || notes.indexOf(startTag, start + startTag.length) !== -1 ||
    notes.indexOf(endTag, end + endTag.length) !== -1) return null
  try {
    const value = JSON.parse(notes.slice(start + startTag.length, end))
    const timestamp = (date: unknown): date is string => typeof date === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) &&
      Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === date
    if (value.version !== 1 || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 900 ||
      !timestamp(value.checkedAt) || !timestamp(value.sourceAt) || value.sourceAt > value.checkedAt ||
      !['mail-envoye', 'echange-interne'].includes(value.sourceKind) ||
      !Array.isArray(value.sourceMessageIds) || !value.sourceMessageIds.length || value.sourceMessageIds.length > 5 ||
      !value.sourceMessageIds.every((id: unknown) => typeof id === 'string' && /^<[^<>\s]{1,510}>$/.test(id))) return null
    return { version: 1, text: value.text, checkedAt: value.checkedAt, sourceAt: value.sourceAt,
      sourceKind: value.sourceKind, sourceMessageIds: value.sourceMessageIds }
  } catch { return null }
}

export function situationCourante(ligne: EtatCandidature): SituationVerifiee | null {
  const statut = statutCandidature(ligne.statut).code
  if (statut === 'Abandonne' || statut === 'Refuse') return null
  const situation = ligne.situationVerifiee
  if (!situation || (ligne.dernierContact?.sentAt && ligne.dernierContact.sentAt > situation.sourceAt)) return null
  return situation
}

/** Summarize recorded facts without turning missing evidence into a negative fact. */
export function pointSituation(ligne: EtatCandidature): string {
  const statut = statutCandidature(ligne.statut).code
  if (statut === 'Abandonne') return 'Établissement en abandon ; dossier arrêté.'
  if (statut === 'Refuse') return 'Candidature refusée ; dossier arrêté.'
  if (ligne.suiviVerifie) return ligne.suiviVerifie.situation
  const situation = situationCourante(ligne)
  if (situation) return situation.text
  const faits: string[] = []
  const suite: string[] = []
  const formation = (ligne.statutFormation ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  if (formation === 'termine' || formation === 'terminee') faits.push('Formation terminée selon le suivi')
  else if (formation === 'en cours') faits.push('Formation en cours selon le suivi')
  if (ligne.lettreSignee && ligne.ficheContactRecue) faits.push('Lettre signée et fiche contact reçues')
  else {
    if (ligne.lettreSignee) faits.push('Lettre signée reçue')
    else suite.push('réception de la lettre signée à confirmer')
    if (ligne.ficheContactRecue) faits.push('Fiche contact reçue')
    else suite.push('réception de la fiche contact à confirmer')
  }
  if (statut === 'Candidature recue') suite.push('décision de candidature en attente')
  else if (statut === null) suite.push('statut de candidature à qualifier')
  if (ligne.aVerifier) suite.push('rattachement du dossier à vérifier')
  if (ligne.provenanceInvalide || ligne.anomaliesDates.length) {
    suite.push('informations du formulaire ou dates à vérifier')
  } else if (ligne.lettreSignee && ligne.ficheContactRecue) {
    if (!ligne.formateurs.length) suite.push(ligne.contact?.declaredTrainers.length
      ? 'formateur déclaré mais affectation à enregistrer' : 'formateur à confirmer')
    if (!ligne.dateDebutFormation || !ligne.dateFinFormation) suite.push('calendrier à préciser')
    else faits.push('Calendrier renseigné')
    if (ligne.formateurs.length) faits.push('Formateur affecté')
    if (!suite.length) suite.push(formation === 'termine' || formation === 'terminee'
      ? 'bilan et ateliers à documenter' : 'suivi de la formation et des ateliers à poursuivre')
  }
  const phrase = [...faits, ...suite].join(' ; ')
  return phrase.charAt(0).toUpperCase() + phrase.slice(1) + '.'
}
