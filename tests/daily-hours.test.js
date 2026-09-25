import { expect, test } from 'bun:test'
import { entryOccursOn, parseDailyHours, dailyTotal } from '../src/lib/daily-hours'
test('seuls les jours choisis apparaissent, y compris après déplacement de la demi-journée', () => {
  const rows = [{ date: '2026-09-01', planned: 7, actual: 8 }, { date: '2026-09-03', planned: 7, actual: null }, { date: '2026-09-04', planned: 3.5, actual: null }]
  const entry = { kind: 'equipe', starts_on: '2026-09-01', ends_on: '2026-09-30', daily_hours: JSON.stringify(rows) }
  const dates = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
  expect(dates.filter((date) => entryOccursOn(entry, date))).toEqual(['2026-09-01', '2026-09-03', '2026-09-04'])
  rows[2].date = '2026-09-02'
  entry.daily_hours = JSON.stringify(rows)
  expect(entryOccursOn(entry, '2026-09-04')).toBe(false)
  expect(entryOccursOn(entry, '2026-09-02')).toBe(true)
  expect(dailyTotal(rows, 'planned')).toBe(17.5)
  expect(dailyTotal(rows, 'actual')).toBe(8)
})
test('les anciennes plages restent compatibles ; aucune répartition inventée', () => {
  expect(entryOccursOn({ kind: 'equipe', starts_on: '2026-09-01', ends_on: '2026-09-30' }, '2026-09-06')).toBe(true)
  expect(parseDailyHours('', '2026-09-01', '2026-09-30')).toBeNull()
  expect(dailyTotal([{ date: '2026-09-01', planned: 7, actual: null }], 'actual')).toBeNull()
})
test('refuse les dates invalides et doublons', () => {
  const row = { date: '2026-09-01', planned: 7, actual: null }
  expect(() => parseDailyHours(JSON.stringify([row, row]), '2026-09-01', '2026-09-30')).toThrow()
  expect(() => parseDailyHours(JSON.stringify([{ ...row, date: '2026-02-30' }]), '2026-02-01', '2026-02-31')).toThrow()
})
