import { partnershipSummary } from '../lib/partnership-summary'
import type { CommunicationRow, CommunicationSheet } from '../lib/communication'
import type { ChoiceCatalog } from '../lib/communication-choices'
const colors = ['#bbcfc8', '#7d9e93', '#4d7064', '#00382d', '#e6c75e', '#ce958e']
export function renderPartnershipDashboard(
  sheets: CommunicationSheet[],
  rows: CommunicationRow[],
  catalog: ChoiceCatalog,
) {
  const root = document.getElementById('partnership-dashboard')
  if (!root) return
  const data = partnershipSummary(sheets, rows, catalog)
  const date = document.getElementById('partnership-updated')
  if (date)
    date.textContent = data.updated
      ? `Mise à jour : ${new Date(data.updated).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' })}`
      : 'Mise à jour : aucune donnée'
  const el = (tag: string, text = '', cls = '') => {
    const n = document.createElement(tag)
    n.textContent = text
    n.className = cls
    return n
  }
  root.replaceChildren()
  root.hidden = false
  root.className = 'media-grid partner-grid'
  const card = (title: string, wide = false) => {
    const c = el('article', '', 'media-card' + (wide ? ' media-wide' : ''))
    c.append(el('h2', title))
    root.append(c)
    return c
  }
  data.counters.forEach((c) => {
    const box = card(c.label),
      bar = el('div', '', 'media-bar'),
      fill = el('span')
    box.append(el('p', `${c.count} / ${c.total}`, 'media-value'))
    fill.style.width = `${c.total ? Math.min(100, (100 * c.count) / c.total) : 0}%`
    fill.style.background = '#00382d'
    bar.setAttribute('role', 'progressbar')
    bar.setAttribute('aria-label', c.label)
    bar.setAttribute('aria-valuemin', '0')
    bar.setAttribute('aria-valuemax', String(c.total || 1))
    bar.setAttribute('aria-valuenow', String(Math.min(c.count, c.total)))
    bar.setAttribute('aria-valuetext', `${c.count} sur ${c.total}`)
    bar.append(fill)
    box.append(bar)
  })
  const priority = card('Priorité A : où on en est', true)
  data.priorities.forEach((group) => {
    priority.append(el('h3', `${group.label} · ${group.total} ligne${group.total > 1 ? 's' : ''}`))
    const bar = el('div', '', 'media-bar'),
      legend = el('div', '', 'media-legend')
    bar.setAttribute('aria-hidden', 'true')
    group.statuses.forEach((s, i) => {
      const color = colors[i] || '#777',
        segment = el('span'),
        item = el('span', `${s.label} ${s.count}`),
        dot = el('i', '', 'media-dot')
      segment.style.width = `${group.total ? (s.count / group.total) * 100 : 0}%`
      segment.style.background = color
      dot.style.background = color
      item.prepend(dot)
      bar.append(segment)
      legend.append(item)
    })
    priority.append(bar, legend)
    if (!group.total) priority.append(el('p', 'Aucune ligne de priorité A.'))
  })
  const people = card('Qui porte quoi', true),
    list = el('ul', '', 'media-list')
  data.people.forEach((p) => {
    const li = el('li', p.label, p.label === 'Non attribuées' ? 'partner-alert' : '')
    li.append(el('strong', String(p.count)))
    list.append(li)
  })
  people.append(list)
}
