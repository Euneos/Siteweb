import type { Entry, WorkspaceIdentity } from '../lib/internal-workspace'

type Kind = Entry['kind']
type EntryInput = Pick<
  Entry,
  | 'kind'
  | 'title'
  | 'starts_on'
  | 'ends_on'
  | 'person'
  | 'activity'
  | 'channel'
  | 'attendance'
  | 'location'
  | 'status'
  | 'hours'
  | 'notes'
  | 'content'
  | 'link'
>
type Field = Exclude<keyof EntryInput, 'kind'>
type Total = { person: string; declared: number; approved: number }
type CalendarData = { entries: Entry[]; totals: Total[]; identity: WorkspaceIdentity }
type Comment = { id: string; author: string; content: string; created_at: string }
type Resource = { id: string; title: string; category: string; description: string; url: string }
const labels: Record<Field, string> = {
  title: 'Titre',
  starts_on: 'Début',
  ends_on: 'Fin',
  person: 'Personne',
  activity: 'Activité',
  channel: 'Canal',
  attendance: 'Présence / absence',
  location: 'Lieu',
  status: 'Statut de suivi',
  hours: 'Heures',
  notes: 'Notes & contexte',
  content: 'Texte du contenu',
  link: 'Lien associé',
}
const fields = Object.keys(labels) as Field[]
const statuses: Record<string, string> = {
  brouillon: 'Brouillon',
  a_valider: 'À valider',
  valide: 'Validé',
  publie: 'Publié',
  annule: 'Annulé',
}
const attendanceLabels: Record<string, string> = {
  presence: 'Présence',
  absence: 'Absence',
  conge: 'Congé',
}
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const longDateFormat = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}
const button = (text: string, callback: () => void, className = 'iw-button') => {
  const element = node('button', className, text)
  element.type = 'button'
  element.addEventListener('click', callback)
  return element
}
const localDate = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
const dateObject = (date: string) => new Date(`${date}T12:00:00Z`)
const hours = (value: number) => `${numberFormat.format(value)} h`
const safeUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}
const feedback = (element: HTMLElement, text: string, error = false) => {
  element.textContent = text
  element.dataset.tone = error ? 'error' : 'info'
  element.setAttribute('role', error ? 'alert' : 'status')
}
const updated = (element: HTMLElement) => {
  element.textContent = `Actualisé à ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`
}
const setState = (
  element: HTMLElement,
  title: string,
  message: string,
  retry?: () => void,
  loading = false,
) => {
  element.replaceChildren()
  element.hidden = false
  if (loading) {
    const spinner = node('span', 'iw-loading')
    spinner.setAttribute('aria-hidden', 'true')
    element.append(spinner)
  }
  element.append(node('h3', '', title), node('p', '', message))
  if (retry) element.append(button('Réessayer', retry))
}
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const timeout = new AbortController()
  const abort = () => timeout.abort()
  if (options.signal?.aborted) timeout.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(abort, 20000)
  try {
    const response = await fetch(url, {
      ...options,
      signal: timeout.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    const isJson = response.headers.get('content-type')?.includes('application/json')
    const payload = isJson ? await response.json() : null
    if (!response.ok || !isJson || response.redirected) {
      const fallback =
        response.status === 401 || response.status === 403 || response.redirected
          ? 'Votre accès a expiré ou ne permet pas cette opération. Reconnectez-vous avec votre compte autorisé.'
          : response.status === 404
            ? 'Ces données sont introuvables. Actualisez ou contactez l’équipe.'
            : 'Le service est momentanément indisponible. Réessayez dans un instant.'
      throw new ApiError(
        response.status,
        typeof payload?.error === 'string' ? payload.error : fallback,
      )
    }
    return payload as T
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'La connexion a été interrompue ou le service n’a pas répondu. Réessayez dans un instant.'
const validCalendar = (data: CalendarData) => {
  if (
    !Array.isArray(data.entries) ||
    !Array.isArray(data.totals) ||
    typeof data.identity?.email !== 'string' ||
    typeof data.identity.admin !== 'boolean'
  )
    throw new ApiError(502, 'La réponse du calendrier est incomplète. Réessayez.')
  if (
    data.entries.some(
      (entry) =>
        !entry ||
        !Number.isSafeInteger(entry.version) ||
        typeof entry.id !== 'string' ||
        fields.some((field) =>
          field === 'hours'
            ? entry.hours !== null &&
              (typeof entry.hours !== 'number' || !Number.isFinite(entry.hours))
            : typeof entry[field] !== 'string',
        ),
    ) ||
    data.totals.some(
      (total) =>
        typeof total.person !== 'string' ||
        !Number.isFinite(total.declared) ||
        !Number.isFinite(total.approved),
    )
  )
    throw new ApiError(502, 'Les données reçues ne peuvent pas être affichées. Réessayez.')
  return data
}
const calendarUrl = (month: string, kind: Kind) =>
  `/api/interne/calendrier?${new URLSearchParams({ month, kind })}`

function initCalendar(root: HTMLElement) {
  let identity: WorkspaceIdentity = {
    email: root.dataset.email ?? '',
    admin: root.dataset.admin === 'true',
  }
  let kind: Kind = 'editorial'
  let month = localDate().slice(0, 7)
  let view: 'month' | 'list' = 'month'
  let data: CalendarData | null = null
  let loadController: AbortController | null = null
  const monthInput = byId<HTMLInputElement>('iw-month')
  const content = byId('iw-calendar-content')
  const state = byId('iw-calendar-state')
  const filters = [...root.querySelectorAll<HTMLSelectElement>('[data-filter]')]
  const dialog = byId<HTMLDialogElement>('iw-editor')
  const form = byId<HTMLFormElement>('iw-entry-form')
  const fieldset = byId<HTMLFieldSetElement>('iw-entry-fields')
  const save = byId<HTMLButtonElement>('iw-save')
  const saveFeedback = byId('iw-save-feedback')
  const commentForm = byId<HTMLFormElement>('iw-comment-form')
  const commentInput = byId<HTMLTextAreaElement>('iw-comment')
  const commentSubmit = byId<HTMLButtonElement>('iw-comment-submit')
  const conflict = byId('iw-conflict')
  const mergeFields = byId('iw-conflict-fields')
  const mergeButton = byId<HTMLButtonElement>('iw-apply-merge')
  const input = (field: Field) =>
    form.elements.namedItem(field) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  let selected: Entry | null = null
  let editorKind: Kind = kind
  let savedSnapshot = ''
  let entryRequestId = ''
  let commentRequestId = ''
  let lastAttempt: EntryInput | null = null
  let saving = false
  let commenting = false
  let comparing = false
  let readOnly = false
  let conflictPending = false
  let latestConflict: Entry | null = null
  let draftAtComparison = ''
  let commentsController: AbortController | null = null
  let opener: HTMLElement | null = null
  let modalGeneration = 0

  const readForm = (): EntryInput => ({
    kind: editorKind,
    title: input('title').value.trim(),
    starts_on: input('starts_on').value,
    ends_on: input('ends_on').value,
    person: input('person').value.trim(),
    activity: input('activity').value.trim(),
    channel: input('channel').value.trim(),
    attendance: editorKind === 'equipe' ? (input('attendance').value as Entry['attendance']) : '',
    location: editorKind === 'equipe' ? input('location').value.trim() : '',
    status: input('status').value,
    hours:
      editorKind === 'equipe' && input('hours').value !== '' ? Number(input('hours').value) : null,
    notes: input('notes').value.trim(),
    content: input('content').value.trim(),
    link: input('link').value.trim(),
  })
  // Raw values detect even whitespace edits before closing; payloads are normalized separately.
  const snapshot = () => JSON.stringify(fields.map((field) => input(field).value))
  const isDirty = () =>
    dialog.open && (snapshot() !== savedSnapshot || commentInput.value.length > 0)
  const canEdit = (entry: Entry | null) =>
    !entry ||
    entry.kind === 'editorial' ||
    identity.admin ||
    (entry.created_by === identity.email && entry.person.toLowerCase() === identity.email)
  const updateLink = () => {
    const link = byId<HTMLAnchorElement>('iw-open-link')
    const url = safeUrl(input('link').value.trim())
    link.hidden = !url
    if (url) link.href = url.href
    else link.removeAttribute('href')
  }
  const updatePermissions = () => {
    readOnly = !canEdit(selected)
    fieldset.disabled = readOnly || saving || comparing
    save.hidden = readOnly
    save.disabled = saving || conflictPending || comparing
    byId('iw-readonly').hidden = !readOnly
    const person = input('person') as HTMLInputElement
    person.type = editorKind === 'equipe' ? 'email' : 'text'
    person.readOnly = editorKind === 'equipe' && !identity.admin
    // Existing values stay visible in read-only records belonging to another person.
    if (!selected && person.readOnly) person.value = identity.email
  }
  const fillForm = (entry: EntryInput) => {
    const statusSelect = input('status') as HTMLSelectElement
    statusSelect.replaceChildren()
    for (const [value, label] of Object.entries(statuses)) {
      if (editorKind === 'equipe' && value === 'publie') continue
      const option = new Option(label, value)
      if (editorKind === 'equipe' && !identity.admin && value === 'valide') option.disabled = true
      statusSelect.add(option)
    }
    for (const field of fields)
      input(field).value = entry[field] === null ? '' : String(entry[field])
    byId('iw-hours-field').hidden = editorKind !== 'equipe'
    byId('iw-attendance-field').hidden = editorKind !== 'equipe'
    byId('iw-location-field').hidden = editorKind !== 'equipe'
    updatePermissions()
    updateLink()
  }
  const setMetrics = (loaded: CalendarData | null) => {
    byId('iw-metric-label-1').textContent = 'Fiches du mois'
    byId('iw-metric-label-2').textContent = kind === 'equipe' ? 'Heures déclarées' : 'À valider'
    byId('iw-metric-label-3').textContent = kind === 'equipe' ? 'Heures validées' : 'Publiées'
    byId('iw-metric-1').textContent = loaded ? String(loaded.entries.length) : '—'
    byId('iw-metric-2').textContent = loaded
      ? kind === 'equipe'
        ? hours(loaded.totals.reduce((sum, row) => sum + row.declared, 0))
        : String(loaded.entries.filter((entry) => entry.status === 'a_valider').length)
      : '—'
    byId('iw-metric-3').textContent = loaded
      ? kind === 'equipe'
        ? hours(loaded.totals.reduce((sum, row) => sum + row.approved, 0))
        : String(loaded.entries.filter((entry) => entry.status === 'publie').length)
      : '—'
  }
  const fillFilters = () => {
    if (!data) return
    for (const filter of filters) {
      const field = filter.dataset.filter as 'person' | 'activity' | 'channel' | 'status'
      const current = filter.value
      const first = filter.options[0].cloneNode(true)
      const values =
        field === 'status'
          ? Object.keys(statuses).filter((status) => kind === 'editorial' || status !== 'publie')
          : [...new Set(data.entries.map((entry) => entry[field]).filter(Boolean))].sort((a, b) =>
              a.localeCompare(b, 'fr'),
            )
      if (current && !values.includes(current)) values.push(current)
      filter.replaceChildren(first)
      values.forEach((value) =>
        filter.add(new Option(field === 'status' ? statuses[value] : value, value)),
      )
      filter.value = current
    }
    for (const [field, id] of [
      ['person', 'iw-people-options'],
      ['activity', 'iw-activities-options'],
      ['channel', 'iw-channels-options'],
    ] as const) {
      const list = byId(id)
      list.replaceChildren(
        ...[...new Set(data.entries.map((entry) => entry[field]).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'fr'))
          .map((value) => new Option(value, value)),
      )
    }
  }
  const renderTotals = () => {
    byId('iw-totals').hidden = kind !== 'equipe'
    const target = byId('iw-totals-content')
    target.replaceChildren()
    if (!data) {
      target.append(
        node(
          'p',
          'iw-muted',
          'Totaux indisponibles tant que les données du mois ne sont pas chargées.',
        ),
      )
      return
    }
    if (!data.totals.length) {
      target.append(node('p', 'iw-muted', 'Aucune heure déclarée pour ce mois.'))
      return
    }
    const table = node('table', 'iw-table')
    table.append(
      node(
        'caption',
        'iw-sr-only',
        `Heures déclarées et validées en ${monthFormat.format(dateObject(`${month}-01`))}`,
      ),
    )
    const head = table.createTHead().insertRow()
    for (const label of ['Personne', 'Déclarées', 'Validées']) {
      const th = node('th', '', label)
      th.scope = 'col'
      head.append(th)
    }
    const body = table.createTBody()
    data.totals
      .slice()
      .sort((a, b) => a.person.localeCompare(b.person, 'fr'))
      .forEach((total) => {
        const row = body.insertRow()
        const name = node('th', '', total.person)
        name.scope = 'row'
        row.append(
          name,
          node('td', '', hours(total.declared)),
          node('td', '', hours(total.approved)),
        )
      })
    const foot = table.createTFoot().insertRow()
    const label = node('th', '', 'Total du mois')
    label.scope = 'row'
    foot.append(
      label,
      node('td', '', hours(data.totals.reduce((sum, row) => sum + row.declared, 0))),
      node('td', '', hours(data.totals.reduce((sum, row) => sum + row.approved, 0))),
    )
    target.append(table)
  }
  const badge = (entry: Entry) => {
    const element = node('span', 'iw-badge', statuses[entry.status] ?? entry.status)
    element.dataset.status = entry.status
    return element
  }
  const dateRange = (entry: Entry) =>
    entry.starts_on === entry.ends_on
      ? dateFormat.format(dateObject(entry.starts_on))
      : `${dateFormat.format(dateObject(entry.starts_on))} → ${dateFormat.format(dateObject(entry.ends_on))}`
  const agenda = (entries: Entry[]) => {
    const list = node('ul', 'iw-agenda')
    for (const entry of entries) {
      const item = node('li', 'iw-agenda__item')
      const open = button('', () => openEditor(entry), 'iw-entry')
      const text = node('span')
      text.append(
        node('span', 'iw-entry__title', entry.title),
        node(
          'span',
          'iw-entry__details',
          [entry.activity, entry.channel, entry.location, attendanceLabels[entry.attendance]]
            .filter(Boolean)
            .join(' · ') || 'Activité non renseignée',
        ),
      )
      const person = node('span', 'iw-entry__person', entry.person)
      if (entry.hours !== null) person.append(node('span', 'iw-entry__details', hours(entry.hours)))
      open.append(node('span', 'iw-entry__date', dateRange(entry)), text, person, badge(entry))
      open.setAttribute(
        'aria-label',
        `Ouvrir ${entry.title}, ${dateRange(entry)}, ${entry.person}, ${statuses[entry.status] ?? entry.status}`,
      )
      item.append(open)
      list.append(item)
    }
    return list
  }
  const monthGrid = (entries: Entry[]) => {
    const section = node('div', 'iw-month')
    section.setAttribute('aria-label', monthFormat.format(dateObject(`${month}-01`)))
    const weekdays = node('div', 'iw-weekdays')
    weekdays.setAttribute('aria-hidden', 'true')
    for (const day of ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'])
      weekdays.append(node('span', '', day))
    const days = node('div', 'iw-days')
    const start = dateObject(`${month}-01`)
    const offset = (start.getUTCDay() + 6) % 7
    const numberOfDays = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
    ).getUTCDate()
    for (let index = 0; index < Math.ceil((offset + numberOfDays) / 7) * 7; index++) {
      const day = index - offset + 1
      const cell = node('div', 'iw-day')
      if (day < 1 || day > numberOfDays) {
        cell.classList.add('iw-day--outside')
        cell.setAttribute('aria-hidden', 'true')
        days.append(cell)
        continue
      }
      const date = `${month}-${String(day).padStart(2, '0')}`
      if (date === localDate()) cell.classList.add('iw-day--today')
      const time = node('time', 'iw-day__date', String(day))
      time.dateTime = date
      time.setAttribute('aria-label', longDateFormat.format(dateObject(date)))
      if (date === localDate()) time.setAttribute('aria-current', 'date')
      cell.append(time)
      const todayEntries = entries.filter(
        (entry) => entry.starts_on <= date && entry.ends_on >= date,
      )
      const events = node('div', 'iw-day__events')
      todayEntries.forEach((entry) => {
        const event = button('', () => openEditor(entry), 'iw-event')
        event.dataset.status = entry.status
        event.append(
          node('span', 'iw-event__title', entry.title),
          node(
            'span',
            'iw-event__meta',
            [
              entry.person,
              statuses[entry.status] ?? entry.status,
              entry.channel,
              attendanceLabels[entry.attendance],
              entry.location,
              entry.hours !== null ? hours(entry.hours) : '',
            ]
              .filter(Boolean)
              .join(' · '),
          ),
        )
        event.setAttribute(
          'aria-label',
          `Ouvrir ${entry.title}, ${longDateFormat.format(dateObject(date))}, ${entry.person}, ${statuses[entry.status] ?? entry.status}`,
        )
        events.append(event)
      })
      cell.append(events)
      if (todayEntries.length) {
        const count = node(
          'span',
          'iw-day__count',
          `${todayEntries.length} fiche${todayEntries.length > 1 ? 's' : ''}`,
        )
        count.setAttribute('aria-hidden', 'true')
        cell.append(count)
      }
      days.append(cell)
    }
    const mobile = node('div', 'iw-month-agenda')
    mobile.append(node('h3', 'iw-sr-only', 'Fiches du mois'), agenda(entries))
    section.append(weekdays, days, mobile)
    return section
  }
  const render = () => {
    if (!data) return
    const entries = data.entries
      .filter((entry) =>
        filters.every(
          (filter) => !filter.value || entry[filter.dataset.filter as keyof Entry] === filter.value,
        ),
      )
      .sort(
        (a, b) => a.starts_on.localeCompare(b.starts_on) || a.title.localeCompare(b.title, 'fr'),
      )
    const active = filters.some((filter) => filter.value)
    byId('iw-result-count').textContent =
      `${entries.length} fiche${entries.length > 1 ? 's' : ''}${active ? ` sur ${data.entries.length}` : ''} · ${monthFormat.format(dateObject(`${month}-01`))}`
    content.replaceChildren()
    content.hidden = !entries.length
    state.hidden = !!entries.length
    if (!entries.length) {
      setState(
        state,
        active ? 'Aucune fiche ne correspond' : 'Le mois est encore libre',
        active
          ? 'Essayez une autre combinaison de filtres.'
          : 'Ajoutez une fiche pour préparer un contenu ou renseigner une activité.',
      )
      state.append(
        button(
          active ? 'Effacer les filtres' : 'Créer la première fiche',
          active ? resetFilters : () => openEditor(null),
          'iw-button iw-button--primary',
        ),
      )
    } else content.append(view === 'month' ? monthGrid(entries) : agenda(entries))
  }
  function resetFilters() {
    filters.forEach((filter) => {
      filter.value = ''
    })
    render()
  }
  async function loadCalendar() {
    loadController?.abort()
    const controller = new AbortController()
    loadController = controller
    data = null
    content.hidden = true
    content.setAttribute('aria-busy', 'true')
    setMetrics(null)
    renderTotals()
    byId('iw-result-count').textContent = 'Chargement du calendrier…'
    byId('iw-updated').textContent = ''
    byId<HTMLButtonElement>('iw-refresh').disabled = true
    setState(
      state,
      'Chargement du calendrier',
      'Nous récupérons les fiches du mois.',
      undefined,
      true,
    )
    try {
      const response = validCalendar(
        await api<CalendarData>(calendarUrl(month, kind), { signal: controller.signal }),
      )
      if (controller.signal.aborted) return
      data = response
      identity = response.identity
      setMetrics(data)
      fillFilters()
      renderTotals()
      render()
      updated(byId('iw-updated'))
      byId('iw-comment-author').textContent = identity.email
      if (dialog.open) updatePermissions()
    } catch (error) {
      if (controller.signal.aborted) return
      byId('iw-result-count').textContent = 'Calendrier indisponible'
      setState(
        state,
        'Le calendrier n’a pas pu être chargé',
        errorText(error),
        () => void loadCalendar(),
      )
    } finally {
      if (!controller.signal.aborted) {
        content.setAttribute('aria-busy', 'false')
        byId<HTMLButtonElement>('iw-refresh').disabled = false
      }
    }
  }
  function changeMonth(next: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next) || next < '1900-01' || next > '2200-12') {
      monthInput.value = month
      return
    }
    month = next
    monthInput.value = month
    byId<HTMLButtonElement>('iw-prev').disabled = month === '1900-01'
    byId<HTMLButtonElement>('iw-next').disabled = month === '2200-12'
    void loadCalendar()
  }
  function stepMonth(step: number) {
    const date = dateObject(`${month}-01`)
    date.setUTCMonth(date.getUTCMonth() + step)
    changeMonth(date.toISOString().slice(0, 7))
  }
  function closeEditor() {
    dialog.close()
    commentsController?.abort()
    modalGeneration++
    if (opener?.isConnected) opener.focus()
    else byId('iw-new').focus()
  }
  function requestClose() {
    if (saving || commenting || comparing) {
      feedback(
        saveFeedback,
        'Une opération est en cours. Attendez sa confirmation avant de fermer.',
      )
      return
    }
    if (isDirty()) {
      byId('iw-close-warning').hidden = false
      byId('iw-keep-editing').focus()
      return
    }
    closeEditor()
  }
  function openEditor(entry: Entry | null) {
    opener = document.activeElement as HTMLElement
    modalGeneration++
    selected = entry ? { ...entry } : null
    editorKind = entry?.kind ?? kind
    entryRequestId = crypto.randomUUID()
    commentRequestId = crypto.randomUUID()
    lastAttempt = null
    conflictPending = false
    latestConflict = null
    conflict.hidden = true
    mergeFields.replaceChildren()
    mergeButton.hidden = true
    feedback(saveFeedback, '')
    feedback(byId('iw-comment-feedback'), '')
    commentInput.value = ''
    byId('iw-close-warning').hidden = true
    byId('iw-comment-list').replaceChildren()
    byId('iw-editor-kind').textContent =
      editorKind === 'editorial' ? 'Calendrier éditorial' : 'Équipe & heures'
    byId('iw-editor-title').textContent = entry ? 'Détail de la fiche' : 'Nouvelle fiche'
    byId('iw-entry-audit').textContent = entry
      ? `Créée par ${entry.created_by} · Dernière modification : ${entry.updated_by} · Version ${entry.version}`
      : ''
    const date = month === localDate().slice(0, 7) ? localDate() : `${month}-01`
    fillForm(
      entry ?? {
        kind: editorKind,
        title: '',
        starts_on: date,
        ends_on: date,
        person: editorKind === 'equipe' ? identity.email : '',
        activity: '',
        channel: '',
        attendance: '',
        location: '',
        status: 'brouillon',
        hours: null,
        notes: '',
        content: '',
        link: '',
      },
    )
    savedSnapshot = snapshot()
    if (entry?.kind === 'equipe' && entry.status === 'valide' && !identity.admin && !readOnly)
      feedback(
        saveFeedback,
        'Pour modifier une fiche validée, choisissez d’abord le statut « À valider ».',
      )
    commentForm.hidden = !entry
    byId('iw-comments-refresh').hidden = !entry
    byId('iw-comments-state').textContent = entry
      ? 'Chargement des commentaires…'
      : 'Enregistrez la fiche pour démarrer la discussion.'
    dialog.showModal()
    if (readOnly) byId('iw-close').focus()
    else input('title').focus()
    if (entry) void loadComments()
  }
  async function loadComments(): Promise<Comment[] | null> {
    if (!selected) return null
    commentsController?.abort()
    const controller = new AbortController()
    commentsController = controller
    const id = selected.id
    const state = byId('iw-comments-state')
    state.textContent = 'Chargement des commentaires…'
    byId<HTMLButtonElement>('iw-comments-refresh').disabled = true
    byId('iw-comment-list').replaceChildren()
    try {
      const response = await api<{ comments: Comment[] }>(
        `/api/interne/commentaires?${new URLSearchParams({ entryId: id })}`,
        { signal: controller.signal },
      )
      if (controller.signal.aborted || selected?.id !== id || !dialog.open) return null
      if (
        !Array.isArray(response.comments) ||
        response.comments.some(
          (comment) =>
            !comment ||
            ['id', 'author', 'content', 'created_at'].some(
              (key) => typeof comment[key as keyof Comment] !== 'string',
            ),
        )
      )
        throw new ApiError(502, 'Les commentaires reçus sont incomplets.')
      state.textContent = response.comments.length
        ? `${response.comments.length} commentaire${response.comments.length > 1 ? 's' : ''}`
        : 'Aucun commentaire pour le moment. Lancez la discussion.'
      const list = byId('iw-comment-list')
      response.comments.forEach((comment) => {
        const item = node('li', 'iw-comment')
        const header = node('div', 'iw-comment__header')
        header.append(node('strong', '', comment.author))
        const date = new Date(comment.created_at)
        if (Number.isFinite(date.getTime())) {
          const time = node(
            'time',
            '',
            new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(
              date,
            ),
          )
          time.dateTime = date.toISOString()
          header.append(time)
        }
        item.append(header, node('p', 'iw-comment__content', comment.content))
        list.append(item)
      })
      return response.comments
    } catch (error) {
      if (!controller.signal.aborted)
        state.textContent = `Commentaires indisponibles. ${errorText(error)}`
      return null
    } finally {
      if (!controller.signal.aborted)
        byId<HTMLButtonElement>('iw-comments-refresh').disabled = false
    }
  }
  async function compareVersions() {
    if (comparing || saving) return
    const comparisonSnapshot = snapshot()
    const draft = readForm()
    const generation = modalGeneration
    const candidateId = selected?.id ?? entryRequestId
    const previous = selected ?? lastAttempt
    comparing = true
    updatePermissions()
    byId<HTMLButtonElement>('iw-compare').disabled = true
    feedback(saveFeedback, 'Recherche de la version actuelle…')
    try {
      const response = await api<{ entry: Entry; identity: WorkspaceIdentity }>(
        `/api/interne/calendrier?entryId=${encodeURIComponent(candidateId)}`,
      )
      const latest = validCalendar({
        entries: [response.entry],
        totals: [],
        identity: response.identity,
      }).entries[0]
      if (!dialog.open || generation !== modalGeneration) return
      if (!latest || latest.id !== candidateId)
        throw new ApiError(404, 'La fiche est introuvable. Votre saisie est conservée.')
      if (snapshot() !== comparisonSnapshot)
        throw new ApiError(
          409,
          'Votre saisie a changé pendant la comparaison. Comparez à nouveau pour la conserver.',
        )
      if (!canEdit(latest))
        throw new ApiError(
          403,
          'Votre compte ne peut plus modifier cette fiche. Votre saisie est conservée.',
        )
      latestConflict = latest
      draftAtComparison = comparisonSnapshot
      mergeFields.replaceChildren()
      for (const field of fields) {
        if (latest[field] === draft[field]) continue
        const group = node('div', 'iw-conflict-field')
        const label = node('label', '', labels[field])
        label.htmlFor = `iw-merge-${field}`
        const values = node('div', 'iw-conflict-values')
        const display = (value: EntryInput[Field]) =>
          value === null || value === ''
            ? 'Non renseigné'
            : field === 'status'
              ? (statuses[String(value)] ?? String(value))
              : field === 'attendance'
                ? (attendanceLabels[String(value)] ?? String(value))
                : String(value)
        const current = node('div')
        current.append(
          node('strong', '', 'Version actuelle'),
          node('p', '', display(latest[field])),
        )
        const yours = node('div')
        yours.append(node('strong', '', 'Votre saisie'), node('p', '', display(draft[field])))
        values.append(current, yours)
        const choice = node('select')
        choice.id = `iw-merge-${field}`
        choice.dataset.field = field
        choice.required = true
        choice.add(new Option('Choisir la valeur à conserver…', ''))
        choice.add(new Option('Conserver ma saisie', 'mine'))
        choice.add(new Option('Utiliser la version actuelle', 'current'))
        choice.value =
          draft[field] === previous?.[field]
            ? 'current'
            : latest[field] === previous?.[field]
              ? 'mine'
              : ''
        group.append(label, values, choice)
        mergeFields.append(group)
      }
      mergeButton.hidden = false
      feedback(
        saveFeedback,
        'Relisez les différences et choisissez les valeurs à conserver. Aucun changement n’est encore enregistré.',
      )
      mergeFields.querySelector<HTMLSelectElement>('select')?.focus()
    } catch (error) {
      feedback(saveFeedback, errorText(error), true)
    } finally {
      comparing = false
      byId<HTMLButtonElement>('iw-compare').disabled = false
      updatePermissions()
    }
  }
  function applyMerge() {
    if (!latestConflict) return
    if (snapshot() !== draftAtComparison) {
      feedback(
        saveFeedback,
        'La saisie a changé depuis la comparaison. Comparez à nouveau pour conserver vos dernières modifications.',
        true,
      )
      return
    }
    const choices = [...mergeFields.querySelectorAll<HTMLSelectElement>('select')]
    if (choices.some((choice) => !choice.reportValidity())) return
    const draft = readForm()
    // Assign through the controls so no untrusted content is interpreted as markup.
    for (const choice of choices)
      if (choice.value === 'current') {
        const field = choice.dataset.field as Field
        input(field).value = latestConflict[field] === null ? '' : String(latestConflict[field])
      }
    selected = { ...latestConflict }
    editorKind = selected.kind
    conflictPending = false
    conflict.hidden = true
    mergeButton.hidden = true
    latestConflict = null
    updatePermissions()
    updateLink()
    byId('iw-entry-audit').textContent =
      `Créée par ${selected.created_by} · Dernière modification : ${selected.updated_by} · Version ${selected.version}`
    feedback(
      saveFeedback,
      'Les choix sont appliqués à votre brouillon. Vérifiez la fiche, puis enregistrez-la.',
    )
    commentForm.hidden = false
    byId('iw-comments-refresh').hidden = false
    void loadComments()
    // Merging is deliberately not a save; keep the form dirty even with no differences.
    savedSnapshot = JSON.stringify({ mergedFrom: draft })
    save.focus()
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (saving || readOnly || conflictPending || comparing || !form.reportValidity()) return
    const entry = readForm()
    if (!entry.title || !entry.person) {
      feedback(saveFeedback, 'Renseignez un titre et une personne.', true)
      ;(!entry.title ? input('title') : input('person')).focus()
      return
    }
    if (entry.ends_on < entry.starts_on) {
      feedback(
        saveFeedback,
        'La date de fin doit être égale ou postérieure à la date de début.',
        true,
      )
      input('ends_on').focus()
      return
    }
    if (
      entry.hours !== null &&
      entry.hours > 0 &&
      entry.starts_on.slice(0, 7) !== entry.ends_on.slice(0, 7)
    ) {
      feedback(
        saveFeedback,
        'Pour déclarer des heures sur plusieurs mois, créez une fiche par mois.',
        true,
      )
      input('ends_on').focus()
      return
    }
    if (entry.link && !safeUrl(entry.link)) {
      feedback(saveFeedback, 'Utilisez un lien HTTPS sans identifiant ni mot de passe.', true)
      input('link').focus()
      return
    }
    if (editorKind === 'equipe' && !identity.admin && entry.status === 'valide') {
      feedback(
        saveFeedback,
        'Choisissez « À valider » pour soumettre cette fiche à un responsable.',
        true,
      )
      input('status').focus()
      return
    }
    const previous = selected
    if (!lastAttempt) lastAttempt = entry
    saving = true
    updatePermissions()
    save.textContent = 'Enregistrement…'
    feedback(saveFeedback, '')
    try {
      const result = await api<{ id: string }>('/api/interne/calendrier', {
        method: previous ? 'PATCH' : 'POST',
        body: JSON.stringify(
          previous
            ? { id: previous.id, version: previous.version, entry }
            : { requestId: entryRequestId, entry },
        ),
      })
      if (typeof result.id !== 'string' || !result.id)
        throw new ApiError(502, 'L’enregistrement n’a pas pu être confirmé.')
      selected = {
        ...entry,
        id: result.id,
        version: previous ? previous.version + 1 : 1,
        created_by: previous?.created_by ?? identity.email,
        updated_by: identity.email,
      }
      savedSnapshot = snapshot()
      byId('iw-close-warning').hidden = true
      byId('iw-editor-title').textContent = 'Détail de la fiche'
      byId('iw-entry-audit').textContent =
        `Créée par ${selected.created_by} · Dernière modification : ${selected.updated_by} · Version ${selected.version}`
      feedback(saveFeedback, 'Fiche enregistrée. Vous pouvez poursuivre la discussion ci-dessous.')
      feedback(byId('iw-notice'), `« ${entry.title} » a été enregistrée.`)
      commentForm.hidden = false
      byId('iw-comments-refresh').hidden = false
      if (!previous) void loadComments()
      // Stay on the saved month so a moved or newly created entry can be found.
      if (entry.starts_on.slice(0, 7) !== month) changeMonth(entry.starts_on.slice(0, 7))
      else void loadCalendar()
    } catch (error) {
      feedback(saveFeedback, `${errorText(error)} Votre saisie est conservée.`, true)
      if (error instanceof ApiError && error.status === 409) {
        conflictPending = true
        conflict.hidden = false
        byId('iw-compare').focus()
      }
    } finally {
      saving = false
      save.textContent = 'Enregistrer la fiche'
      updatePermissions()
    }
  })
  commentForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!selected || commenting || !commentForm.reportValidity()) return
    const content = commentInput.value.trim()
    if (!content) {
      feedback(byId('iw-comment-feedback'), 'Écrivez un commentaire avant de l’envoyer.', true)
      commentInput.focus()
      return
    }
    commenting = true
    commentSubmit.disabled = true
    commentInput.readOnly = true
    commentSubmit.textContent = 'Envoi…'
    try {
      await api('/api/interne/commentaires', {
        method: 'POST',
        body: JSON.stringify({ entryId: selected.id, content, requestId: commentRequestId }),
      })
      commentInput.value = ''
      commentRequestId = crypto.randomUUID()
      feedback(byId('iw-comment-feedback'), 'Commentaire ajouté.')
      await loadComments()
    } catch (error) {
      feedback(
        byId('iw-comment-feedback'),
        `${errorText(error)} Votre commentaire est conservé.`,
        true,
      )
      if (error instanceof ApiError && error.status === 409) {
        const loaded = await loadComments()
        const confirmed = loaded?.find(
          (comment) => comment.id === commentRequestId && comment.author === identity.email,
        )
        if (confirmed) {
          commentRequestId = crypto.randomUUID()
          if (confirmed.content === content) commentInput.value = ''
          feedback(
            byId('iw-comment-feedback'),
            confirmed.content === content
              ? 'Ce commentaire est déjà enregistré.'
              : 'Votre précédent commentaire est déjà enregistré. Le nouveau texte est conservé ci-dessus ; vous pouvez l’envoyer séparément.',
          )
        }
      }
    } finally {
      commenting = false
      commentSubmit.disabled = false
      commentInput.readOnly = false
      commentSubmit.textContent = 'Ajouter le commentaire'
    }
  })
  form.addEventListener('input', () => {
    updateLink()
    byId('iw-close-warning').hidden = true
  })
  const dateStart = input('starts_on') as HTMLInputElement
  dateStart.addEventListener('change', () => {
    const end = input('ends_on')
    if (!selected && end.value < dateStart.value) end.value = dateStart.value
  })
  byId('iw-new').addEventListener('click', () => openEditor(null))
  byId('iw-close').addEventListener('click', requestClose)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    requestClose()
  })
  byId('iw-keep-editing').addEventListener('click', () => {
    byId('iw-close-warning').hidden = true
    input('title').focus()
  })
  byId('iw-discard').addEventListener('click', () => {
    if (!saving && !commenting && !comparing) closeEditor()
  })
  byId('iw-compare').addEventListener('click', () => void compareVersions())
  mergeButton.addEventListener('click', applyMerge)
  byId('iw-comments-refresh').addEventListener('click', () => void loadComments())
  byId('iw-prev').addEventListener('click', () => stepMonth(-1))
  byId('iw-next').addEventListener('click', () => stepMonth(1))
  byId('iw-today').addEventListener('click', () => changeMonth(localDate().slice(0, 7)))
  monthInput.value = month
  monthInput.addEventListener('change', () => changeMonth(monthInput.value))
  filters.forEach((filter) => filter.addEventListener('change', render))
  byId('iw-reset').addEventListener('click', resetFilters)
  byId('iw-refresh').addEventListener('click', () => void loadCalendar())
  root.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((control) =>
    control.addEventListener('click', () => {
      const next = control.dataset.kind as Kind
      if (next === kind) return
      kind = next
      filters.forEach((filter) => {
        filter.value = ''
      })
      root
        .querySelectorAll('[data-kind]')
        .forEach((element) => element.setAttribute('aria-pressed', String(element === control)))
      byId('iw-kind-help').textContent =
        kind === 'editorial'
          ? 'Les publications sur les réseaux restent manuelles.'
          : 'Déclarez vos activités et vos heures. La validation revient aux responsables.'
      feedback(byId('iw-notice'), '')
      void loadCalendar()
    }),
  )
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((control) =>
    control.addEventListener('click', () => {
      view = control.dataset.view as 'month' | 'list'
      root
        .querySelectorAll('[data-view]')
        .forEach((element) => element.setAttribute('aria-pressed', String(element === control)))
      render()
    }),
  )
  window.addEventListener('beforeunload', (event) => {
    if (isDirty() || saving || commenting) {
      event.preventDefault()
    }
  })
  void loadCalendar()
}

