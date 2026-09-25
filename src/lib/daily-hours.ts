export type DailyHours = { date: string; planned: number | null; actual: number | null }

export function parseDailyHours(value: string, start: string, end: string): DailyHours[] | null {
  if (!value) return null
  const rows: unknown = JSON.parse(value)
  if (!Array.isArray(rows) || rows.length > 31 || start.slice(0, 7) !== end.slice(0, 7))
    throw new Error('Le détail des heures doit couvrir un seul mois.')
  const seen = new Set<string>()
  return rows.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('Jour invalide.')
    const { date, planned, actual } = row as DailyHours
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < start || date > end || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || seen.has(date))
      throw new Error('Chaque jour doit être unique et compris dans la période.')
    for (const hours of [planned, actual])
      if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 24))
        throw new Error('Les heures quotidiennes doivent être comprises entre 0 et 24.')
    if (planned === null && actual === null) throw new Error('Renseignez les heures prévues ou réalisées.')
    seen.add(date)
    return { date, planned, actual }
  }).sort((a, b) => a.date.localeCompare(b.date))
}

export function dailyTotal(rows: DailyHours[], field: 'planned' | 'actual'): number | null {
  const values = rows.map((row) => row[field]).filter((value): value is number => value !== null)
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100 : null
}

export function entryOccursOn(entry: { kind: string; starts_on: string; ends_on: string; daily_hours?: string }, date: string): boolean {
  if (entry.kind === 'equipe' && entry.daily_hours) {
    return parseDailyHours(entry.daily_hours, entry.starts_on, entry.ends_on)!.some((row) => row.date === date)
  }
  return entry.starts_on <= date && entry.ends_on >= date
}
