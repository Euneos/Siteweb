import type { ReseauFormateurs } from '../lib/reseau-formateurs'
import { networkMarkers } from '../lib/network-map-markers'

type Member = ReseauFormateurs['members'][number]
const root = document.querySelector<HTMLElement>('#trainer-network')
if (root) {
  const find = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const status = find('[data-network-status]')
  const retry = find<HTMLButtonElement>('[data-network-retry]')
  const content = find('[data-network-content]')
  const cohorts = find<HTMLSelectElement>('#network-cohort')
  const territory = find<HTMLSelectElement>('#network-territory')
  const legend = find('[data-network-legend]')
  const points = find('[data-network-points]')
  const list = find('[data-network-list]')
  const selection = find('[data-network-selection]')
  const backgrounds = root.querySelectorAll<SVGGElement>('[data-network-territory]')
  const map = find<HTMLElement>('.trainer-network__map')
  const palette = ['var(--vert)', 'var(--jaune)', 'var(--rose)', 'var(--bleu)']
  let data: ReseauFormateurs
  let selected = ''
  let lastWidth = 0
  let yearColors = new Map<string, string>()
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const el = document.createElement(tag)
    el.textContent = text
    el.className = className
    return el
  }
  function swatch(member: Pick<Member, 'annee'>) {
    const el = element('span', '', 'trainer-network__swatch')
    el.style.setProperty('--network-color', yearColors.get(member.annee) ?? 'var(--papier)')
    el.setAttribute('aria-hidden', 'true')
    return el
  }
  function memberItem(member: Member) {
    const item = element('li', '', 'trainer-network__member')
    const title = element('strong', member.nom)
    const detail = element('span', `${member.localisation || 'Localisation non renseignée'} · ${member.annee ? `Cohorte ${member.annee}` : 'Cohorte à préciser'}`)
    item.append(title, swatch(member), detail)
    if (member.issue) item.append(element('p', member.issue, 'iw-muted'))
    return item
  }
  function render() {
    const focusedKey = points.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.networkKey : undefined
    lastWidth = map.clientWidth
    const filtered = data.members.filter(m => !cohorts.value || m.annee === cohorts.value)
    const visible = filtered.filter(m => m.location?.territory === territory.value)
    const groups = networkMarkers(visible, map.clientWidth, map.clientHeight)
    for (const background of backgrounds) background.style.display = background.dataset.networkTerritory === territory.value ? '' : 'none'
    const existing = new Map([...points.querySelectorAll('button')].map(button => [button.dataset.networkKey!, button]))
    for (const { key, members, locations, x, y } of groups) {
      const button = existing.get(key) ?? element('button', '', 'trainer-network__point')
      existing.delete(key)
      button.type = 'button'
      button.dataset.networkKey = key
      button.style.left = `${(x - 180) / 6.4}%`
      button.style.top = `${(y - 20) / 6}%`
      const label = `${locations.map(l => l.name).join(', ')} : ${members.length} formateur${members.length > 1 ? 's' : ''}`
      button.setAttribute('aria-label', label)
      button.title = label
      button.setAttribute('aria-pressed', String(selected === key))
      const badge = element('span')
      const categories = new Map(members.map(m => [m.annee, m]))
      for (const member of categories.values()) badge.append(swatch(member))
      badge.append(element('b', String(members.length)))
      button.replaceChildren(badge)
      button.onclick = () => {
        selected = key
        // Keep the selected button focused for keyboard users; do not rebuild the map.
        for (const other of points.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button))
        showSelection(members)
      }
      if (!points.contains(button)) points.append(button)
    }
    for (const obsolete of existing.values()) obsolete.remove()
    const current = groups.find(group => group.key === selected)?.members
    if (!current) selected = ''
    showSelection(current ?? [])
    if (focusedKey) {
      const replacement = [...points.querySelectorAll('button')].find(button => button.dataset.networkKey === focusedKey)
      replacement?.focus({ preventScroll: true })
    }
    list.replaceChildren(...filtered.map(memberItem))
    if (!filtered.length) list.append(element('li', 'Aucun formateur ne correspond à ces filtres.'))
    const unlocated = filtered.filter(m => !m.location).length
    const territoryLabel = territory.selectedOptions[0].textContent
    status.textContent = `${filtered.length} formateur${filtered.length > 1 ? 's' : ''} validé${filtered.length > 1 ? 's' : ''} dans la sélection · ${visible.length} sur la carte (${territoryLabel}) · ${unlocated} sans point, à retrouver dans la liste.`
  }
  function showSelection(members: Member[]) {
    const places = new Set(members.map(m => m.location?.code))
    selection.replaceChildren(element('h3', places.size > 1 ? `${places.size} repères proches` : members[0]?.location?.name ?? 'Les formateurs près de chez vous'))
    if (!members.length) { selection.append(element('p', points.childElementCount ? 'Sélectionnez une commune ou un repère territorial sur la carte.' : 'Aucun formateur validé à afficher sur ce territoire pour la cohorte sélectionnée.')); return }
    const ul = element('ul')
    ul.append(...members.map(memberItem))
    selection.append(ul)
  }
  async function load() {
    retry.hidden = true
    content.hidden = true
    status.textContent = 'Chargement du réseau…'
    try {
      const response = await fetch('/api/interne/ressources?reseau=1', { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error('Réseau indisponible')
      const result = await response.json()
      if (!Array.isArray(result.members) || typeof result.updatedAt !== 'string') throw new Error('Réponse inattendue')
      // Also fail closed against a stale response from the previous map version.
      data = { ...result, members: result.members.filter((member: Member) => member.statut === 'Formateur validé') }
      const allYears = [...new Set(data.members.map(m => m.annee).filter(Boolean))].sort()
      yearColors = new Map(allYears.map((year, i) => [year, palette[i % palette.length]]))
      cohorts.replaceChildren(new Option('Toutes les cohortes', ''), ...allYears.map(year => new Option(`Cohorte ${year}`, year)))
      legend.replaceChildren()
      for (const year of allYears) {
        const li = element('li')
        li.append(swatch({ annee: year }), document.createTextNode(`Cohorte ${year}`))
        legend.append(li)
      }
      find('[data-network-updated]').textContent = `Données relues le ${new Date(data.updatedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}. La carte ne modifie aucune validation.`
      content.hidden = false
      render()
    } catch {
      status.textContent = 'Le réseau n’a pas pu être chargé. Aucun résultat partiel n’est affiché.'
      retry.hidden = false
    }
  }
  for (const filter of [cohorts, territory]) filter.addEventListener('change', () => { selected = ''; render() })
  retry.addEventListener('click', load)
  new ResizeObserver(() => {
    if (data && map.clientWidth !== lastWidth && map.clientWidth > 0) {
      lastWidth = map.clientWidth
      render()
    }
  }).observe(map)
  void load()
}
