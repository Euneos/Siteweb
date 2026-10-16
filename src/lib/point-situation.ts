import type { EtatCandidature } from './etat-candidatures'
import { statutCandidature } from './statut-candidature'

/** Summarize recorded facts without turning missing evidence into a negative fact. */
export function pointSituation(ligne: EtatCandidature): string {
  const statut = statutCandidature(ligne.statut).code
  if (statut === 'Abandonne') return 'Établissement en abandon ; dossier arrêté.'
  if (statut === 'Refuse') return 'Candidature refusée ; dossier arrêté.'
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
