import { expect, test } from 'bun:test'
import { readBoardReport } from '../src/lib/board-report'
const report = { asOf: '2026-11-03', applications: 4, engagedSites: 3, applicationsInProgress: 1, professionals: 20, professionalSites: 2, regions: 2, started: 1, confirmedBeforeDecember: 2, goalSchools: 30, goalPeople: 240, nextStep: 'Exemple fictif', schedule: [{ title: 'Démarrés', count: 1, items: [{ name: 'Site fictif', timing: 'Octobre' }] }], developments: [{ title: 'Exemple', detail: 'Discussion en cours' }] }
test('point d’étape daté, projeté sans champs privés supplémentaires', () => {
  expect(readBoardReport(JSON.stringify({ ...report, secret: 'SECRET' }))).toEqual(report)
  expect(readBoardReport(undefined)).toBeNull()
})
test('refuse des compteurs ou un calendrier de synthèse incomplets', () => {
  expect(() => readBoardReport(JSON.stringify({ ...report, applications: -1 }))).toThrow()
  expect(() => readBoardReport(JSON.stringify({ ...report, schedule: [{ ...report.schedule[0], count: 2 }] }))).toThrow()
})
