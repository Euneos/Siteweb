import { NC } from './nocodb'

// Only these two audited applications were already notified by the source system.
// The marker is written by the migration, never by a public application form.
export const IMPORT_CANDIDATURE_VERSION = 'euneos-reprise-2026-09-21-v1'
export const IMPORT_CANDIDATURE_MARKER = `[${IMPORT_CANDIDATURE_VERSION}:notification-source-deja-envoyee]`
const REPRISES = new Map([
  ['ETAB-C2-46', { etablissement: 60 }],
  ['ETAB-C2-48', { etablissement: 61 }],
])

type Ligne = Record<string, unknown>

/** Fail closed on a malformed migration marker, before sending any batch email. */
export function separerReprises(charge: Ligne, lignes: Ligne[]) {
  const data = charge.data as Ligne | undefined
  const nouvelles: Ligne[] = []
  let reprises = 0
  for (const ligne of lignes) {
    const notes = typeof ligne.notes === 'string' ? ligne.notes : ''
    if (!notes.includes(IMPORT_CANDIDATURE_VERSION)) {
      nouvelles.push(ligne)
      continue
    }
    const reprise = REPRISES.get(String(ligne.code))
    if (
      !reprise ||
      !notes.split(/\r?\n/).includes(IMPORT_CANDIDATURE_MARKER) ||
      charge.type !== 'records.after.insert' ||
      charge.version !== 'v3' ||
      data?.table_id !== NC.tables.participations ||
      ligne.etablissements_id !== reprise.etablissement ||
      ligne.cohortes_id !== 2
    ) {
      throw new Error('reprise historique non reconnue')
    }
    reprises++
  }
  return { nouvelles, reprises }
}
