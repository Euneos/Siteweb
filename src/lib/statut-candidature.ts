/** Stable filter codes; labels are the canonical values written to NocoDB. */
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

/** Accept only the five explicit choices (and their old API codes), not aliases
 * used for historical display such as « En cours d’analyse ». */
export function valeurStatutCandidature(value: unknown): string | null {
  return STATUTS_CANDIDATURE.find((s) => s.code === value || s.label === value)?.label ?? null
}

/** A blank current decision never inherits an old acceptance or engagement.
 * Only an unresolved historical value can be shown as « historique à qualifier ». */
export function sourceStatutDossier(row: { statut?: string | null; statut_origine?: string | null }): string | null {
  if (row.statut?.trim()) return row.statut
  return row.statut_origine?.trim() && statutCandidature(row.statut_origine).code === null
    ? row.statut_origine : null
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
