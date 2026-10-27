import type { SuiviVerifie } from './suivi-verifie'

/** A dated interpretation, not a new verified fact or a decision of the team. */
export interface AideDeduite {
  version: 1
  nature: 'deduction'
  analysedAt: string
  sourceCheckedAt: string
  sourceSituation: string
  blocage: string
  aide: string
  actionProposee: boolean
}

export function lireAideDeduite(notes: string | null | undefined, source: SuiviVerifie | null | undefined): AideDeduite | null {
  const start = '[EUNEOS_AIDE_V1]', end = '[/EUNEOS_AIDE_V1]'
  if (!notes || !source || notes.split(start).length !== 2 || notes.split(end).length !== 2) return null
  const a = notes.indexOf(start) + start.length, b = notes.indexOf(end)
  if (b < a) return null
  try {
    const v = JSON.parse(notes.slice(a, b))
    const text = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 1500
    if (v.version !== 1 || v.nature !== 'deduction' || !text(v.analysedAt) || !Number.isFinite(Date.parse(v.analysedAt)) ||
      v.sourceCheckedAt !== source.checkedAt || v.sourceSituation !== source.situation ||
      Date.parse(v.analysedAt) < Date.parse(source.checkedAt) ||
      !text(v.blocage) || !text(v.aide) || typeof v.actionProposee !== 'boolean') return null
    return { version: 1, nature: 'deduction', analysedAt: v.analysedAt, sourceCheckedAt: v.sourceCheckedAt,
      sourceSituation: v.sourceSituation, blocage: v.blocage, aide: v.aide, actionProposee: v.actionProposee }
  } catch { return null }
}
