import { expect, test } from 'bun:test'
import { d1FailureLabel, d1FailureCodes } from '../scripts/internal-migrations.mjs'

test('D1 diagnostics classify failures without echoing SQL, credentials or private rows', () => {
  for (const [message, label] of [
    ['CHECK constraint failed: private-row-content', 'contrainte CHECK'],
    ['FOREIGN KEY constraint failed: private-row-content', 'contrainte FOREIGN KEY'],
    ['not authorized token=private-secret', 'autorisation'],
    ['Expression tree is too large: private SQL', 'limite SQL'],
    ['fetch failed https://private.invalid/secret', 'transport réseau'],
    ['unrecognised provider response private-secret', 'cause non classée'],
  ])
    expect(d1FailureLabel(message)).toBe(label)
})

test('D1 diagnostics expose only provider numbers and fixed SQLite enum names', () => {
  expect(d1FailureCodes('private-content token=secret [code: 7500] SQLITE_ERROR')).toBe(
    '7500,SQLITE_ERROR',
  )
  expect(d1FailureCodes('{"code":10000,"message":"private-row-secret"}')).toBe('10000')
  expect(
    d1FailureCodes('private email@example.test secret [code: 42424242] SQLITE_PRIVATE_SECRET'),
  ).toBe('absent')
  expect(d1FailureLabel('incomplete input: private-row SQLITE_ERROR')).toBe(
    'instruction SQL incomplète',
  )
  expect(
    d1FailureLabel('To execute a transaction use state.storage.transaction() private-row'),
  ).toBe('transaction SQL non prise en charge')
})
