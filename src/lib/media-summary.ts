import type { CommunicationRow, CommunicationSheet } from './communication'
export const mediaStatuses = [
  'À contacter',
  'Contacté',
  'En discussion',
  'Partenariat',
  'En attente',
  'Refus',
]
export const mediaPeople = ['Candice', 'Charlotte', 'Pauline']
export function mediaSummary(sheets: CommunicationSheet[], rows: CommunicationRow[]) {
  const media = rows.flatMap((row) => {
    const sheet = sheets.find((s) => s.id === row.sheet_id && !s.guide)
    if (!sheet) return []
    const cell = (name: string) => (row.cells[sheet.columns.indexOf(name)] || '').trim()
    return [
      {
        name: cell('Nom média') || cell('Nom') || 'Média sans nom',
        contact: cell('Contact'),
        person: cell('Attribution'),
        status: cell('Statut') || 'À contacter',
      },
    ]
  })
  const total = media.length
  const contacts = media.filter(
    (m) => m.contact && m.contact.toLocaleLowerCase('fr') !== 'à trouver',
  ).length
  const contacted = media.filter((m) =>
    ['Contacté', 'En discussion', 'Partenariat', 'En attente', 'Refus'].includes(m.status),
  ).length
  const statuses = [...new Set([...mediaStatuses, ...media.map((m) => m.status)])].map((label) => ({
    label,
    count: media.filter((m) => m.status === label).length,
  }))
  const people = [...mediaPeople, 'Non attribués'].map((label) => ({
    label,
    count: media.filter((m) =>
      label === 'Non attribués' ? !mediaPeople.includes(m.person) : m.person === label,
    ).length,
  }))
  return {
    total,
    contacts,
    contacted,
    statuses,
    people,
    ongoing: media.filter((m) => ['Contacté', 'En discussion'].includes(m.status)),
    summary: `${total} média${total > 1 ? 's' : ''} ciblé${total > 1 ? 's' : ''}, ${contacts} contact${contacts > 1 ? 's' : ''} trouvé${contacts > 1 ? 's' : ''}, ${contacted ? `${contacted} média${contacted > 1 ? 's' : ''} contacté${contacted > 1 ? 's' : ''}` : 'aucun contacté pour l’instant'}.`,
  }
}
