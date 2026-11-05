import type { ReseauFormateurs } from '../lib/reseau-formateurs'
import { networkMarkers } from '../lib/network-map-markers'
import { networkTerritories } from '../data/network-territories'

type Member = ReseauFormateurs['members'][number]
const root = document.querySelector<HTMLElement>('#trainer-network')
if (root) {
  const find = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const status = find('[data-network-status]')
  const retry = find<HTMLButtonElement>('[data-network-retry]')
  const content = find('[data-network-content]')
  const territory = find<HTMLSelectElement>('#network-territory')
  const list = find('[data-network-list]')
  const selection = find('[data-network-selection]')
  const panels = [...root.querySelectorAll<HTMLElement>('[data-network-panel]')]
  const widths = new Map<Element, number>()
  let data: ReseauFormateurs | undefined
  let selected = ''
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const el = document.createElement(tag)
    el.textContent = text
    el.className = className
    return el
  }
  function swatch() {
    const el = element('span', '', 'trainer-network__swatch')
    el.setAttribute('aria-hidden', 'true')
    return el
  }
  function memberItem(member: Member) {
    const item = element('li', '', 'trainer-network__member')
    item.append(element('strong', member.nom), swatch(), element('span', member.localisation || 'Résidence à préciser'))
    if (member.issue) item.append(element('p', member.issue, 'iw-muted'))
    return item
  }
  function showSelection(members: Member[]) {
    const places = new Set(members.map(m => m.location?.code))
    selection.replaceChildren(element('h3', places.size > 1 ? `${places.size} repères proches` : members[0]?.location?.name ?? 'Les formateurs près de chez vous'))
    if (!members.length) {
      selection.append(element('p', 'Sélectionnez une commune ou un repère territorial sur la carte.'))
      return
    }
    const ul = element('ul')
    ul.append(...members.map(memberItem))
    selection.append(ul)
  }
  function render() {
    if (!data) return
    root!.dataset.networkSingle = String(!!territory.value)
    const filtered = data.members.filter(m => !territory.value || m.location?.territory === territory.value)
    let current: Member[] = []
    let visible = 0
    for (const panel of panels) {
      const id = panel.dataset.networkPanel!
      const territoryMembers = filtered.filter(m => m.location?.territory === id)
      panel.hidden = !territoryMembers.length
      if (panel.hidden) continue
      visible += territoryMembers.length
      panel.querySelector('[data-network-count]')!.textContent = `${networkTerritories.find(p => p.id === id)!.label} · ${territoryMembers.length} formateur${territoryMembers.length > 1 ? 's' : ''}`
      const map = panel.querySelector<HTMLElement>('.trainer-network__map')!
      widths.set(map, map.clientWidth)
      const points = panel.querySelector<HTMLElement>('[data-network-points]')!
      const focusedKey = points.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.networkKey : undefined
      const existing = new Map([...points.querySelectorAll('button')].map(button => [button.dataset.networkKey!, button]))
      for (const { key: locationKey, members, locations, x, y } of networkMarkers(territoryMembers, map.clientWidth, map.clientHeight)) {
        const key = `${id}:${locationKey}`
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
        badge.append(swatch(), element('b', String(members.length)))
        button.replaceChildren(badge)
        button.onclick = () => {
          selected = key
          for (const other of root!.querySelectorAll('[data-network-points] button')) other.setAttribute('aria-pressed', String(other === button))
          showSelection(members)
        }
        if (!points.contains(button)) points.append(button)
        if (selected === key) current = members
      }
      for (const obsolete of existing.values()) obsolete.remove()
      if (focusedKey) [...points.querySelectorAll('button')].find(b => b.dataset.networkKey === focusedKey)?.focus({ preventScroll: true })
    }
    if (!current.length) selected = ''
    showSelection(current)
    list.replaceChildren(...filtered.map(memberItem))
    if (!filtered.length) list.append(element('li', 'Aucun formateur validé sur ce territoire.'))
    const unlocated = filtered.filter(m => !m.location).length
    status.textContent = `${filtered.length} formateur${filtered.length > 1 ? 's' : ''} validé${filtered.length > 1 ? 's' : ''} · ${visible} sur les cartes · ${unlocated} sans point, à retrouver dans la liste.`
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
      data = { ...result, members: result.members.filter((m: Member) => m.statut === 'Formateur validé') }
      territory.replaceChildren(new Option('Tous les territoires', ''), ...networkTerritories.flatMap(p => {
        const count = data!.members.filter(m => m.location?.territory === p.id).length
        return count ? [new Option(`${p.label} · ${count}`, p.id)] : []
      }))
      // Start with metropolitan France; overseas remains available via the filter.
      territory.value = data!.members.some(m => m.location?.territory === 'metropole') ? 'metropole' : ''
      find('[data-network-updated]').textContent = `Données relues le ${new Date(data!.updatedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}. La carte ne modifie aucune validation.`
      content.hidden = false
      selected = ''
      render()
    } catch {
      data = undefined
      status.textContent = 'Le réseau n’a pas pu être chargé. Aucun résultat partiel n’est affiché.'
      retry.hidden = false
    }
  }
  territory.addEventListener('change', () => { selected = ''; render() })
  retry.addEventListener('click', load)
  const observer = new ResizeObserver(entries => {
    if (data && entries.some(entry => (entry.target as HTMLElement).clientWidth > 0 && widths.get(entry.target) !== (entry.target as HTMLElement).clientWidth)) render()
  })
  for (const map of root.querySelectorAll('.trainer-network__map')) observer.observe(map)
  void load()
}
