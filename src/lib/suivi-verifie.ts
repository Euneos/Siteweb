/** Human-reviewed operational summary. Raw mail bodies never reach the page. */
export interface SuiviVerifie {
  version: 1
  checkedAt: string
  dateDeReference: string | null
  qualification: 'confirmée' | 'prévisionnelle' | 'à vérifier' | 'non renseignée'
  referent: string
  situation: string
  organisation: string
  organisationRecue: boolean
  formationPrecision?: string
  sources: string[]
}

export function lireSuiviVerifie(notes?: string | null): SuiviVerifie | null {
  const start = '[EUNEOS_SUIVI_VERIFIE_V1]', end = '[/EUNEOS_SUIVI_VERIFIE_V1]'
  if (!notes || notes.split(start).length !== 2 || notes.split(end).length !== 2) return null
  const a = notes.indexOf(start) + start.length, b = notes.indexOf(end)
  if (b < a) return null
  try {
    const v = JSON.parse(notes.slice(a, b))
    const text = (s: unknown): s is string => typeof s === 'string' && s.length <= 1500
    if (v.version !== 1 || !text(v.checkedAt) || !Number.isFinite(Date.parse(v.checkedAt)) ||
      !(v.dateDeReference === null || (typeof v.dateDeReference === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.dateDeReference))) ||
      !['confirmée', 'prévisionnelle', 'à vérifier', 'non renseignée'].includes(v.qualification) ||
      !text(v.referent) || !text(v.situation) || !text(v.organisation) || typeof v.organisationRecue !== 'boolean' ||
      (v.formationPrecision !== undefined && !text(v.formationPrecision)) ||
      !Array.isArray(v.sources) || v.sources.length > 10 || !v.sources.every(text)) return null
    // Explicit projection only; no arbitrary note fields or HTML.
    return { version: 1, checkedAt: v.checkedAt, dateDeReference: v.dateDeReference,
      qualification: v.qualification, referent: v.referent, situation: v.situation,
      organisation: v.organisation, organisationRecue: v.organisationRecue, sources: v.sources,
      ...(v.formationPrecision !== undefined ? { formationPrecision: v.formationPrecision } : {}) }
  } catch { return null }
}
