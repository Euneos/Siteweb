type ReviewState = 'pending' | 'unknown' | 'partial' | 'integrated'
export type ReviewFilter = 'pending' | 'partial' | 'integrated' | 'all'
export const reviewFilters: { value: ReviewFilter; label: string }[] = [
  { value: 'pending', label: 'À examiner' },
  { value: 'partial', label: 'Intégrations partielles' },
  { value: 'integrated', label: 'Intégrations attestées' },
  { value: 'all', label: 'Toutes les entrées' },
]
export function matchesReviewFilter(
  row: { state: ReviewState; operation?: { state: string } | null },
  filter: string,
) {
  if (filter === 'all') return true
  if (filter === 'pending')
    return row.state === 'pending' || row.state === 'unknown' || row.operation?.state === 'pending'
  return (filter === 'partial' || filter === 'integrated') && row.state === filter
}

const reasonLabels: Record<string, string> = {
  projection_pending: 'Réponse enregistrée ; traitement du dossier en attente.',
  mapping_not_configured: 'Réponse conservée ; reprise dans le dossier à configurer.',
  identity_ambiguous: 'La réponse ne peut pas être identifiée avec certitude dans l’historique.',
  identity_unresolved: 'Aucune identité correspondante n’a été confirmée.',
  identity_not_unique: 'Plusieurs personnes ou dossiers correspondent ; vérification nécessaire.',
  identity_conflict: 'Le nom ou les coordonnées diffèrent de la fiche existante.',
  cohort_unresolved: 'L’année scolaire n’est pas déterminée.',
  cohort_conflict: 'Le parcours ne correspond pas à l’année scolaire attendue.',
  establishment_unresolved: 'L’établissement n’a pas pu être rattaché avec certitude.',
  existing_value_conflict: 'Une valeur différente existe déjà et a été conservée.',
  linked_raw_only: 'Réponse rattachée au dossier ; champs métier non repris.',
  saved_raw_remaining: 'Certaines données sont reprises ; des réponses restent à examiner.',
  saved: 'Données reprises ; des réponses complémentaires restent à examiner.',
  sheet_headers_changed: 'Les questions du formulaire ont changé ; correspondance à vérifier.',
  business_write_uncertain: 'L’enregistrement doit être vérifié avant toute nouvelle tentative.',
  person_creation_already_claimed:
    'La création de cette personne est déjà réservée ; résultat à vérifier.',
  projection_configuration_changed:
    'La configuration a changé pendant la reprise ; vérification nécessaire.',
  application_value_invalid:
    'Une réponse ne correspond pas au format attendu et a été conservée dans le journal.',
}
/** Preserve human annotations and future codes without relabelling them as success. */
export function reviewReasonLabel(reason: string): string {
  return Object.hasOwn(reasonLabels, reason) ? reasonLabels[reason] : reason
}

/** Search only the explicit fields available in the review view. */
export function matchesReviewSearch(
  row: {
    id: number
    form: string
    answers: { question: string; answer: string }[]
    rawAnswers: string
    attachment?: { target: { label: string } } | null
    resolvedTargets?: { table: string; id: number; fields: string[]; label: string }[]
  },
  query: string,
) {
  return JSON.stringify([
    `Réponse #${row.id}`,
    `Formulaire source : ${row.form || 'Non précisé'}`,
    row.answers,
    row.rawAnswers,
    row.attachment?.target.label,
    row.resolvedTargets,
  ])
    .toLocaleLowerCase('fr')
    .includes(query.trim().toLocaleLowerCase('fr'))
}
