import type { MapData, MapGroup } from '../lib/map'
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const e = document.createElement(tag)
  e.textContent = text
  if (className) e.className = className
  return e
}
const territories = [
  ['metropole', 'Métropole & Corse'],
  ['971', 'Guadeloupe'],
  ['972', 'Martinique'],
  ['973', 'Guyane'],
  ['974', 'La Réunion'],
  ['976', 'Mayotte'],
] as const
const stopped = (status: string) =>
  ['abandonne', 'abandon', 'refuse'].includes(
    status
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim(),
  )
const statusLabel = (status: string) =>
  status === 'Abandonne' ? 'Abandonné' : status === 'Refuse' ? 'Refusé' : status
const formatDate = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(date),
  )
const establishmentLabel = (group: MapGroup) =>
  group.establishmentId ? `Établissement #${group.establishmentId}` : 'Établissement non relié'
const dossierLabel = (p: MapGroup['participations'][number]) =>
  p.code === `DOS-${String(p.id).padStart(4, '0')}`
    ? `Dossier ${p.code}`
    : `Dossier #${p.id}${p.code === `Dossier #${p.id}` ? '' : ` · Référence historique : ${p.code}`}`
if ($('im-app')) {
  let data: MapData | null = null,
    initial = true,
    controller: AbortController | null = null
  let area = 'metropole',
    selectedCodes: string[] = [],
    zoom = 1,
    center = { x: 500, y: 325 }
  let visible: MapGroup[] = []
  const cohort = $<HTMLSelectElement>('im-cohort'),
    status = $<HTMLSelectElement>('im-status'),
    location = $<HTMLSelectElement>('im-location')
  const viewport = $('im-map'),
    markers = $('im-markers'),
    image = $<HTMLImageElement>('im-map-background')
  function setSelection(groups: MapGroup[], focus = false) {
    const codes = [...new Set(groups.map((g) => g.location?.code).filter((c): c is string => !!c))]
    selectedCodes = codes
    const names = [...new Set(groups.map((g) => g.location?.name).filter(Boolean))]
    $('im-detail-title').textContent =
      names.length === 1 ? names[0]! : `${names.length} communes proches`
    $('im-detail-description').textContent =
      names.length === 1
        ? 'Centre communal · les établissements ne sont pas géolocalisés à leur adresse.'
        : `${names.join(' · ')}. Repère groupé au centre de ${names[0]}. Agrandissez la carte pour séparer les communes.`
    const detail = $('im-detail-list')
    detail.replaceChildren()
    for (const group of groups) {
      const item = node('article', '', 'im-detail-item')
      item.append(
        node('h3', group.name),
        node('p', establishmentLabel(group)),
        node('p', `${group.location?.name} · ${group.cohortLabel}`),
      )
      for (const p of group.participations)
        item.append(node('p', `${dossierLabel(p)} · ${statusLabel(p.status)}`, 'iw-small'))
      detail.append(item)
    }
    markers
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) =>
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.codes?.split('|').some((code) => codes.includes(code))),
        ),
      )
    if (focus) $('im-detail-title').focus()
  }
  function clearSelection() {
    selectedCodes = []
    $('im-detail-title').textContent = 'Explorez un territoire'
    $('im-detail-description').textContent =
      'Sélectionnez un repère pour retrouver les établissements et leurs dossiers courants.'
    $('im-detail-list').replaceChildren()
  }
  function list(groups: MapGroup[]) {
    const target = $('im-list')
    target.replaceChildren()
    $('im-list-count').textContent = `${groups.length} groupe${groups.length > 1 ? 's' : ''}`
    if (!groups.length) {
      target.append(
        node(
          'p',
          'Aucun dossier ne correspond aux filtres. Choisissez « Tout afficher » pour retrouver toutes les participations.',
          'im-empty',
        ),
      )
      return
    }
    const ul = node('ul', '', 'im-list')
    for (const group of groups) {
      const item = node('li', '', 'im-row')
      const name = node('div')
      name.append(
        node('h3', group.name),
        node('p', establishmentLabel(group)),
        node('p', [group.type, group.cohortLabel].filter(Boolean).join(' · ')),
      )
      const total = data!.groups.find((g) => g.key === group.key)!.participations.length
      if (total > 1)
        name.append(
          node(
            'p',
            `${group.participations.length} dossier(s) affiché(s) sur ${total} regroupés · à rapprocher`,
            'iw-muted',
          ),
        )
      if (!group.cohortKnown)
        name.append(
          node('p', 'Cohorte non déterminée : aucun regroupement supposé.', 'im-row__issue'),
        )
      const place = node('div')
      place.append(
        node(
          'strong',
          [group.postcode, group.city].filter(Boolean).join(' ') || 'Commune non renseignée',
        ),
      )
      place.append(
        node(
          'p',
          group.location
            ? `Centre de ${group.location.name}`
            : (group.issue ?? 'Localisation à vérifier'),
          group.location ? 'iw-muted' : 'im-row__issue',
        ),
      )
      const sources = node('div')
      for (const p of group.participations) {
        const badge = node('span', statusLabel(p.status), 'iw-badge')
        badge.dataset.status = stopped(p.status) ? 'annule' : ''
        sources.append(badge, node('p', dossierLabel(p)))
      }
      item.append(name, place, sources)
      if (group.location) {
        const b = node('button', 'Voir sur la carte', 'iw-button')
        b.type = 'button'
        b.addEventListener('click', () => {
          area = group.location!.territory
          zoom = 1
          center = { x: group.location!.x, y: group.location!.y }
          renderMap()
          updateTerritories()
          setSelection(visible.filter((g) => g.location?.code === group.location!.code))
          viewport.focus({ preventScroll: true })
          viewport.scrollIntoView({ block: 'center', behavior: 'instant' })
        })
        item.append(b)
      } else item.append(node('span', 'Sans repère', 'iw-small iw-muted'))
      ul.append(item)
    }
    target.append(ul)
  }
  function updateTerritories() {
    $('im-territories')
      .querySelectorAll<HTMLButtonElement>('button')
      .forEach((button) => {
        const definition = territories.find((t) => t[0] === button.dataset.area)!
        button.textContent = `${definition[1]} · ${visible.filter((g) => g.location?.territory === definition[0]).length}`
        button.setAttribute('aria-pressed', String(button.dataset.area === area))
      })
  }
  function renderMap() {
    const frame = visible.filter((g) => g.location?.territory === area)
    const out = visible.filter((g) => g.location && g.location.territory !== area).length
    $('im-frame-summary').textContent =
      `${territories.find((t) => t[0] === area)![1]} : ${frame.length} groupe(s) · ${out} dans les autres territoires · ${visible.filter((g) => !g.location).length} sans repère. Échelle propre à chaque territoire.`
    const w = 1000 / zoom,
      h = 650 / zoom
    center.x = Math.max(w / 2, Math.min(1000 - w / 2, center.x))
    center.y = Math.max(h / 2, Math.min(650 - h / 2, center.y))
    const left = center.x - w / 2,
      top = center.y - h / 2
    image.src = `/maps/${area}.svg`
    image.style.width = `${zoom * 100}%`
    image.style.height = `${zoom * 100}%`
    image.style.left = `${(-left / w) * 100}%`
    image.style.top = `${(-top / h) * 100}%`
    markers.replaceChildren()
    const communes = new Map<string, MapGroup[]>()
    for (const group of frame) {
      const code = group.location!.code
      const same = communes.get(code) ?? []
      same.push(group)
      communes.set(code, same)
    }
    // Anchor clusters to an actual commune centre, never to an invented school point.
    const clusters: { x: number; y: number; groups: MapGroup[] }[] = []
    const px = viewport.clientWidth,
      py = viewport.clientHeight
    for (const groups of [...communes.values()].sort((a, b) =>
      a[0].location!.code.localeCompare(b[0].location!.code),
    )) {
      const coordinate = groups[0].location!
      const x = (coordinate.x - left) / w,
        y = (coordinate.y - top) / h
      if (x < 0 || x > 1 || y < 0 || y > 1) continue
      const nearby = clusters.find((c) => Math.hypot((c.x - x) * px, (c.y - y) * py) < 46)
      if (nearby) nearby.groups.push(...groups)
      else clusters.push({ x, y, groups: [...groups] })
    }
    for (const cluster of clusters) {
      const button = node('button', '', 'im-marker')
      button.type = 'button'
      button.style.left = `${cluster.x * 100}%`
      button.style.top = `${cluster.y * 100}%`
      button.dataset.codes = [...new Set(cluster.groups.map((g) => g.location!.code))].join('|')
      const statuses = cluster.groups.flatMap((g) => g.participations.map((p) => stopped(p.status)))
      button.dataset.state = statuses.every(Boolean)
        ? 'stopped'
        : statuses.some(Boolean)
          ? 'mixed'
          : 'active'
      const names = [...new Set(cluster.groups.map((g) => g.location!.name))]
      button.setAttribute(
        'aria-label',
        `${names.join(', ')} : ${cluster.groups.length} groupe(s) établissement–cohorte. Afficher les dossiers.`,
      )
      button.setAttribute(
        'aria-pressed',
        String(cluster.groups.some((g) => selectedCodes.includes(g.location!.code))),
      )
      button.append(node('span', String(cluster.groups.length)))
      button.addEventListener('click', () => {
        center = { x: cluster.groups[0].location!.x, y: cluster.groups[0].location!.y }
        setSelection(cluster.groups, true)
      })
      markers.append(button)
    }
    $<HTMLButtonElement>('im-zoom-in').disabled = zoom >= 8
    $<HTMLButtonElement>('im-zoom-out').disabled = zoom <= 1
    document.querySelectorAll<HTMLButtonElement>('[data-pan]').forEach((b) => {
      b.disabled = zoom === 1
    })
  }
  function render() {
    if (!data) return
    visible = data.groups
      .filter(
        (g) =>
          (!cohort.value ||
            (cohort.value === 'unknown' ? !g.cohortKnown : g.cohortId === Number(cohort.value))) &&
          (!location.value || (location.value === 'located' ? !!g.location : !g.location)),
      )
      .map((g) => ({
        ...g,
        participations: g.participations.filter((p) => !status.value || p.status === status.value),
      }))
      .filter((g) => g.participations.length)
    const records = visible.reduce((sum, g) => sum + g.participations.length, 0)
    $('im-schools').textContent = String(
      new Set(visible.filter((g) => g.establishmentKnown).map((g) => g.establishmentId)).size,
    )
    $('im-records').textContent = String(records)
    $('im-located').textContent = String(visible.filter((g) => g.location).length)
    $('im-unlocated').textContent = String(visible.filter((g) => !g.location).length)
    $('im-summary').textContent =
      `${visible.length} groupe(s) établissement–cohorte pour ${records} dossier(s). Les dossiers sans rattachement certain restent séparés.`
    clearSelection()
    updateTerritories()
    renderMap()
    list(visible)
  }
  async function load() {
    controller?.abort()
    const request = new AbortController()
    controller = request
    const timer = setTimeout(() => request.abort('timeout'), 30000)
    $('im-data').hidden = true
    $('im-data').setAttribute('aria-busy', 'true')
    $('im-state').hidden = false
    $('im-state').replaceChildren(
      node('span', '', 'iw-loading'),
      node('h2', 'Chargement des implantations'),
      node('p', 'Nous récupérons toutes les pages de la base.'),
    )
    $('im-updated').textContent = 'Lecture de la base en cours…'
    $<HTMLButtonElement>('im-refresh').disabled = true
    for (const control of [cohort, status, location, $<HTMLButtonElement>('im-reset')])
      control.disabled = true
    try {
      const response = await fetch('/api/interne/implantations', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: request.signal,
      })
      const result = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : null
      if (!response.ok || response.redirected || !result)
        throw new Error(
          response.status === 401 || response.status === 403 || response.redirected
            ? 'Votre accès équipe a expiré ou n’est pas autorisé. Reconnectez-vous à l’espace équipe.'
            : (result?.error ?? 'La base n’a pas pu être chargée.'),
        )
      if (
        !Array.isArray(result.groups) ||
        !Array.isArray(result.cohorts) ||
        !result.totals ||
        typeof result.updatedAt !== 'string'
      )
        throw new Error('La réponse est incomplète. Aucun total ne peut être confirmé.')
      data = result as MapData
      const prior = cohort.value,
        priorStatus = status.value
      cohort.replaceChildren(
        new Option('Toutes les cohortes', ''),
        ...data.cohorts.map(
          (c) => new Option(c.label + (c.active ? ' · active' : ''), String(c.id)),
        ),
      )
      if (data.groups.some((g) => !g.cohortKnown))
        cohort.add(new Option('Cohorte non renseignée / introuvable', 'unknown'))
      cohort.value = initial ? data.defaultCohort : prior
      if (!cohort.value && prior && !initial) {
        cohort.add(new Option('Cohorte précédemment sélectionnée', prior))
        cohort.value = prior
      }
      const statuses = [
        ...new Set(data.groups.flatMap((g) => g.participations.map((p) => p.status))),
      ].sort((a, b) => a.localeCompare(b, 'fr'))
      if (priorStatus && !statuses.includes(priorStatus)) statuses.push(priorStatus)
      status.replaceChildren(
        new Option('Tous les statuts', ''),
        ...statuses.map((s) => new Option(statusLabel(s), s)),
      )
      status.value = priorStatus
      initial = false
      $('im-updated').textContent = `Lecture complète · ${formatDate(data.updatedAt)}`
      $('im-reference-date').textContent = new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'long',
      }).format(new Date(data.referenceDate + 'T12:00:00Z'))
      $('im-source-count').textContent =
        `Lecture NocoDB complète : ${data.totals.participations} participations non archivées, ${data.totals.establishments} établissements distincts reliés, ${data.totals.groups} groupes, dont ${data.totals.duplicateGroups} avec plusieurs dossiers. Les dossiers archivés restent conservés dans NocoDB. Le tableau de suivi reste la référence des étapes et décisions.`
      $('im-state').hidden = true
      $('im-data').hidden = false
      render()
    } catch (error) {
      if (request.signal.aborted && request.signal.reason !== 'timeout') return
      data = null
      $('im-data').hidden = true
      $('im-state').hidden = false
      $('im-updated').textContent = 'Données indisponibles · aucun total confirmé'
      $('im-state').replaceChildren(
        node('h2', 'Les implantations n’ont pas pu être chargées'),
        node(
          'p',
          request.signal.reason === 'timeout'
            ? 'Le service n’a pas répondu à temps. Réessayez.'
            : error instanceof Error
              ? error.message
              : 'La connexion a été interrompue.',
        ),
      )
      const retry = node('button', 'Réessayer', 'iw-button')
      retry.type = 'button'
      retry.addEventListener('click', () => void load())
      $('im-state').append(retry)
    } finally {
      clearTimeout(timer)
      if (controller === request) {
        $('im-data').setAttribute('aria-busy', 'false')
        $<HTMLButtonElement>('im-refresh').disabled = false
        for (const control of [cohort, status, location, $<HTMLButtonElement>('im-reset')])
          control.disabled = !data
      }
    }
  }
  for (const [id, label] of territories) {
    const b = node('button', label, 'iw-button')
    b.type = 'button'
    b.dataset.area = id
    b.setAttribute('aria-pressed', String(id === area))
    b.addEventListener('click', () => {
      area = id
      zoom = 1
      center = { x: 500, y: 325 }
      clearSelection()
      updateTerritories()
      renderMap()
    })
    $('im-territories').append(b)
  }
  for (const select of [cohort, status, location]) select.addEventListener('change', render)
  $('im-reset').addEventListener('click', () => {
    cohort.value = ''
    status.value = ''
    location.value = ''
    render()
  })
  $('im-refresh').addEventListener('click', () => void load())
  $('im-zoom-in').addEventListener('click', () => {
    zoom = Math.min(8, zoom * 2)
    renderMap()
  })
  $('im-zoom-out').addEventListener('click', () => {
    zoom = Math.max(1, zoom / 2)
    renderMap()
  })
  $('im-map-reset').addEventListener('click', () => {
    zoom = 1
    center = { x: 500, y: 325 }
    renderMap()
  })
  function pan(direction: string) {
    if (zoom === 1) return
    const amount = 130 / zoom
    center.x += direction === 'left' ? -amount : direction === 'right' ? amount : 0
    center.y += direction === 'up' ? -amount : direction === 'down' ? amount : 0
    renderMap()
  }
  document
    .querySelectorAll<HTMLButtonElement>('[data-pan]')
    .forEach((b) => b.addEventListener('click', () => pan(b.dataset.pan!)))
  viewport.addEventListener('keydown', (event) => {
    if (event.target === viewport && event.key.startsWith('Arrow')) {
      event.preventDefault()
      pan(event.key.slice(5).toLowerCase())
    }
  })
  new ResizeObserver(() => {
    if (data) renderMap()
  }).observe(viewport)
  void load()
}