function initResources() {
  let resources: Resource[] | null = null
  let controller: AbortController | null = null
  const search = byId<HTMLInputElement>('iw-resource-search')
  const category = byId<HTMLSelectElement>('iw-resource-category')
  const grid = byId('iw-resource-grid')
  const state = byId('iw-resource-state')
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('fr')
      .trim()
  function render() {
    if (!resources) return
    const terms = normalize(search.value).split(/\s+/).filter(Boolean)
    const visible = resources.filter(
      (resource) =>
        (!category.value || (resource.category || 'Sans catégorie') === category.value) &&
        terms.every((term) =>
          normalize(`${resource.title} ${resource.description} ${resource.category}`).includes(
            term,
          ),
        ),
    )
    byId('iw-resource-count').textContent =
      `${visible.length} ressource${visible.length > 1 ? 's' : ''}${visible.length !== resources.length ? ` sur ${resources.length}` : ''}`
    grid.replaceChildren()
    grid.hidden = !visible.length
    state.hidden = !!visible.length
    if (!visible.length) {
      const filtered = !!search.value.trim() || !!category.value
      setState(
        state,
        filtered ? 'Aucune ressource ne correspond' : 'Le catalogue se prépare',
        filtered
          ? 'Essayez un autre mot-clé ou une autre catégorie.'
          : 'Aucune ressource n’est encore disponible pour votre compte. Les documents apparaîtront ici lorsqu’ils seront partagés par l’équipe.',
      )
      if (filtered) state.append(button('Effacer les filtres', reset))
      return
    }
    visible.forEach((resource) => {
      const article = node('article', 'iw-resource')
      const category = node('div', 'iw-resource__category')
      category.append(
        node('span', 'iw-badge', resource.category || 'Sans catégorie'),
        node('span', 'iw-muted', '↗'),
      )
      category.lastElementChild?.setAttribute('aria-hidden', 'true')
      article.append(
        category,
        node('h2', '', resource.title),
        node(
          'p',
          'iw-resource__description',
          resource.description || 'Description non renseignée.',
        ),
      )
      const footer = node('div', 'iw-resource__footer')
      const url = safeUrl(resource.url)
      if (url) {
        const link = node('a', 'iw-button', 'Ouvrir la ressource')
        link.href = url.href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.setAttribute('aria-label', `Ouvrir ${resource.title} (nouvel onglet)`)
        footer.append(node('span', 'iw-resource__host', url.hostname), link)
      } else
        footer.append(
          node(
            'p',
            'iw-muted',
            'Lien indisponible. Contactez l’équipe pour accéder à ce document.',
          ),
        )
      article.append(footer)
      grid.append(article)
    })
  }
  function reset() {
    search.value = ''
    category.value = ''
    render()
  }
  async function load() {
    controller?.abort()
    const request = new AbortController()
    controller = request
    resources = null
    grid.hidden = true
    grid.setAttribute('aria-busy', 'true')
    byId('iw-resource-count').textContent = 'Chargement des ressources…'
    byId('iw-resource-updated').textContent = ''
    byId<HTMLButtonElement>('iw-resource-refresh').disabled = true
    setState(
      state,
      'Chargement des ressources',
      'Nous récupérons les documents disponibles pour votre compte.',
      undefined,
      true,
    )
    try {
      const response = await api<{ resources: Resource[] }>('/api/interne/ressources', {
        signal: request.signal,
      })
      if (request.signal.aborted) return
      if (
        !Array.isArray(response.resources) ||
        response.resources.some(
          (resource) =>
            !resource ||
            ['id', 'title', 'category', 'description', 'url'].some(
              (key) => typeof resource[key as keyof Resource] !== 'string',
            ),
        )
      )
        throw new ApiError(502, 'La réponse du catalogue est incomplète. Réessayez.')
      resources = response.resources
        .slice()
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category, 'fr') || a.title.localeCompare(b.title, 'fr'),
        )
      const selected = category.value
      const values = [
        ...new Set(resources.map((resource) => resource.category || 'Sans catégorie')),
      ].sort((a, b) => a.localeCompare(b, 'fr'))
      if (selected && !values.includes(selected)) values.push(selected)
      category.replaceChildren(new Option('Toutes les catégories', ''))
      values.forEach((value) => category.add(new Option(value, value)))
      category.value = selected
      updated(byId('iw-resource-updated'))
      render()
    } catch (error) {
      if (request.signal.aborted) return
      byId('iw-resource-count').textContent = 'Catalogue indisponible'
      setState(
        state,
        'Les ressources n’ont pas pu être chargées',
        errorText(error),
        () => void load(),
      )
    } finally {
      if (!request.signal.aborted) {
        grid.setAttribute('aria-busy', 'false')
        byId<HTMLButtonElement>('iw-resource-refresh').disabled = false
      }
    }
  }
  search.addEventListener('input', render)
  category.addEventListener('change', render)
  byId('iw-resource-reset').addEventListener('click', reset)
  byId('iw-resource-refresh').addEventListener('click', () => void load())
  void load()
}
function initResourceForm(form: HTMLFormElement) {
  const controls = byId<HTMLFieldSetElement>('iw-resource-fields')
  const submit = byId<HTMLButtonElement>('iw-resource-save')
  const another = byId<HTMLButtonElement>('iw-resource-another')
  const status = byId('iw-resource-save-feedback')
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement
  const read = () => ({
    title: field('title').value.trim(),
    category: field('category').value.trim(),
    description: field('description').value.trim(),
    url: field('url').value.trim(),
  })
  let requestId = crypto.randomUUID()
  let pending: ReturnType<typeof read> | null = null
  let busy = false
  let confirmed = false
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || confirmed || !form.reportValidity()) return
    const resource = pending ?? read()
    if (!resource.title || !resource.category) {
      feedback(status, 'Renseignez le titre et la catégorie.', true)
      return
    }
    if (!safeUrl(resource.url)) {
      feedback(status, 'Utilisez un lien HTTPS sans identifiant ni mot de passe.', true)
      field('url').focus()
      return
    }
    busy = true
    controls.disabled = true
    submit.disabled = true
    submit.textContent = 'Ajout en cours…'
    feedback(status, '')
    try {
      const result = await api<{ id: string }>('/api/interne/catalogue', {
        method: 'POST',
        body: JSON.stringify({ ...resource, requestId }),
      })
      if (typeof result.id !== 'string' || !result.id)
        throw new ApiError(502, 'L’ajout n’a pas pu être confirmé.')
      confirmed = true
      pending = null
      feedback(
        status,
        'Ressource ajoutée au catalogue. Elle est accessible depuis la bibliothèque des formateurs.',
      )
      submit.hidden = true
      another.hidden = false
      another.focus()
    } catch (error) {
      // An ambiguous response must be retried with the exact payload and UUID.
      // This prevents a changed retry from turning into a second resource.
      const uncertain = !(error instanceof ApiError) || error.status >= 500 || error.status === 409
      pending = uncertain ? resource : null
      feedback(
        status,
        `${errorText(error)} ${uncertain ? 'Votre saisie est conservée. Réessayez pour confirmer cet ajout avant de la modifier.' : 'Votre saisie est conservée ; vous pouvez la corriger.'}`,
        true,
      )
    } finally {
      busy = false
      controls.disabled = confirmed || pending !== null
      submit.disabled = false
      submit.textContent = pending ? 'Réessayer et confirmer l’ajout' : 'Ajouter au catalogue'
    }
  })
  another.addEventListener('click', () => {
    form.reset()
    requestId = crypto.randomUUID()
    pending = null
    confirmed = false
    controls.disabled = false
    submit.hidden = false
    another.hidden = true
    feedback(status, '')
    field('title').focus()
  })
  window.addEventListener('beforeunload', (event) => {
    if (busy || (!confirmed && Object.values(read()).some(Boolean))) event.preventDefault()
  })
}
const calendar = byId('iw-calendar')
if (calendar) initCalendar(calendar)
if (byId('iw-resources')) initResources()

const resourceForm = byId<HTMLFormElement>('iw-resource-form')
if (resourceForm) initResourceForm(resourceForm)
