import { mediaSummary } from '../lib/media-summary'
import type { CommunicationRow, CommunicationSheet } from '../lib/communication'
const colors = ['#bbcfc8', '#7d9e93', '#4d7064', '#00382d', '#e6c75e', '#ce958e']
export function renderMediaDashboard(sheets: CommunicationSheet[], rows: CommunicationRow[]) {
  const root = document.getElementById('media-dashboard')
  if (!root) return
  const data = mediaSummary(sheets, rows)
  const summary = document.getElementById('media-summary')
  if (summary) summary.textContent = data.summary
  const el = (tag: string, text = '', cls = '') => {
    const n = document.createElement(tag)
    n.textContent = text
    n.className = cls
    return n
  }
  root.replaceChildren()
  root.hidden = false
  root.className = 'media-grid'
  const card = (title: string, wide = false) => {
    const c = el('article', '', 'media-card' + (wide ? ' media-wide' : ''))
    c.append(el('h2', title))
    root.append(c)
    return c
  }
  for (const [title, value] of [
    ['Médias ciblés', data.total],
    ['Contacts trouvés', `${data.contacts} / ${data.total}`],
    ['Contactés', data.contacted],
  ])
    card(String(title)).append(el('p', String(value), 'media-value'))
  const progress = card('Avancement', true),
    bar = el('div', '', 'media-bar'),
    legend = el('div', '', 'media-legend')
  bar.setAttribute('aria-hidden', 'true')
  data.statuses.forEach((s, i) => {
    const color = colors[i] || '#999'
    const segment = el('span')
    segment.style.width = `${data.total ? (s.count / data.total) * 100 : 0}%`
    segment.style.background = color
    bar.append(segment)
    const item = el('span', `${s.label} ${s.count}`),
      dot = el('i', '', 'media-dot')
    dot.style.background = color
    item.prepend(dot)
    legend.append(item)
  })
  progress.append(bar, legend)
  const people = card('Qui porte quoi'),
    list = el('ul', '', 'media-list')
  data.people.forEach((p) => {
    const li = el('li', p.label)
    li.append(el('strong', String(p.count)))
    list.append(li)
  })
  people.append(list)
  const ongoing = card('En cours'),
    active = el('ul', '', 'media-list')
  data.ongoing.forEach((m) => {
    const li = el('li', m.name)
    li.append(el('span', `${m.status} · ${m.person || 'Non attribué'}`))
    active.append(li)
  })
  ongoing.append(
    data.ongoing.length
      ? active
      : el('p', 'Aucun échange en cours. Les médias contactés ou en discussion apparaîtront ici.'),
  )
}
