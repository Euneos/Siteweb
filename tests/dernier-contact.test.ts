import { describe, expect, test } from 'bun:test'
import { lireDernierContact, lienDernierContact, dateContactFr } from '../src/lib/dernier-contact'

const source = {
  version: 1, account: 'charlotte@euneos.fr', checkedAt: '2026-10-16T16:00:00.000Z', status: 'found',
  sentAt: '2026-10-06T16:46:19.000Z', subject: 'Relance établissement', mailbox: 'Sent', uid: 84,
  messageId: '<message-84@euneos.fr>', via: 'collectif',
}
const notes = (value: unknown) => `Notes privées\n[EUNEOS_LAST_CONTACT_V1]\n${JSON.stringify(value)}\n[/EUNEOS_LAST_CONTACT_V1]`

describe('Dernier contact : preuve et lien de messagerie', () => {
  test('ne publie ni le corps du mail ni des champs non autorisés', () => {
    const parsed = lireDernierContact(notes({ ...source, body: 'secret', url: 'https://evil.test' }))!
    expect(parsed.subject).toBe(source.subject)
    expect(parsed).not.toHaveProperty('body')
    expect(parsed).not.toHaveProperty('url')
    expect(lienDernierContact(parsed, 'Charlotte@euneos.fr')).toBe('https://webmail.viaduc.fr/?_task=mail&_action=show&_mbox=Sent&_uid=84')
    expect(lienDernierContact(parsed, 'pauline@euneos.fr')).toBeNull()
  })
  test('rejette une date future, un UID invalide ou une provenance ambiguë', () => {
    expect(lireDernierContact(notes({ ...source, sentAt: '2027-10-16T16:00:00.000Z' }))).toBeNull()
    expect(lireDernierContact(notes({ ...source, uid: -1 }))).toBeNull()
    expect(lireDernierContact(notes({ ...source, mailbox: 'https://evil.test' }))).toBeNull()
    expect(lireDernierContact(notes(source) + notes(source))).toBeNull()
    expect(lireDernierContact('[EUNEOS_LAST_CONTACT_V1]{cassé[/EUNEOS_LAST_CONTACT_V1]')).toBeNull()
    expect(lireDernierContact('Relance prévue le 06/10')).toBeNull()
  })
  test('un contact partagé ne devient jamais un envoi attribué', () => {
    const parsed = lireDernierContact(notes({ ...source, status: 'ambiguous' }))!
    expect(parsed).not.toHaveProperty('sentAt')
    expect(lienDernierContact(parsed, source.account)).toBeNull()
  })
  test('la date affichée utilise le fuseau de Paris', () => {
    expect(dateContactFr('2026-10-06T16:46:19.000Z')).toContain('18:46')
  })
})
