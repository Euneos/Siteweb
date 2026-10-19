/** Only the verified message metadata is projected; email bodies stay in the mailbox. */
export type DernierContact = {
  version: 1
  account: string
  checkedAt: string
  status: 'found' | 'not_found' | 'ambiguous'
  sentAt?: string
  subject?: string
  mailbox?: string
  uid?: number
  messageId?: string
  via?: 'etablissement' | 'formateur' | 'collectif'
}

const START = '[EUNEOS_LAST_CONTACT_V1]'
const END = '[/EUNEOS_LAST_CONTACT_V1]'
const timestamp = (v: unknown): v is string => typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v

export function lireDernierContact(notes: string | null | undefined): DernierContact | null {
  if (!notes) return null
  const start = notes.indexOf(START), end = notes.indexOf(END)
  if (start < 0 || end <= start || notes.indexOf(START, start + START.length) !== -1 ||
    notes.indexOf(END, end + END.length) !== -1) return null
  try {
    const raw = JSON.parse(notes.slice(start + START.length, end))
    if (!raw || raw.version !== 1 || typeof raw.account !== 'string' ||
      raw.account.trim().toLowerCase() !== 'charlotte@euneos.fr' || !timestamp(raw.checkedAt) ||
      !['found', 'not_found', 'ambiguous'].includes(raw.status)) return null
    const common = { version: 1 as const, account: 'charlotte@euneos.fr', checkedAt: raw.checkedAt, status: raw.status }
    if (raw.status !== 'found') return common
    if (!timestamp(raw.sentAt) || raw.sentAt > raw.checkedAt ||
      typeof raw.subject !== 'string' || !raw.subject.trim() || raw.subject.length > 1000 ||
      !['Sent', 'Sent Messages', 'Archive', 'INBOX'].includes(raw.mailbox) ||
      !Number.isSafeInteger(raw.uid) || raw.uid <= 0 ||
      typeof raw.messageId !== 'string' || !/^<[^<>\s]{1,510}>$/.test(raw.messageId) ||
      !['etablissement', 'formateur', 'collectif'].includes(raw.via)) return null
    return { ...common, sentAt: raw.sentAt, subject: raw.subject, mailbox: raw.mailbox,
      uid: raw.uid, messageId: raw.messageId, via: raw.via }
  } catch { return null }
}

/** A mailbox UID belongs to Charlotte's account, never to another team member's inbox. */
export function lienDernierContact(contact: DernierContact, viewerEmail: string): string | null {
  if (contact.status !== 'found' || viewerEmail.trim().toLowerCase() !== contact.account ||
    !contact.mailbox || !contact.uid) return null
  const params = new URLSearchParams({ _task: 'mail', _action: 'show', _mbox: contact.mailbox, _uid: String(contact.uid) })
  return `https://webmail.viaduc.fr/?${params}`
}

export function dateContactFr(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(value))
}
