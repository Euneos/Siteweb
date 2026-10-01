export type TimeSlot = { start: string; end: string }
export type DailyHours = {
  date: string
  planned: number | null
  actual: number | null
  slots?: TimeSlot[]
}

export function slotHours(slots: TimeSlot[]): number {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 2)
    throw new Error('Choisissez un ou deux créneaux par jour.')
  const minutes = (time: string) => {
    if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error('Horaire invalide.')
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  }
  let last = -1,
    total = 0
  for (const slot of slots) {
    if (!slot || typeof slot !== 'object') throw new Error('Créneau invalide.')
    const start = minutes(slot.start),
      end = minutes(slot.end)
    if (end <= start || start < last)
      throw new Error(
        'Les créneaux doivent être ordonnés, sans chevauchement et dans la même journée.',
      )
    last = end
    total += end - start
  }
  return Math.round((total / 60) * 100) / 100
}

export function parseDailyHours(value: string, start: string, end: string): DailyHours[] | null {
  if (!value) return null
  const rows: unknown = JSON.parse(value)
  if (!Array.isArray(rows) || rows.length > 31 || start.slice(0, 7) !== end.slice(0, 7))
    throw new Error('Le détail des heures doit couvrir un seul mois.')
  const seen = new Set<string>()
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') throw new Error('Jour invalide.')
      const { date, planned, actual, slots } = row as DailyHours
      if (
        typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date < start ||
        date > end ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date ||
        seen.has(date)
      )
        throw new Error('Chaque jour doit être unique et compris dans la période.')
      for (const hours of [planned, actual])
        if (
          hours !== null &&
          (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 24)
        )
          throw new Error('Les heures quotidiennes doivent être comprises entre 0 et 24.')
      if (planned === null && actual === null)
        throw new Error('Renseignez les heures prévues ou réalisées.')
      if (slots !== undefined && slotHours(slots) !== planned)
        throw new Error('Les heures prévues doivent correspondre aux créneaux.')
      seen.add(date)
      return {
        date,
        planned,
        actual,
        ...(slots === undefined ? {} : { slots: slots.map(({ start, end }) => ({ start, end })) }),
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function dailyTotal(rows: DailyHours[], field: 'planned' | 'actual'): number | null {
  const values = rows.map((row) => row[field]).filter((value): value is number => value !== null)
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100
    : null
}

export function entryOccursOn(
  entry: { kind: string; starts_on: string; ends_on: string; daily_hours?: string },
  date: string,
): boolean {
  if (entry.kind === 'equipe' && entry.daily_hours) {
    return parseDailyHours(entry.daily_hours, entry.starts_on, entry.ends_on)!.some(
      (row) => row.date === date,
    )
  }
  return entry.starts_on <= date && entry.ends_on >= date
}
