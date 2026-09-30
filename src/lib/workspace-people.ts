export const workspacePeople = ['Pauline', 'Candice', 'Charlotte', 'Partenaires'] as const
export const workspaceActivities = ['Communication', 'Direction générale', 'Coordination'] as const

/** Presentation only; never use an arbitrary display name as an authenticated identity. */
export function personName(value: string): string {
  const first = value.trim().split('@')[0].split(/[.\s_+-]/)[0]
  if (first.toLowerCase() === 'gouvernance') return 'Candice'
  return workspacePeople.find((name) => name.toLowerCase() === first.toLowerCase())
    ?? (first ? first[0].toUpperCase() + first.slice(1) : '')
}
export function isOwnPerson(person: string, email: string): boolean {
  // First names are presentation labels, never proof of ownership. Team
  // managers can assign them; a member's own record keeps its exact email.
  return person.trim().toLowerCase() === email.trim().toLowerCase()
}
