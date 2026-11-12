import { networkTerritories } from '../data/network-territories'
const projections = networkTerritories.filter(p => p.id !== 'BE')
import regionReference from '../data/map-regions.json'
type Place = { trainingState?: 'valide' | 'en_formation'; formations?: { year: string; state: 'terminee' | 'en_cours' | 'engage' }[]; name: string; city: string; location: { territory: string; x: number; y: number; code: string } | null }
const regionsByDepartment: Record<string, string> = regionReference.departments
function regionFor(place: Place): string {
  const code = place.location?.code ?? ''
  const department = code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2)
  return regionsByDepartment[department]
    ?? projections.find(p => p.id === place.location?.territory && p.id !== 'metropole')?.label
    ?? 'Région à préciser'
}
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element
}
const mapObservers = new Map<string, ResizeObserver>()
function maps(data: { locations: Place[] }, prefix = 'ca', unit = 'établissement(s)') {
  mapObservers.get(prefix)?.disconnect()
  const mapEl = <T extends HTMLElement = HTMLElement>(id: string) => el<T>(id.replace(/^ca-/, `${prefix}-`))
  let territory = 'metropole'
  function render() {
    const schools = data.locations.filter(s => territory === 'unlocated' ? !s.location : s.location?.territory === territory)
      .map(s => ({ ...s, city: s.city.toLocaleLowerCase('fr') === 'angers' ? 'Angers' : s.city }))
    const projection = projections.find(p => p.id === territory) ?? projections[0]
    mapEl('ca-map-image').closest('.trouver__grid')?.classList.toggle('trouver__grid--unlocated', territory === 'unlocated')
    mapEl<HTMLImageElement>('ca-map-image').src = `/maps/outline/${territory}.svg`
    function list(items: typeof schools, title: string) {
      mapEl('ca-map-selection').textContent = prefix === 'ca' ? 'Établissements sélectionnés' : 'Formateurs sélectionnés'
      mapEl('ca-map-count').textContent = ''
      const byRegion = new Map<string, typeof items>()
      for (const item of items) {
        const region = regionFor(item)
        byRegion.set(region, [...(byRegion.get(region) ?? []), item])
      }
      mapEl('ca-map-schools').replaceChildren(...[...byRegion].sort(([a], [b]) => a.localeCompare(b, 'fr')).map(([region, places]) => {
        const group = node('li', '', 'trouver__region')
        group.append(node('h4', `${region} · ${places.length}`, 'trouver__region-title'))
        const entries = node('ul')
        if (prefix === 'ct') {
          const byCity = new Map<string, {formed: number; training: number}>()
          for (const place of places) {
            const totals = byCity.get(place.city) ?? { formed: 0, training: 0 }
            if (place.trainingState === 'en_formation') totals.training++
            else totals.formed++
            byCity.set(place.city, totals)
          }
          entries.append(...[...byCity].sort(([a], [b]) => a.localeCompare(b, 'fr')).map(([city, totals]) => {
            const entry = node('li')
            entry.append(node('strong', city))
            if (totals.formed) entry.append(node('span', `${totals.formed} formateur${totals.formed > 1 ? 's' : ''}`, 'trouver__formation'))
            if (totals.training) entry.append(node('span', `${totals.training} en cours de formation`, 'trouver__formation'))
            return entry
          }))
        } else {
          entries.append(...[...places].sort((a,b) => a.city.localeCompare(b.city, 'fr') || a.name.localeCompare(b.name, 'fr')).map(s => {
            const entry = node('li')
            entry.append(document.createTextNode(`${s.name} · `), node('strong', s.city))
            for (const formation of s.formations ?? []) {
              entry.append(node('span', `${formation.year} · ${formation.state === 'terminee' ? 'Formation terminée' : formation.state === 'en_cours' ? 'Formation en cours' : 'Établissement engagé'}`, 'trouver__formation'))
            }
            return entry
          }))
        }
        group.append(entries)
        return group
      }))
      if (!items.length) mapEl('ca-map-schools').append(node('li', 'Aucun repère localisé sur ce territoire.'))
    }
    function clearSelection() {
      mapEl('ca-map-selection').textContent = 'Sélectionnez un repère'
      mapEl('ca-map-count').textContent = ''
      mapEl('ca-map-schools').replaceChildren()
      mapEl('ca-map-all').hidden = true
      mapEl('ca-markers').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'))
    }
    clearSelection()
    mapEl('ca-map-all').onclick = clearSelection
    mapEl('ca-map-tabs').replaceChildren(...projections.map(p => {
      const count = data.locations.filter(s => s.location?.territory === p.id).length
      const button = node('button', `${p.label} · ${count}`, 'trouver__button')
      button.type = 'button'; button.setAttribute('aria-pressed', String(p.id === territory))
      button.onclick = () => { territory = p.id; render() }
      return button
    }))
    const unlocatedCount = data.locations.filter(s => !s.location).length
    if (unlocatedCount) {
      const button = node('button', `Sans repère · ${unlocatedCount}`, 'trouver__button')
      button.type = 'button'; button.setAttribute('aria-pressed', String(territory === 'unlocated'))
      button.onclick = () => { territory = 'unlocated'; render() }
      mapEl('ca-map-tabs').append(button)
    }
    if (territory === 'unlocated') { list(schools, 'Sans repère'); mapEl('ca-markers').replaceChildren(); return }
    // Exactly one marker per administrative region, on both maps.
    const groups: (typeof schools)[] = []
    for (const school of schools) {
      const group = groups.find(g => regionFor(g[0]) === regionFor(school))
      if (group) group.push(school)
      else groups.push([school])
    }
    mapEl('ca-markers').replaceChildren(...groups.map(items => {
      const cities = [...new Set(items.map(s => s.city))].sort((a,b) => a.localeCompare(b, 'fr'))
      const regions = [...new Set(items.map(regionFor))]
      const title = regions.length === 1 ? regions[0] : cities.join(' / ')
      const x = items.reduce((sum,s) => sum + s.location!.x, 0) / items.length
      const y = items.reduce((sum,s) => sum + s.location!.y, 0) / items.length
      const b = node('button', '', 'trouver__marker'); b.type = 'button'
      b.style.left = `${x / 10}%`; b.style.top = `${y / 6.5}%`
      b.setAttribute('aria-label', `${title} : ${items.length} ${unit}`)
      b.setAttribute('aria-pressed', 'false'); b.append(node('span', String(items.length)))
      b.onclick = () => {
        mapEl('ca-markers').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button === b)))
        list(items, title); mapEl('ca-map-all').hidden = false
      }
      return b
    }))
  }
  render()
  let lastWidth = mapEl('ca-map-image').getBoundingClientRect().width
  const observer = new ResizeObserver(() => {
    const nextWidth = mapEl('ca-map-image').getBoundingClientRect().width
    if (Math.abs(nextWidth - lastWidth) > 1) { lastWidth = nextWidth; render() }
  })
  observer.observe(mapEl('ca-map-image'))
  mapObservers.set(prefix, observer)
}

const data = JSON.parse(el('trouver-data').textContent || 'null') as null | { locations: Place[]; trainerLocations: Place[]; periods: {key: string; locations: Place[]}[] }
if(data) {
  const updateSchools = () => {
    const value = el<HTMLSelectElement>('ca-period').value
    const state = el<HTMLSelectElement>('ca-training').value
    const selected = data.periods.find(p => p.key === value) ?? data
    maps({ locations: selected.locations.flatMap(s => {
      const formations = s.formations?.filter(f => state === 'all' || f.state === state) ?? []
      return formations.length ? [{ ...s, formations }] : []
    }) })
  }
  updateSchools()
  maps({ locations: data.trainerLocations }, 'ct', 'formateur(s)')
  el<HTMLSelectElement>('ca-period').onchange = updateSchools
  el<HTMLSelectElement>('ca-training').onchange = updateSchools
}
