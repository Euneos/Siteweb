/** Validated management report, stored in a private runtime secret, never public Git. */
export interface BoardReport {
  asOf: string
  applications: number
  engagedSites: number
  applicationsInProgress: number
  professionals: number
  professionalSites: number
  regions: number
  started: number
  confirmedBeforeDecember: number
  goalSchools: number
  goalPeople: number
  nextStep: string
  review?: { asOf: string; professionals: number; detail: string; applicationsNote: string; evaluation: string }
  developments: { title: string; detail: string }[]
  schedule: { title: string; count: number; items: { name: string; timing: string }[] }[]
}
export function readBoardReport(raw: unknown): BoardReport | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') throw new Error('Point d’étape invalide')
  const value = JSON.parse(raw)
  const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 10000
  const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 2000
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf) || !Number.isFinite(Date.parse(value.asOf)) || !text(value.nextStep)) throw new Error('Point d’étape invalide')
  const keys = ['applications', 'engagedSites', 'applicationsInProgress', 'professionals', 'professionalSites', 'regions', 'started', 'confirmedBeforeDecember', 'goalSchools', 'goalPeople'] as const
  if (keys.some(key => !count(value[key])) || !Array.isArray(value.schedule) || value.schedule.length > 6) throw new Error('Point d’étape invalide')
  const schedule = value.schedule.map((group: Record<string, unknown>) => {
    if (!text(group.title) || !count(group.count) || !Array.isArray(group.items) || group.items.length !== group.count) throw new Error('Calendrier du point d’étape invalide')
    return { title: group.title, count: Number(group.count), items: group.items.map(item => {
      if (!item || !text(item.name) || !text(item.timing)) throw new Error('Calendrier du point d’étape invalide')
      return { name: item.name, timing: item.timing }
    }) }
  })
  if (!Array.isArray(value.developments) || value.developments.length > 12) throw new Error('Actualités invalides')
  const developments = value.developments.map((item: Record<string, unknown>) => {
    if (!text(item.title) || !text(item.detail)) throw new Error('Actualité invalide')
    return { title: item.title, detail: item.detail }
  })
  let review: BoardReport['review']
  if (value.review != null) {
    const r = value.review
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.asOf) || !count(r.professionals) || !text(r.detail) || !text(r.applicationsNote) || !text(r.evaluation)) throw new Error('Vérification invalide')
    review = { asOf: r.asOf, professionals: r.professionals, detail: r.detail, applicationsNote: r.applicationsNote, evaluation: r.evaluation }
  }
  return { asOf: value.asOf, ...Object.fromEntries(keys.map(key => [key, value[key]])), nextStep: value.nextStep, schedule, developments, ...(review ? { review } : {}) } as BoardReport
}
