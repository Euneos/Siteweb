/** Display contract only: these codes already exist in NocoDB. No migration. */
export const STATUTS_CANDIDATURE = [
  { code: 'Candidature recue', label: 'Candidature reçue' },
  { code: 'Candidature acceptée', label: 'Candidature acceptée' },
  { code: 'Engage', label: 'Établissement engagé' },
  { code: 'Abandonne', label: 'Abandon' },
  { code: 'Refuse', label: 'Refus' },
] as const

export type CodeStatutCandidature = (typeof STATUTS_CANDIDATURE)[number]['code']

const cle = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/’/g, "'")
    .trim()
    .toLowerCase()

export function estCodeStatutCandidature(value: unknown): value is CodeStatutCandidature {
  return STATUTS_CANDIDATURE.some((statut) => statut.code === value)
}

/** No dates, cohort, archive or supporting documents can promote a display label. */
export function statutCandidature(value: string | null | undefined): {
  code: CodeStatutCandidature | null
  label: string
} {
  const source = value?.trim() ?? ''
  const key = cle(source)
  const statut = STATUTS_CANDIDATURE.find((s) => cle(s.code) === key || cle(s.label) === key)
  if (statut) return statut
  if (key === "en cours d'analyse") return STATUTS_CANDIDATURE[0]
  return { code: null, label: source ? `${source} — historique à qualifier` : 'Non renseigné' }
}

/** Checkboxes only: strings such as "false" are not evidence. */
export function justificatifsEngagementPresents(dossier: {
  fiche_contact_recue?: unknown
  lettre_interet_signee?: unknown
}): boolean {
  const present = (value: unknown) => value === true || value === 1
  return present(dossier.fiche_contact_recue) && present(dossier.lettre_interet_signee)
}

export function candidatureArretee(value: string | null | undefined): boolean {
  const code = statutCandidature(value).code
  return code === 'Abandonne' || code === 'Refuse'
}
