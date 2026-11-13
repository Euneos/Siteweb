import { topicClass } from '../lib/topic-tags'
import {
  currentWatchWeek,
  watchSources,
  watchFormats,
  watchFormat,
  watchUsages,
  watchStatuses,
  watchUsed,
  type WatchItem,
  type WatchUsage,
} from '../lib/thematic-watch'
const root = document.querySelector('#thematic-watch')
if (root) {
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const e = document.createElement(tag)
    e.className = cls
    e.textContent = text
    return e
  }
  const button = (text: string, fn: () => void, cls = 'iw-button') => {
    const b = el('button', cls, text)
    b.type = 'button'
    b.onclick = fn
    return b
  }
  let items: WatchItem[] = [],
    runs: any[] = [],
    selectedWeek = 'all',
    busy = false,
    editing: WatchItem | null = null,
    usages: WatchUsage[] = []
  const filters: Record<string, string> = {
    themes: '',
    usages: '',
    provenance: '',
    source_type: '',
    status: '',
  }
  const feedback = $('#vw-feedback'),
    editor = $<HTMLDialogElement>('#vw-editor'),
    form = $<HTMLFormElement>('#vw-form')
  const week = $<HTMLSelectElement>('#vw-week')
  async function api(method = 'GET', body?: unknown) {
    const r = await fetch('/api/interne/veille', {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await r
      .json()
      .catch(() => ({ error: 'Réponse indisponible. Conservez votre saisie.' }))
    if (!r.ok)
      throw new Error(data.error || 'Opération non confirmée. Actualisez avant de réessayer.')
    return data
  }
  async function load() {
    const data = await api()
    items = data.items
    runs = data.runs
    const weeks = [...new Set([currentWatchWeek(), ...items.map((i) => i.week)])].sort().reverse()
    week.replaceChildren(
      Object.assign(el('option', '', 'Toutes les semaines'), { value: 'all' }),
      ...weeks.map((w) => {
        const o = el('option', '', date(w))
        o.value = w
        return o
      }),
    )
    week.value = selectedWeek
    render()
    $('#vw-add').removeAttribute('disabled')
  }
  const date = (d: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(d))
  const tag = (s: string, cls = '') => el('span', 'vw-tag ' + cls, s)
  function render() {
    const inWeek = items.filter((i) => selectedWeek === 'all' || i.week === selectedWeek)
    $('#vw-week-label').textContent =
      selectedWeek === 'all'
        ? ''
        : 'Semaine du ' + date(selectedWeek)
    $('#vw-summary').textContent =
      `${inWeek.length} sujet${inWeek.length > 1 ? 's' : ''} · ${inWeek.filter((i) => !watchUsed(i)).length} à traiter · les décisions restent à l’équipe.`
    const q = $<HTMLInputElement>('#vw-search').value.trim().toLocaleLowerCase('fr')
    const visible = inWeek.filter(
      (i) =>
        (!q ||
          [i.title, i.summary, i.for_euneos, i.source]
            .join(' ')
            .toLocaleLowerCase('fr')
            .includes(q)) &&
        (!filters.themes || i.themes.includes(filters.themes)) &&
        (!filters.usages || i.usages.some((u) => u.name === filters.usages)) &&
        (!filters.provenance || i.provenance === filters.provenance) &&
        (!filters.source_type || i.source_type === filters.source_type) &&
        (!filters.status ||
          i.usages.some(
            (u) => u.status === filters.status && (!filters.usages || u.name === filters.usages),
          )),
    )
    $('#vw-todo').replaceChildren(...visible.map((i, n) => card(i, n + 1)))
    $('#vw-todo-count').textContent = String(visible.length)
    if (!visible.length) $('#vw-todo').append(el('p', 'vw-empty', 'Aucun sujet avec ces filtres.'))

  }
  function card(item: WatchItem, n: number) {
    const article = el('article', 'vw-card' + (watchUsed(item) ? ' vw-card--used' : ''))
    article.dataset.id = item.id
    const number = el('span', 'vw-number', String(n)),
      body = el('div', 'vw-card-body'),
      head = el('div', 'vw-card-head'),
      title = el('h3', '', item.title),
      actions = el('div', 'vw-card-actions')
    actions.append(
      button('Modifier', () => openEditor(item)),
      button('Supprimer', () => void remove(item)),
    )
    head.append(title, actions)
    body.append(head)
    const tags = el('div', 'vw-tags')
    tags.append(
      ...item.themes.map((t) => {
        const chip = tag(t, topicClass(t))
        chip.dataset.topic = t
        return chip
      }),
      tag(watchFormat(item)),
      tag(item.source_type),
      tag(
        item.provenance === 'ajout manuel'
          ? item.legacy
            ? 'ajout manuel'
            : `ajout manuel · ${item.author}`
          : `via ${item.provenance}`,
        'vw-tag--origin',
      ),
    )
    if (item.needs_primary && !item.legacy) tags.append(tag('à sourcer', 'vw-tag--needs-source'))
    body.append(tags)
    if (
      item.summary &&
      item.summary !==
        'Ressource reprise du tableau de l’équipe. Contenu à relire avant de rédiger un résumé.'
    )
      body.append(el('p', 'vw-summary', item.summary))
    const purpose = el('p', 'vw-purpose')
    purpose.append(
      el('strong', '', 'Pertinence pour Euneos : '),
      document.createTextNode(item.for_euneos),
    )
    if (item.for_euneos && item.for_euneos !== 'À préciser après relecture de la ressource.')
      body.append(purpose)
    const source = el('p', 'vw-source'),
      a = el('a', '', item.source + ' · Lire la source ↗')
    a.href = item.link
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    source.append(
      a,
      document.createTextNode(
        ' · ' +
          (item.published_on
            ? date(item.published_on)
            : item.publication_label || 'Date non indiquée'),
      ),
    )
    body.append(source)
    const row = el('div', 'vw-usages')
    row.append(el('strong', 'vw-usages-label', 'USAGES'))
    for (const usage of item.usages) {
      const b = button(usage.name + ' · ' + usage.status, () => void cycle(item, usage), 'vw-usage')
      b.dataset.status = usage.status
      b.disabled = busy
      b.setAttribute(
        'aria-label',
        usage.name +
          ' : ' +
          usage.status +
          '. Passer à ' +
          watchStatuses[(watchStatuses.indexOf(usage.status as any) + 1) % 4],
      )
      row.append(b)
    }
    row.append(button('+ usage', () => openEditor(item), 'vw-usage vw-usage--add'))
    body.append(row)
    if (item.usages.some((u) => u.draft)) {
      const details = el('details', 'vw-drafts')
      details.append(el('summary', '', 'Brouillons de travail'))
      for (const u of item.usages.filter((u) => u.draft)) {
        details.append(el('h4', '', u.name), el('p', '', u.draft))
      }
      body.append(details)
    }
    article.append(number, body)
    return article
  }
  function clearStatusFilter() {
    if (!filters.status) return
    filters.status = ''
    for (const b of root!.querySelectorAll<HTMLButtonElement>('[data-filter="status"]'))
      b.setAttribute('aria-pressed', String(b.dataset.value === ''))
  }
  async function cycle(item: WatchItem, u: WatchUsage) {
    if (busy) return
    busy = true
    render()
    feedback.textContent = 'Enregistrement du statut…'
    try {
      await api('PATCH', {
        id: item.id,
        version: item.version,
        item: {
          ...item,
          usages: item.usages.map((v) =>
            v.name === u.name
              ? { ...v, status: watchStatuses[(watchStatuses.indexOf(v.status as any) + 1) % 4] }
              : v,
          ),
        },
      })
      clearStatusFilter()
      await load()
      feedback.textContent = 'Statut enregistré. La fiche reste dans la liste.'
    } catch (e) {
      feedback.textContent = (e as Error).message
    } finally {
      busy = false
      render()
    }
  }
  async function remove(item: WatchItem) {
    if (
      busy ||
      !confirm(
        `Supprimer « ${item.title} » ? Ce sujet ne sera plus proposé par la recherche. Un événement déjà ajouté à l’agenda reste dans l’agenda.`,
      )
    )
      return
    busy = true
    try {
      await api('DELETE', { id: item.id, version: item.version, confirmed: true })
      await load()
      feedback.textContent = 'Fiche supprimée. Elle ne sera plus proposée.'
    } catch (e) {
      feedback.textContent = (e as Error).message
    } finally {
      busy = false
      render()
    }
  }
  const fields = [
    ['title', 'Titre', 'text', 300],
    ['link', 'Lien de la source', 'url', 2000],
    ['source', 'Nom de la source', 'text', 200],
    ['published_on', 'Date de parution (si connue)', 'date', 10],
    ['week', 'Semaine (lundi)', 'date', 10],
    ['summary', 'Résumé · 2 phrases maximum', 'textarea', 1200],
    ['for_euneos', 'Pertinence pour Euneos · 1 ou 2 phrases', 'textarea', 1600],
  ] as const
  function field(
    target: HTMLElement,
    key: string,
    label: string,
    type: string,
    max: number,
    value: string,
    required = false,
  ) {
    const l = el('label', 'iw-field', label),
      input = type === 'textarea' ? el('textarea') : el('input')
    input.name = key
    input.value = value
    input.maxLength = max
    input.required = required
    if (input instanceof HTMLInputElement) input.type = type
    else input.rows = 3
    l.append(input)
    target.append(l)
  }
  function openEditor(item: WatchItem | null = null) {
    if (busy) return
    editing = item
    usages = structuredClone(item?.usages ?? [])
    $('#vw-save-feedback').textContent = ''
    $('#vw-editor-title').textContent = item ? 'Modifier la fiche' : 'Ajouter une fiche'
    const visibleItem = item
      ? {
          ...item,
          summary:
            item.summary ===
            'Ressource reprise du tableau de l’équipe. Contenu à relire avant de rédiger un résumé.'
              ? ''
              : item.summary,
          for_euneos:
            item.for_euneos === 'À préciser après relecture de la ressource.'
              ? ''
              : item.for_euneos,
        }
      : null
    const target = $('#vw-fields')
    target.replaceChildren()
    for (const [key, label, type, max] of fields)
      field(
        target,
        key,
        label,
        type,
        max,
        String(
          visibleItem?.[key] ??
            (key === 'week' ? (selectedWeek === 'all' ? currentWatchWeek() : selectedWeek) : ''),
        ),
        ['title', 'link', 'source', 'week'].includes(key),
      )
    const formatLabel = el('label', 'iw-field', 'Format de la ressource'),
      formatSelect = el('select')
    formatSelect.name = 'format'
    formatSelect.append(...watchFormats.map((v) => el('option', '', v)))
    formatSelect.value = item ? watchFormat(item) : 'Article'
    formatLabel.append(formatSelect)
    target.append(formatLabel)
    const l = el('label', 'iw-field', 'Type de source'),
      s = el('select')
    s.name = 'source_type'
    s.append(...watchSources.map((v) => el('option', '', v)))
    s.value = item?.source_type ?? 'acteur du secteur'
    l.append(s)
    target.append(l)
    for (const c of form.querySelectorAll<HTMLInputElement>('[name=theme]'))
      c.checked = item?.themes.includes(c.value) ?? false
    renderUsages()
    editor.showModal()
    editor.scrollTop = 0

  }
  function renderUsages() {
    const target = $('#vw-form-usages')
    target.replaceChildren()
    for (const [index, u] of usages.entries()) {
      const row = el('div', 'vw-usage-editor'),
        s = el('select')
      s.setAttribute('aria-label', 'Statut · ' + u.name)
      s.append(...watchStatuses.map((v) => el('option', '', v)))
      s.value = u.status
      s.onchange = () => (u.status = s.value)
      const label = el('label', 'iw-field', 'Brouillon · ' + u.name),
        draft = el('textarea')
      draft.value = u.draft
      draft.maxLength = 6000
      draft.oninput = () => (u.draft = draft.value)
      label.append(draft)
      row.append(
        el('strong', '', u.name),
        s,
        button('Retirer cet usage', () => {
          usages.splice(index, 1)
          renderUsages()
        }),
        label,
      )
      target.append(row)
    }
    for (const o of $<HTMLSelectElement>('#vw-usage-add').options)
      o.disabled = usages.some((u) => u.name === o.value)

  }
  $<HTMLSelectElement>('#vw-usage-add').onchange = (e) => {
    const s = e.target as HTMLSelectElement
    if (s.value && !usages.some((u) => u.name === s.value)) {
      usages.push({ name: s.value, status: 'à faire', draft: '' })
      renderUsages()
    }
    s.value = ''
  }
  form.onsubmit = async (e) => {
    e.preventDefault()
    if (busy) return
    busy = true
    const save = $<HTMLButtonElement>('#vw-save')
    save.disabled = true
    const values = Object.fromEntries(new FormData(form).entries()) as Record<string, any>,
      themes = Array.from(
        form.querySelectorAll<HTMLInputElement>('[name=theme]:checked'),
        (c) => c.value,
      )
    try {
      await api(editing ? 'PATCH' : 'POST', {
        id: editing?.id,
        version: editing?.version,
        item: {
          ...editing,
          ...values,
          themes,
          usages,
          event: editing?.event ?? null,
          needs_primary: editing?.needs_primary ?? false,
        },
      })
      selectedWeek = values.week
      if (watchUsed({ usages })) clearStatusFilter()
      await load()
      editor.close()
      feedback.textContent = 'Brouillon enregistré.'
    } catch (e) {
      $('#vw-save-feedback').textContent = (e as Error).message
    } finally {
      busy = false
      save.disabled = false
      render()
    }
  }
  $('#vw-close').onclick = () => {
    if (!busy) editor.close()
  }
  editor.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault()
  })
  $('#vw-add').onclick = () => openEditor()
  week.onchange = () => {
    selectedWeek = week.value
    render()
  }
  $('#vw-search').oninput = render
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-filter]'))
    b.onclick = () => {
      filters[b.dataset.filter!] = b.dataset.value!
      for (const peer of root.querySelectorAll<HTMLButtonElement>(
        `[data-filter="${b.dataset.filter}"]`,
      ))
        peer.setAttribute('aria-pressed', String(peer === b))
      render()
    }
  $('#vw-reset').onclick = () => {
    for (const k of Object.keys(filters)) filters[k] = ''
    $<HTMLInputElement>('#vw-search').value = ''
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-filter]'))
      b.setAttribute('aria-pressed', String(!b.dataset.value))
    render()
  }
  const research = $<HTMLDialogElement>('#vw-research-dialog')
  $('#vw-research').onclick = () => research.showModal()
  $('#vw-research-close').onclick = () => research.close()
  $('#vw-copy-prompt').onclick = async () => {
    try {
      await navigator.clipboard.writeText($<HTMLTextAreaElement>('#vw-research-prompt').value)
      $('#vw-copy-feedback').textContent =
        'Demande copiée. Envoyez-la à l’agent pour lancer la recherche.'
    } catch {
      $('#vw-copy-feedback').textContent = 'Sélectionnez et copiez le texte ci-dessus.'
    }
  }
  void load()
    .then(() => (feedback.textContent = ''))
    .catch((e) => (feedback.textContent = (e as Error).message))
}
