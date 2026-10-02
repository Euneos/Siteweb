type ReviewState = 'pending' | 'unknown' | 'partial' | 'integrated'
export type ReviewFilter = 'pending' | 'partial' | 'integrated' | 'all'
export const reviewFilters: { value: ReviewFilter; label: string }[] = [
  { value: 'pending', label: 'À vérifier' },
  { value: 'partial', label: 'Informations déjà reportées en partie' },
  { value: 'integrated', label: 'Reports vérifiés' },
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
  identity_not_unique: 'Aucune correspondance unique n’a été confirmée.',
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

type ReviewPresentation = {
  id: number
  state: ReviewState
  form: string
  answers: { question: string; answer: string }[]
  receipt?: { reasons: string[] } | null
  attachment?: { target: { label: string } } | null
  operation?: { state: string } | null
  resolvedTargets?: { table: string; id: number; label: string; fields: string[] }[]
}
const normalizeLabel = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
/** Display declarations, never infer identity from free answers or a dossier match. */
export function reviewIdentity(row: Pick<ReviewPresentation, 'answers'>) {
  const read = (labels: string[]) => {
    const values = row.answers
      .filter((a) => labels.includes(normalizeLabel(a.question)))
      .map((a) => a.answer.trim())
      .filter(Boolean)
    return [...new Set(values)].join(' / ')
  }
  return {
    person:
      read([
        'prenom et nom',
        'nom et prenom',
        'nom prenom',
        'prenom nom',
        'votre nom et prenom',
        'participant',
      ]) ||
      [read(['prenom', 'votre prenom']), read(['nom', 'votre nom'])].filter(Boolean).join(' '),
    school: read([
      'etablissement',
      'votre etablissement',
      'nom de l etablissement',
      'nom etablissement',
      'etablissement concerne',
    ]),
    year: read(['annee scolaire', 'annee scolaire concernee', 'annee de formation']),
  }
}
export function reviewTitle(row: Pick<ReviewPresentation, 'id' | 'answers'>) {
  const identity = reviewIdentity(row)
  return (
    [identity.person, identity.school].filter(Boolean).join(' — ') ||
    `Réponse #${row.id} — identité à lire dans le formulaire`
  )
}

export function reviewGuidance(row: ReviewPresentation) {
  const reasons = row.receipt?.reasons ?? []
  const hasTarget = !!row.attachment || !!row.resolvedTargets?.length
  const uncertain =
    row.operation?.state === 'pending' || reasons.includes('business_write_uncertain')
  if (uncertain)
    return {
      title: 'Faire vérifier le dernier enregistrement',
      owner: 'Vérification technique',
      canAttach: false,
      next: 'Le résultat d’une précédente action est incertain. Utilisez la vérification du résultat si elle est proposée, ou transmettez la demande avant de recommencer.',
    }
  if (row.state === 'integrated')
    return {
      title: 'Les informations prévues ont été reportées',
      owner: 'Consultation',
      canAttach: false,
      next: 'Aucune confirmation n’est demandée ici. Vous pouvez consulter les informations reportées et la réponse d’origine.',
    }
  if (row.attachment)
    return {
      title: 'Le dossier a été confirmé ; le report reste à vérifier',
      owner: 'Reprise à terminer',
      canAttach: false,
      next: 'Votre choix est enregistré. Consultez les corrections proposées ci-dessous pour terminer le report dans ce dossier.',
    }
  const conflicting =
    reasons.includes('existing_value_conflict') ||
    reasons.some((r) => /(?:date|fin|début).*à confirmer/i.test(r))
  if (conflicting)
    return {
      title: 'Quelle information faut-il conserver ?',
      owner: 'Information à confirmer par l’équipe',
      canAttach: false,
      next: 'Lisez la réponse ci-dessous et comparez-la au dossier. Si une correction est disponible ci-dessous, indiquez les valeurs confirmées puis relisez l’aperçu avant de les appliquer. Sinon, préparez une demande avec la valeur à retenir.',
    }
  const missingYear = reasons.some(
    (r) =>
      ['cohort_unresolved', 'cohort_conflict'].includes(r) ||
      /année.*(?:confirmer|détermin|absent|manquant)/i.test(r),
  )
  const missingDossier = reasons.some(
    (r) =>
      [
        'identity_ambiguous',
        'identity_unresolved',
        'identity_not_unique',
        'identity_conflict',
        'establishment_unresolved',
      ].includes(r) || /^Établissement déclaré à rattacher\s*:/i.test(r),
  )
  if (!hasTarget && (missingYear || missingDossier))
    return {
      title: missingYear
        ? 'Quelle année et quel dossier concernent cette réponse ?'
        : 'À quel dossier appartient cette réponse ?',
      owner: 'Information à confirmer par l’équipe',
      canAttach: !row.operation,
      next: 'Vérifiez l’identité et l’année dans la réponse. Si vous connaissez le dossier exact, confirmez-le ci-dessous. Les corrections disponibles seront préparées dans un aperçu, puis appliquées après votre confirmation. Une identité absente ou contradictoire restera à vérifier.',
    }
  if (row.state === 'partial')
    return {
      title: 'Certaines informations sont déjà reportées',
      owner: 'Reprise à vérifier',
      canAttach: false,
      next: 'Consultez ce qui a déjà été reporté et le motif restant. Les réponses détaillées peuvent rester dans le formulaire d’origine : cela ne signifie pas qu’il faut tout ressaisir. Transmettez une demande si une information nécessaire manque au dossier.',
    }
  return {
    title: 'Le report dans la base doit être vérifié',
    owner: 'Vérification technique',
    canAttach: false,
    next: 'La réponse est conservée, mais les preuves disponibles ne permettent pas de confirmer son report. Transmettez la demande de vérification ; ne créez pas de nouveau dossier sur cette seule indication.',
  }
}
export function reviewRequest(row: ReviewPresentation) {
  const identity = reviewIdentity(row),
    guidance = reviewGuidance(row)
  return [
    `EUNEOS — vérifier la réponse Google #${row.id} (${row.form}).`,
    `Déclaration : ${reviewTitle(row)}${identity.year ? ` — ${identity.year}` : ''}.`,
    guidance.title,
    ...(row.receipt?.reasons ?? []).map(reviewReasonLabel),
    row.attachment ? `Dossier confirmé : ${row.attachment.target.label}.` : '',
    'Ma précision : [indiquer la bonne information ou ce qui manque].',
    'Comparer la réponse d’origine au dossier, puis préparer la correction exacte. Ne pas créer de doublon ni déduire une année ou une identité.',
    `Source interne : https://euneos.fr/interne/reponses-google#reponse-${row.id}`,
  ]
    .filter(Boolean)
    .join('\n')
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
