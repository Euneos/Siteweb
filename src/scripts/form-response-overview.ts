import type { Respondent, ResponseOverview } from '../lib/form-response-overview'

const containers = document.querySelectorAll<HTMLElement>('[data-response-kind]')
const line = (person: Respondent, full = false) => {
  const item = document.createElement('li')
  item.textContent = `${person.name} — ${person.school} — ${person.role}`
  if (full) {
    const detail = document.createElement('small')
    const date = Date.parse(person.receivedAt)
    detail.textContent = `${person.id}${Number.isFinite(date) ? ` · ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(date)}` : ''}`
    item.append(detail)
    if (person.dossierId) {
      const link = document.createElement('a')
      link.href = `/etat-candidatures#dossier-${person.dossierId}`
      link.textContent = 'Consulter le dossier'
      item.append(link)
    }
  }
  return item
}
const message = (container: HTMLElement, value: string) => {
  const p = document.createElement('p')
  p.textContent = value
  container.replaceChildren(p)
}
function render(container: HTMLElement, group: ResponseOverview) {
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  const count = group.rows.length
  summary.textContent = `${count} réponse${count > 1 ? 's' : ''} reçue${count > 1 ? 's' : ''}`
  const action = document.createElement('span')
  action.className = 'fc-responses-action'
  action.textContent = count ? 'Voir toutes les réponses' : 'Voir le périmètre'
  summary.append(action)
  details.append(summary)
  const note = document.createElement('p')
  note.className = 'fc-responses-note'
  note.textContent = group.note
  details.append(note)
  const complete = document.createElement('ul')
  complete.className = 'fc-responses-all'
  // The complete list follows the team's catch-up order: oldest first.
  complete.append(...[...group.rows].reverse().map(person => line(person, true)))
  details.append(complete)
  const preview = document.createElement('ul')
  preview.className = 'fc-responses-preview'
  preview.append(...group.rows.slice(0, 2).map(person => line(person)))
  details.addEventListener('toggle', () => {
    preview.hidden = details.open
    action.textContent = details.open ? 'Réduire' : count ? 'Voir toutes les réponses' : 'Voir le périmètre'
  })
  container.replaceChildren(details, preview)
}
let loading = false
async function load() {
  if (loading || !containers.length) return
  loading = true
  for (const container of containers) message(container, 'Lecture des réponses…')
  try {
    const response = await fetch('/api/interne/apercu-reponses', { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error('Unavailable')
    const data = await response.json() as { preview?: boolean; groups: Record<string, ResponseOverview>; unavailable: Record<string, string> }
    for (const container of containers) {
      const key = container.dataset.responseKind!
      if (data.preview) message(container, 'Aperçu : réponses consultables en production.')
      else if (data.groups[key]) render(container, data.groups[key])
      else message(container, data.unavailable[key] || 'Réponses momentanément indisponibles.')
    }
  } catch {
    for (const container of containers) message(container, 'Réponses momentanément indisponibles. Cliquez sur Actualiser pour réessayer.')
  } finally { loading = false }
}
document.querySelector('#links-refresh')?.addEventListener('click', () => { void load() })
void load()
