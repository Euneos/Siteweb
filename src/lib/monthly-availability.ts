import { parseDailyHours, slotHours, type DailyHours, type TimeSlot } from './daily-hours'

export const MONTHLY_ACTIVITY = 'Disponibilités mensuelles'
export type WeekRule = { weekday: number; slots: TimeSlot[] }

/** Replace planned time only, preserving every actual value including explicit zero.
 * Exceptions are then edited by date. Reapplying requires an explicit UI confirmation. */
export function planMonth(
  start: string,
  end: string,
  rules: WeekRule[],
  previous: DailyHours[],
): DailyHours[] {
  parseDailyHours(JSON.stringify(previous), start, end)
  if (
    !Array.isArray(rules) ||
    rules.length > 7 ||
    new Set(rules.map((r) => r.weekday)).size !== rules.length
  )
    throw new Error('Chaque jour de la semaine doit être unique.')
  for (const rule of rules) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6)
      throw new Error('Jour de semaine invalide.')
    slotHours(rule.slots)
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    start > end ||
    start.slice(0, 7) !== end.slice(0, 7) ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    new Date(start).toISOString().slice(0, 10) !== start ||
    new Date(end).toISOString().slice(0, 10) !== end
  )
    throw new Error('Choisissez une période valide dans un seul mois.')
  const result: DailyHours[] = []
  for (
    let day = new Date(start + 'T12:00:00Z');
    day.toISOString().slice(0, 10) <= end;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const date = day.toISOString().slice(0, 10)
    const rule = rules.find((r) => r.weekday === day.getUTCDay())
    const actual = previous.find((r) => r.date === date)?.actual ?? null
    if (rule || actual !== null)
      result.push({
        date,
        actual,
        planned: rule ? slotHours(rule.slots) : null,
        ...(rule ? { slots: rule.slots.map((s) => ({ ...s })) } : {}),
      })
  }
  return result
}

/** One immutable identity per person/month, even across tabs, retries and clients.
 * Uses the existing primary key: no new storage or migration required. */
export async function monthlyAvailabilityId(person: string, month: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        `euneos-monthly-availability-v1\n${person.trim().toLowerCase()}\n${month}`,
      ),
    ),
  )
  bytes[6] = (bytes[6] & 15) | 80
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes.slice(0, 16)].map((v) => v.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
