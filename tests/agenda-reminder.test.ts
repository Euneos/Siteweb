import { test, expect } from 'bun:test'
import { generateKeyPairSync, sign, constants } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import {
  reminderDue,
  reminderPayload,
  verifyReminderSignature,
  sendAgendaReminder,
} from '../src/lib/agenda-reminder'
import type { WorkspaceDatabase } from '../src/lib/internal-workspace'
test('reminder follows Paris summer/winter time and only Monday at or after 11:30', () => {
  expect(reminderDue(new Date('2026-11-16T10:30:00Z'))).toBe(true)
  expect(reminderDue(new Date('2026-07-13T09:30:00Z'))).toBe(true)
  expect(reminderDue(new Date('2026-11-16T09:30:00Z'))).toBe(false)
  expect(reminderDue(new Date('2026-11-17T10:30:00Z'))).toBe(false)
})
test('signature binds date and check/send operation', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const signature = sign('sha256', Buffer.from(reminderPayload('2026-11-16', true)), {
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString('base64url')
  expect(await verifyReminderSignature('2026-11-16', true, signature, publicKey)).toBe(true)
  expect(await verifyReminderSignature('2026-11-16', false, signature, publicKey)).toBe(false)
  expect(await verifyReminderSignature('2026-11-23', true, signature, publicKey)).toBe(false)
})
test('one fixed-recipient email per Monday, no repeat after uncertain transport', async () => {
  const sql = new Database(':memory:')
  sql.exec(readFileSync('migrations/interne/0028_event_agenda.sql', 'utf8'))
  const db: WorkspaceDatabase = {
    prepare(q) {
      return {
        bind(...v) {
          return {
            all: async <T>() => ({ results: sql.query(q).all(...(v as any[])) as T[] }),
            first: async <T>() => sql.query(q).get(...(v as any[])) as T | null,
            run: async () => ({ meta: { changes: sql.query(q).run(...(v as any[])).changes } }),
          }
        },
      }
    },
    batch: async () => [],
  }
  let count = 0
  const send = async (env: any, mail: any) => {
    count++
    expect(mail.to).toBe('pauline.euneos@gmail.com')
    expect(mail.text).toContain('plus tard')
    return true
  }
  expect((await sendAgendaReminder(db, { BREVO_API_KEY: 'fake' }, '2026-11-16', send)).state).toBe(
    'sent',
  )
  expect((await sendAgendaReminder(db, { BREVO_API_KEY: 'fake' }, '2026-11-16', send)).state).toBe(
    'already_sent',
  )
  expect(count).toBe(1)
  const uncertain = async () => {
    count++
    throw new Error('response lost')
  }
  expect(
    (await sendAgendaReminder(db, { BREVO_API_KEY: 'fake' }, '2026-11-23', uncertain)).state,
  ).toBe('uncertain')
  await sendAgendaReminder(db, { BREVO_API_KEY: 'fake' }, '2026-11-23', uncertain)
  expect(count).toBe(2)
  sql.close()
})
