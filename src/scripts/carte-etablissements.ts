import type { ReseauEtablissements } from '../lib/reseau-etablissements'
import { networkMarkers } from '../lib/network-map-markers'

type Member = ReseauEtablissements['members'][number]
for (const root of document.querySelectorAll<HTMLElement>('#school-network')) {
  const formationLabels = { terminee: 'Formation terminée', en_cours: 'Formation en cours', a_programmer: 'Formation à programmer', programmee: 'Formation programmée' }
  const formationColors = { terminee: 'var(--vert)', en_cours: 'var(--orange)', a_programmer: 'var(--jaune)', programmee: 'var(--rose)' }
  type FormationState = keyof typeof formationColors
  const find = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const status = find('[data-network-status]')
  const retry = find<HTMLButtonElement>('[data-network-retry]')
  const content = find('[data-network-content]')
  const cohorts = find<HTMLSelectElement>('#network-cohort')
  const training = root.querySelector<HTMLSelectElement>('#network-training')
  const territory = find<HTMLSelectElement>('#network-territory')
  const legend = find('[data-network-legend]')
  const points = find('[data-network-points]')
  const list = find('[data-network-list]')
  const selection = find('[data-network-selection]')
  const backgrounds = root.querySelectorAll<SVGGElement>('[data-network-territory]')
  const map = find<HTMLElement>('.trainer-network__map')
  let data: { members: Member[]; updatedAt: string }
  let cohortLabels = new Map<string, string>()
  const cohortLabel = (year: string) => cohortLabels.get(year) ?? (year ? `Cohorte ${year}` : 'Cohorte à préciser')
  let selected = ''
  let lastWidth = 0
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
    const el = document.createElement(tag)
    el.textContent = text
    el.className = className
    return el
  }
  function stateSwatch(states: FormationState[]) {
    const el = element('span', '', 'trainer-network__swatch')
    const colors = states.map(state => formationColors[state])
    el.style.setProperty('--network-color', colors.length === 1 ? colors[0] : `conic-gradient(${colors.map((color, i) => `${color} ${i * 100 / colors.length}% ${(i + 1) * 100 / colors.length}%`).join(', ')})`)
    el.setAttribute('aria-hidden', 'true')
    return el
  }
  function visibleStates(member: Member): FormationState[] {
    return 'etats' in member ? member.etats.filter(state => !training?.value || state === training.value) : []
  }
  function memberItem(member: Member) {
    const item = element('li', '', 'trainer-network__member')
    const title = element('strong', member.nom)
    const detail = element('span', `${member.localisation || 'Localisation non renseignée'} · ${cohortLabel(member.annee)}`)
    item.append(title)
    item.append(detail)
    if ('formations' in member) for (const formation of member.formations.filter(f => !training?.value || f.etat === training.value)) {
      const line = element('span')
      line.append(stateSwatch([formation.etat]), document.createTextNode(`${formation.dossier} · ${formationLabels[formation.etat]}`))
      item.append(line)
    }
    if (member.issue) item.append(element('p', member.issue, 'iw-muted'))
    return item
  }
  function render() {
    const focusedKey = points.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.networkKey : undefined
    lastWidth = map.clientWidth
    const filtered = data.members.filter(m => (!cohorts.value || m.annee === cohorts.value) && (!training?.value || ('etats' in m && m.etats.some(state => state === training.value))))
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
      const label = `${locations.map(l => l.name).join(', ')} : ${members.length} établissement${members.length > 1 ? 's' : ''}`
      button.setAttribute('aria-label', label)
      button.title = label
      button.setAttribute('aria-pressed', String(selected === key))
      const badge = element('span')
      const states = [...new Set(members.flatMap(visibleStates))]
      badge.append(stateSwatch(states))
      button.setAttribute('aria-description', states.map(state => formationLabels[state]).join(', '))
      button.title = `${label} · ${states.map(state => formationLabels[state]).join(', ')}`
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
    if (!filtered.length) list.append(element('li', 'Aucun établissement ne correspond à ces filtres.'))
    const unlocated = filtered.filter(m => !m.location).length
    const territoryLabel = territory.selectedOptions[0].textContent
    const count = filtered.length
    status.textContent = `${count} établissement${count > 1 ? 's' : ''} (participations par cohorte) dans la sélection · ${visible.length} sur la carte (${territoryLabel}) · ${unlocated} sans point, à retrouver dans la liste.`
  }
  function showSelection(members: Member[]) {
    const places = new Set(members.map(m => m.location?.code))
    selection.replaceChildren(element('h3', places.size > 1 ? `${places.size} repères proches` : members[0]?.location?.name ?? 'Les établissements de la sélection'))
    if (!members.length) { selection.append(element('p', points.childElementCount ? 'Sélectionnez une commune ou un repère territorial sur la carte.' : 'Aucun établissement à afficher sur ce territoire pour les filtres sélectionnés.')); return }
    const ul = element('ul')
    ul.append(...members.map(memberItem))
    selection.append(ul)
  }
  async function load() {
    retry.hidden = true
    content.hidden = true
    status.textContent = 'Chargement du réseau…'
    try {
      const response = await fetch('/api/interne/implantations?formes=1', { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error('Réseau indisponible')
      const result = await response.json()
      if (!Array.isArray(result.members) || typeof result.updatedAt !== 'string') throw new Error('Réponse inattendue')
      data = { ...result, members: result.members.filter((member: Member) => Array.isArray(member.etats) && member.etats.some(state => Object.hasOwn(formationLabels, state))) }
      cohortLabels = new Map(result.cohorts.map((c: { value: string; label: string }) => [c.value, `Cohorte ${c.label}`]))
      const allYears = [...cohortLabels.keys()]
      cohorts.replaceChildren(new Option('Toutes les cohortes', ''), ...allYears.map(year => new Option(cohortLabel(year), year)))
      legend.replaceChildren()
      for (const state of Object.keys(formationLabels) as FormationState[]) {
        const li = element('li')
        li.append(stateSwatch([state]), document.createTextNode(formationLabels[state]))
        legend.append(li)
      }
      find('[data-network-updated]').textContent = `Données relues le ${new Date(data.updatedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}. La carte ne modifie aucun dossier.`
      content.hidden = false
      render()
    } catch {
      status.textContent = 'Le réseau n’a pas pu être chargé. Aucun résultat partiel n’est affiché.'
      retry.hidden = false
    }
  }
  for (const filter of [cohorts, territory]) filter.addEventListener('change', () => { selected = ''; render() })
  training?.addEventListener('change', () => { selected = ''; render() })
  retry.addEventListener('click', load)
  new ResizeObserver(() => {
    if (data && map.clientWidth !== lastWidth && map.clientWidth > 0) {
      lastWidth = map.clientWidth
      render()
    }
  }).observe(map)
  void load()
}
