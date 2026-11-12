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
  const profiles = card('Équilibre des profils', true),
    pools = el('div', '', 'partner-tiles')
  profiles.append(el('p', 'Parrains au statut Partenariat ou En discussion.'))
  data.pools.forEach((p) => {
    const tile = el('div', '', 'partner-tile' + (!p.count ? ' partner-missing' : ''))
    tile.append(el('strong', String(p.count), 'media-value'), el('span', p.label))
    if (!p.count) tile.append(el('small', 'Pas encore représenté'))
    pools.append(tile)
  })
  profiles.append(data.pools.length ? pools : el('p', 'Aucun vivier renseigné.'))
  if (data.missingPool)
    profiles.append(
      el('p', `${data.missingPool} parrain(s) sans vivier renseigné.`, 'partner-alert'),
    )
  const relations = card('Partenaires par type de relation', true),
    types = el('div', '', 'partner-tiles')
  data.relations.forEach((r) => {
    const tile = el('div', '', 'partner-tile')
    tile.append(el('strong', String(r.count), 'media-value'), el('span', r.label))
    types.append(tile)
  })
  relations.append(data.relations.length ? types : el('p', 'Aucun partenaire renseigné.'))
  const people = card('Qui porte quoi', true),
    list = el('ul', '', 'media-list')
  data.people.forEach((p) => {
    const li = el('li', p.label, p.label === 'Non attribuées' ? 'partner-alert' : '')
    li.append(el('strong', String(p.count)))
    list.append(li)
  })
  people.append(list)
  const ongoing = card('En cours, à relire avant l’échange', true),
    active = el('ul', '', 'partner-ongoing')
  data.ongoing.forEach((e) => {
    const li = el('li')
    li.append(
      el('h3', e.name),
      el('p', `${e.group} · ${e.status} · ${e.people.join(', ') || 'Non attribuée'}`),
      el('p', e.vigilance || 'Aucun point de vigilance renseigné.', 'partner-vigilance'),
    )
    active.append(li)
  })
  ongoing.append(data.ongoing.length ? active : el('p', 'Aucun échange en cours.'))
}
