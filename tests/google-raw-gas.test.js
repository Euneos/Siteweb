import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { answerFields, parseCsv } from '../workers/google-transition/worker'
import { digest } from '../src/lib/google-form-sync'

const script = readFileSync(
  new URL('../scripts/google-forms/EuneosRawCapture.gs', import.meta.url),
  'utf8',
)
function harness(count = 2) {
  const sources = Array.from({ length: count }, (_, i) => ({
    spreadsheetId: 'fictional_gas_' + String(i).padStart(10, '0'),
    sheetId: i,
    firstRow: 2,
  }))
  const values = [
    ['Horodateur', 'Question', 'Question', 'Vide'],
    ['29/09/2026 10:00:00', '  texte é è  ', 'Citation "oui"\nligne', ''],
  ]
  const props = {
    EUNEOS_RAW_ENDPOINT: 'https://worker.invalid',
    EUNEOS_RAW_SECRET: 'fictional-gas-secret-over-32-characters',
    EUNEOS_RAW_SOURCES: JSON.stringify(sources),
    EUNEOS_RAW_ENABLED: 'false',
    OLD_PROPERTY: 'untouched',
  }
  const writes = [],
    calls = [],
    reads = [],
    logs = [],
    created = [],
    legacy = ['onDeploiement', 'mailCron']
  let unlocked = 0,
    locks = 0,
    busy = false,
    held = false,
    clock = Date.now()
  let response = () => ({
    state: 'checked',
    inputMode: 'push',
    projectionEnabled: false,
    enabled: true,
    configured: true,
    matched: 1,
    fresh: 0,
    changed: 0,
    missing: 0,
    pending: 0,
    differences: [],
  })
  const api = {
    Date: class extends Date {
      static now() {
        return clock
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => props[key] ?? null,
        setProperty: (key, value) => {
          writes.push(key)
          props[key] = value
        },
      }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        expect(held).toBe(false)
        reads.push(id)
        const s = sources.find((s) => s.spreadsheetId === id)
        if (!s) throw new Error('unknown_sheet')
        return {
          getSheets: () => [
            {
              getSheetId: () => s.sheetId,
              getLastRow: () => values.length,
              getLastColumn: () => values[0].length,
              getRange: (...args) => {
                expect(args).toEqual([1, 1, values.length, values[0].length])
                return { getDisplayValues: () => values }
              },
            },
          ],
        }
      },
    },
    Utilities: { newBlob: (body) => ({ getBytes: () => new TextEncoder().encode(body) }) },
    UrlFetchApp: {
      fetch: (url, options) => {
        expect(held).toBe(false)
        calls.push({ url, options, body: JSON.parse(options.payload) })
        expect(options.followRedirects).toBe(false)
        expect(options.headers).toEqual({ Authorization: 'Bearer ' + props.EUNEOS_RAW_SECRET })
        const result = response(url, JSON.parse(options.payload))
        return {
          getResponseCode: () => result.http ?? 200,
          getContentText: () => JSON.stringify(result),
        }
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          locks++
          held = !busy
          return !busy
        },
        releaseLock: () => {
          unlocked++
          held = false
        },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () =>
        [...legacy, ...created].map((name) => ({ getHandlerFunction: () => name })),
      newTrigger: (name) => ({
        timeBased: () => ({
          everyMinutes: (minutes) => ({
            create: () => {
              expect(minutes).toBe(15)
              created.push(name)
            },
          }),
        }),
      }),
    },
    console: { log: (text) => logs.push(text) },
  }
  runInNewContext(script, api)
  return {
    api,
    values,
    sources,
    props,
    writes,
    calls,
    reads,
    logs,
    created,
    legacy,
    respond: (fn) => {
      response = fn
    },
    setBusy: () => {
      busy = true
    },
    advance: (ms) => {
      clock += ms
    },
    locks: () => locks,
    unlocked: () => unlocked,
  }
}
test('GAS dry check reads all display strings, emits exact CSV-compatible hashes and never mutates', async () => {
  const h = harness(11)
  expect(h.api.euneosRawCheckDry()).toHaveLength(11)
  expect(h.calls.every((c) => c.url.endsWith('/check'))).toBe(true)
  expect(h.calls[0].body).toEqual({
    version: 1,
    source: { spreadsheetId: h.sources[0].spreadsheetId, sheetId: 0 },
    headers: h.values[0],
    rows: h.values.slice(1),
  })
  const csv = h.values
    .map((r) => r.map((c) => '"' + c.replaceAll('"', '""') + '"').join(','))
    .join('\r\n')
  const parsed = parseCsv(csv),
    body = h.calls[0].body
  expect(await digest(JSON.stringify(answerFields(body.headers, body.rows[0])))).toBe(
    await digest(JSON.stringify(answerFields(parsed[0], parsed[1]))),
  )
  expect(h.writes).toEqual([])
  expect(h.created).toEqual([])
  expect(h.locks()).toBe(0)
  expect(h.logs.join('')).not.toContain(h.values[1][1])
  expect(h.logs.join('')).not.toContain(h.props.EUNEOS_RAW_SECRET)
})
test('GAS disabled/busy sweep does no Google read, request, trigger or property write', () => {
  const h = harness()
  h.props.ENABLED = 'true' // an unrelated legacy flag must not enable this sender
  expect(h.api.euneosRawSweep().state).toBe('disabled')
  h.props.EUNEOS_RAW_ENABLED = 'true'
  h.setBusy()
  expect(() => h.api.euneosRawSweep()).toThrow('busy')
  expect(h.reads).toEqual([])
  expect(h.calls).toEqual([])
  expect(h.writes).toEqual([])
})
test('GAS install is explicit, requires dry readiness and leaves all old triggers intact', () => {
  const h = harness()
  expect(() => h.api.euneosRawInstallTrigger()).toThrow('disabled')
  h.props.EUNEOS_RAW_ENABLED = 'true'
  h.respond(() => ({
    state: 'checked',
    inputMode: 'push',
    configured: true,
    projectionEnabled: false,
    enabled: true,
    changed: 1,
    missing: 0,
    pending: 0,
  }))
  expect(() => h.api.euneosRawInstallTrigger()).toThrow('bootstrap_review_required')
  expect(h.created).toEqual([])
  h.respond(() => ({
    state: 'checked',
    inputMode: 'push',
    configured: true,
    projectionEnabled: false,
    enabled: true,
    changed: 0,
    missing: 0,
    pending: 0,
  }))
  expect(h.api.euneosRawInstallTrigger().state).toBe('installed')
  expect(h.api.euneosRawInstallTrigger().state).toBe('already_installed')
  expect(h.created).toEqual(['euneosRawSweep'])
  expect(h.legacy).toEqual(['onDeploiement', 'mailCron'])
  expect(h.writes).toEqual([])
  expect(h.unlocked()).toBe(2)
})
test('GAS sweep sends at most three sources, rotates past failures and stores no answers', () => {
  const h = harness(11)
  h.props.EUNEOS_RAW_ENABLED = 'true'
  h.respond((_url, body) => (body.source.sheetId === 0 ? { http: 401 } : { state: 'complete' }))
  expect(() => h.api.euneosRawSweep()).toThrow('source_failed_1')
  expect(h.calls).toHaveLength(3)
  expect(h.props.EUNEOS_RAW_NEXT_SOURCE).toBe('3')
  expect(h.api.euneosRawSweep()).toMatchObject({ state: 'complete', sources: 3 })
  expect(h.calls.slice(3).map((c) => c.body.source.sheetId)).toEqual([3, 4, 5])
  expect(new Set(h.writes)).toEqual(new Set(['EUNEOS_RAW_NEXT_SOURCE']))
  expect(h.props.OLD_PROPERTY).toBe('untouched')
  expect(h.created).toEqual([])
})
test('GAS time budget admits one slow source at a time without starving the next source', () => {
  const h = harness(6)
  h.props.EUNEOS_RAW_ENABLED = 'true'
  h.respond(() => {
    h.advance(160000)
    return { state: 'complete' }
  })
  for (let i = 0; i < 6; i++)
    expect(h.api.euneosRawSweep()).toMatchObject({ state: 'complete', sources: 1 })
  expect(h.calls.map((c) => c.body.source.sheetId)).toEqual([0, 1, 2, 3, 4, 5])
  expect(h.unlocked()).toBe(6)
})
test.each([401, 302, 503])('GAS never follows or conceals HTTP %s', (http) => {
  const h = harness()
  h.respond(() => ({ http }))
  expect(() => h.api.euneosRawCheckDry()).toThrow('worker_http_' + http)
  expect(h.calls).toHaveLength(1)
  expect(h.writes).toEqual([])
})
test('GAS rejects too-large snapshots and unencrypted endpoints before transmission', () => {
  const h = harness()
  h.values[1][1] = 'é'.repeat(500000)
  expect(() => h.api.euneosRawCheckDry()).toThrow('snapshot_too_large')
  expect(h.calls).toEqual([])
  h.props.EUNEOS_RAW_ENDPOINT = 'http://worker.invalid'
  expect(() => h.api.euneosRawCheckDry()).toThrow('configuration_invalid')
})
