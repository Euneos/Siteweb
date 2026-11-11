import { expect, test } from 'bun:test'
import { d1FailureLabel } from '../scripts/internal-migrations.mjs'

test('D1 diagnostics classify failures without echoing SQL, credentials or private rows', () => {
  for (const [message, label] of [
    ['CHECK constraint failed: private-row-content', 'contrainte CHECK'],
    ['FOREIGN KEY constraint failed: private-row-content', 'contrainte FOREIGN KEY'],
    ['not authorized token=private-secret', 'autorisation'],
    ['Expression tree is too large: private SQL', 'limite SQL'],
    ['fetch failed https://private.invalid/secret', 'transport réseau'],
    ['unrecognised provider response private-secret', 'cause non classée'],
  ]) expect(d1FailureLabel(message)).toBe(label)
})
