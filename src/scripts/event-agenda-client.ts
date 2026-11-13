import { agendaMonths, agendaToday, type AgendaEvent } from '../lib/event-agenda'
const root = document.getElementById('event-agenda')
if (root) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const feedback = get('agenda-feedback'),
    dialog = get<HTMLDialogElement>('agenda-dialog'),
    form = get<HTMLFormElement>('agenda-decision'),
    save = get<HTMLButtonElement>('agenda-save')
  let deletedEvents: AgendaEvent[] = []
  let checkedAt = ''
  let events: AgendaEvent[] = [],
    region = 'Tous',
    pillars = new Set<string>(),
    selected: AgendaEvent | undefined
  const el = (tag: string, text = '', cls = '') => {
    const n = document.createElement(tag)
    n.textContent = text
    n.className = cls
    return n
  }
  const tag = (value: string, cls = '') => el('span', value, 'agenda-tag ' + cls)
  const pillClass = (p: string) =>
    ({
      'santé mentale': 'agenda-tag--mental',
      CPS: 'agenda-tag--cps',
      numérique: 'agenda-tag--digital',
      éducation: 'agenda-tag--education',
    })[p] || ''
  const date = (s: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('fr-FR', { ...opts, timeZone: 'UTC' }).format(
      new Date(s + 'T12:00:00Z'),
    )
  async function request(method = 'GET', body?: unknown) {
    const r = await fetch('/api/interne/agenda-evenements', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'L’agenda est indisponible.')
    return data
  }
  async function load() {
    const result = await request()
    events = result.events
    deletedEvents = result.deletedEvents || []
    get('agenda-trash').textContent = `Corbeille (${deletedEvents.length})`
    checkedAt = result.checkedAt || ''
    render()
  }
  function card(e: AgendaEvent, next = false) {
    const card = el(
        'article',
        '',
        'agenda-event' + (e.status === 'rejeté' ? ' agenda-event--rejected' : ''),
      ),
      day = el('div', '', 'agenda-day'),
      content = el('div', '', 'agenda-event-content')
    day.append(
      el('strong', date(e.starts_on, { day: 'numeric' })),
      el('span', date(e.starts_on, { weekday: 'short' })),
      ...(next ? [el('span', date(e.starts_on, { month: 'short' }))] : []),
    )
    const title = el('h3', e.title, 'agenda-event-title')
    content.append(
      title,
      el('p', e.modality === 'en ligne' ? 'En ligne' : `${e.city} · ${e.region}`),
    )
    const tags = el('div', '', 'agenda-tags')
    tags.append(
      tag(e.modality),
      tag(e.access || 'accès à vérifier', e.access === 'gratuit' ? 'agenda-tag--free' : ''),
    )
    e.pillars.forEach((p) => tags.append(tag(p, pillClass(p))))
    tags.append(
      tag(
        e.status,
        e.status === 'confirmé'
          ? 'agenda-tag--confirmed'
          : e.status === 'rejeté'
            ? 'agenda-tag--rejected'
            : 'agenda-tag--pending',
      ),
    )
    e.attendance.forEach((p) => tags.append(tag(p, 'agenda-tag--person')))
    content.append(tags)
    if (next) content.append(el('p', e.interest))
    const open = el('button', 'Voir la fiche', 'agenda-open') as HTMLButtonElement
    open.type = 'button'
    open.setAttribute('aria-label', `Voir la fiche : ${e.title}`)
    open.addEventListener('click', () => show(e))
    content.append(open)
    card.append(day, content)
    return card
  }
  function render() {
    const today = agendaToday(),
      months = agendaMonths(today),
      visible = events
        .filter(
          (e) =>
            e.starts_on >= today &&
            (region === 'Tous' || e.region === region) &&
            (!pillars.size || e.pillars.some((p) => pillars.has(p))),
        )
        .sort(
          (a, b) => a.starts_on.localeCompare(b.starts_on) || a.title.localeCompare(b.title, 'fr'),
        )
    const next = get('agenda-next')
    next.replaceChildren()
    const decisions = events
      .filter((e) => e.starts_on >= today && e.status === 'à décider')
      .sort(
        (a, b) => a.starts_on.localeCompare(b.starts_on) || a.title.localeCompare(b.title, 'fr'),
      )
      .slice(0, 3)
    decisions.forEach((e) => next.append(card(e, true)))
    if (!decisions.length)
      next.append(el('p', 'Aucun événement à décider pour l’instant.', 'agenda-empty'))
    get('agenda-range').textContent = `${months[0].label} → ${months.at(-1)!.label}`
    const grid = get('agenda-months')
    grid.replaceChildren()
    months.forEach((m) => {
      const month = el('section', '', 'agenda-month'),
        heading = el('div', '', 'agenda-month-heading'),
        entries = visible.filter((e) => e.starts_on.startsWith(m.key)),
        list = el('div', '', 'agenda-month-events')
      heading.append(el('h3', m.label), el('span', String(entries.length)))
      entries.forEach((e) => list.append(card(e)))
      if (!entries.length) list.append(el('p', 'Rien de repéré pour l’instant.', 'agenda-empty'))
      month.append(heading, list)
      grid.append(month)
    })
    const latest = [...events.map((e) => Date.parse(e.updated_at)), Date.parse(checkedAt)].filter(
      Number.isFinite,
    )
    get('agenda-updated').textContent = latest.length
      ? `Mise à jour : ${new Date(Math.max(...latest)).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' })}`
      : 'En attente de la première sélection de newsletters'
  }
  function show(e: AgendaEvent) {
    selected = e
    const detail = get('agenda-detail')
    detail.replaceChildren()
    detail.append(
      el('h3', e.title),
      el(
        'p',
        date(e.starts_on, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      ),
      el('p', `Organisateur : ${e.organizer}`),
      el('p', e.modality === 'en ligne' ? 'En ligne' : `${e.city} · ${e.region}`),
      el('p', e.interest),
    )
    if (e.registration_url) {
      const a = el('a', 'S’inscrire / en savoir plus') as HTMLAnchorElement
      a.href = e.registration_url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      detail.append(a)
    } else detail.append(el('p', 'Lien d’inscription non indiqué dans la source.'))
    const sources = el('ul')
    e.sources.forEach((s) => sources.append(el('li', s)))
    detail.append(el('h3', 'Newsletters sources'), sources)
    get<HTMLSelectElement>('agenda-status').value = e.status
    form
      .querySelectorAll<HTMLInputElement>('[name=attendance]')
      .forEach((c) => (c.checked = e.attendance.includes(c.value)))
    get('agenda-save-feedback').textContent = ''
    dialog.showModal()
  }
  get('agenda-close').addEventListener('click', () => dialog.close())
  root.querySelectorAll<HTMLButtonElement>('[data-region]').forEach((b) =>
    b.addEventListener('click', () => {
      region = b.dataset.region!
      root
        .querySelectorAll<HTMLButtonElement>('[data-region]')
        .forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      render()
    }),
  )
  root.querySelectorAll<HTMLButtonElement>('[data-pillar]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = b.dataset.pillar!
      if (pillars.has(p)) pillars.delete(p)
      else pillars.add(p)
      b.setAttribute('aria-pressed', String(pillars.has(p)))
      render()
    }),
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!selected) return
    save.disabled = true
    get('agenda-save-feedback').textContent = 'Enregistrement…'
    try {
      await request('PATCH', {
        id: selected.id,
        version: selected.version,
        status: get<HTMLSelectElement>('agenda-status').value,
        attendance: [...form.querySelectorAll<HTMLInputElement>('[name=attendance]:checked')].map(
          (c) => c.value,
        ),
      })
      await load()
      dialog.close()
      feedback.textContent = 'La décision de l’équipe est enregistrée.'
    } catch (error) {
      get('agenda-save-feedback').textContent =
        error instanceof Error ? error.message : 'Enregistrement impossible.'
    } finally {
      save.disabled = false
    }
  })
  const addDialog = get<HTMLDialogElement>('agenda-add-dialog'),
    addForm = get<HTMLFormElement>('agenda-add-form')
  get('agenda-add').addEventListener('click', () => {
    addForm.reset()
    get<HTMLInputElement>('manual-starts_on').min = agendaToday()
    get('agenda-add-feedback').textContent = ''
    addDialog.showModal()
    setManualLocation()
  })
  get('agenda-add-close').addEventListener('click', () => addDialog.close())
  const setManualLocation = () => {
    const online = get<HTMLSelectElement>('manual-modality').value === 'en ligne'
    get<HTMLSelectElement>('manual-region').disabled = online
    get<HTMLSelectElement>('manual-region').parentElement!.hidden = online
    get<HTMLInputElement>('manual-city').required = !online
  }
  get('manual-modality').addEventListener('change', setManualLocation)
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = new FormData(addForm),
      pillars = data.getAll('pillars')
    if (!pillars.length) {
      get('agenda-add-feedback').textContent = 'Choisissez au moins un pilier.'
      return
    }
    const button = get<HTMLButtonElement>('agenda-add-save')
    button.disabled = true
    try {
      const event = Object.fromEntries(
        [
          'title',
          'organizer',
          'starts_on',
          'city',
          'region',
          'modality',
          'access',
          'interest',
          'registration_url',
        ].map((k) => [k, String(data.get(k) || '')]),
      )
      await request('POST', { action: 'manual', event: { ...event, pillars } })
      await load()
      addDialog.close()
      feedback.textContent = 'L’événement est enregistré dans l’agenda.'
    } catch (error) {
      get('agenda-add-feedback').textContent =
        error instanceof Error ? error.message : 'Ajout impossible.'
    } finally {
      button.disabled = false
    }
  })
  const helpDialog = get<HTMLDialogElement>('agenda-help-dialog')
  get('agenda-check-help').addEventListener('click', () => helpDialog.showModal())
  get('agenda-help-close').addEventListener('click', () => helpDialog.close())
  get('agenda-copy-check').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(get('agenda-check-phrase').textContent || '')
      get('agenda-copy-feedback').textContent =
        'Demande copiée. Collez-la dans le chat de l’agenda dans Codex.'
    } catch {
      get('agenda-copy-feedback').textContent = 'Sélectionnez et copiez la phrase ci-dessus.'
    }
  })
  const removeDialog = get<HTMLDialogElement>('agenda-remove-dialog')
  get('agenda-remove').addEventListener('click', () => {
    if (!selected) return
    dialog.close()
    get('agenda-remove-name').textContent = selected.title
    get('agenda-remove-feedback').textContent = ''
    removeDialog.showModal()
  })
  get('agenda-remove-cancel').addEventListener('click', () => removeDialog.close())
  get('agenda-remove-confirm').addEventListener('click', async () => {
    if (!selected) return
    const button = get<HTMLButtonElement>('agenda-remove-confirm')
    button.disabled = true
    try {
      await request('DELETE', { id: selected.id, version: selected.version })
      await load()
      removeDialog.close()
      feedback.textContent = 'L’événement a été placé dans la corbeille.'
    } catch (error) {
      get('agenda-remove-feedback').textContent =
        error instanceof Error ? error.message : 'Suppression impossible.'
    } finally {
      button.disabled = false
    }
  })
  const trashDialog = get<HTMLDialogElement>('agenda-trash-dialog')
  function renderTrash() {
    const list = get('agenda-trash-list')
    list.replaceChildren()
    if (!deletedEvents.length) list.append(el('p', 'La corbeille est vide.'))
    deletedEvents.forEach((e) => {
      const row = el('article'),
        text = el('div'),
        button = el('button', 'Restaurer', 'iw-button') as HTMLButtonElement
      text.append(
        el('h3', e.title),
        el('p', date(e.starts_on, { day: 'numeric', month: 'long', year: 'numeric' })),
      )
      button.type = 'button'
      button.addEventListener('click', async () => {
        button.disabled = true
        try {
          await request('PATCH', { action: 'restore', id: e.id, version: e.version })
          await load()
          renderTrash()
        } catch (error) {
          get('agenda-trash-feedback').textContent =
            error instanceof Error ? error.message : 'Restauration impossible.'
        } finally {
          button.disabled = false
        }
      })
      row.append(text, button)
      list.append(row)
    })
  }
  get('agenda-trash').addEventListener('click', () => {
    renderTrash()
    get('agenda-trash-feedback').textContent = ''
    trashDialog.showModal()
  })
  get('agenda-trash-close').addEventListener('click', () => trashDialog.close())
  load().catch((error) => {
    feedback.textContent = error instanceof Error ? error.message : 'Chargement impossible.'
  })
}
