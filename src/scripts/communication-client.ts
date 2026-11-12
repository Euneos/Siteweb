import { renderMediaDashboard } from './media-dashboard'
import { categoricalColumns, splitChoices, choiceScope } from '../lib/communication-choices'
import type { ChoiceCatalog, CommunicationChoice } from '../lib/communication-choices'
import type { CommunicationRow, CommunicationSheet } from '../lib/communication'
const root = document.getElementById('communication-table')
if (root) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const search = get<HTMLInputElement>('com-search')
  const activeFilters = new Map<string, string>()
  let catalog: ChoiceCatalog = { choices: [], aliases: [] },
    deletedRows: CommunicationRow[] = [],
    trash = false,
    choiceSaving = false,
    bulkSaving = false,
    currentVisible: CommunicationRow[] = []
  const selection = new Map<string, number>()
  let activeSheetId = ''
  const currentSheet = () => sheets.find((s) => s.id === activeSheetId)
  function renderViews() {
    const tabs = get('com-views')
    tabs.replaceChildren()
    tabs.hidden = sheets.length < 2
    sheets.forEach((sheet, index) => {
      const tab = button(sheet.title, () => {
        activeSheetId = sheet.id
        activeFilters.clear()
        selection.clear()
        sort = -1
        renderViews()
        changeSheet()
      })
      tab.id = `com-tab-${index}`
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(sheet.id === activeSheetId))
      tab.setAttribute('aria-controls', 'com-content')
      tab.tabIndex = sheet.id === activeSheetId ? 0 : -1
      tab.addEventListener('keydown', (e) => {
        let next = index
        if (e.key === 'ArrowRight') next = (index + 1) % sheets.length
        else if (e.key === 'ArrowLeft') next = (index + sheets.length - 1) % sheets.length
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = sheets.length - 1
        else return
        e.preventDefault()
        activeSheetId = sheets[next].id
        activeFilters.clear()
        selection.clear()
        renderViews()
        changeSheet()
        get(`com-tab-${next}`).focus()
      })
      tabs.append(tab)
    })
    if (sheets.length > 1) {
      content.setAttribute('role', 'tabpanel')
      content.setAttribute(
        'aria-labelledby',
        `com-tab-${sheets.findIndex((s) => s.id === activeSheetId)}`,
      )
    }
  }
  const content = get('com-content'),
    feedback = get('com-feedback'),
    dialog = get<HTMLDialogElement>('com-editor'),
    form = get<HTMLFormElement>('com-form'),
    fields = get('com-fields'),
    save = get<HTMLButtonElement>('com-save'),
    saveFeedback = get('com-save-feedback'),
    add = get<HTMLButtonElement>('com-new')
  const endpoint = `/api/interne/communication/${root.dataset.table}`
  let sheets: CommunicationSheet[] = [],
    rows: CommunicationRow[] = [],
    sort = -1,
    ascending = true,
    editing: CommunicationRow | null = null,
    dirty = false,
    saving = false,
    loading = false
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const n = document.createElement(tag)
    n.textContent = text
    return n
  }
  const option = (label: string, v: string) => {
    const n = el('option', label)
    n.value = v
    return n
  }
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('fr')
  const button = (label: string, action: () => void) => {
    const b = el('button', label)
    b.type = 'button'
    b.className = 'iw-button'
    b.addEventListener('click', action)
    return b
  }
  async function request(init?: RequestInit) {
    const response = await fetch(endpoint, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    })
    let data: any
    try {
      data = await response.json()
    } catch {
      throw new Error('Le tableau est indisponible. Rechargez la page après reconnexion.')
    }
    if (!response.ok) throw new Error(data.error ?? 'Le tableau est indisponible.')
    return data
  }
  const allowedFilters: Record<string, string[]> = {
    suivimedias: ['Type de média', 'Nom média', 'Public principal', 'Statut', 'Attribution'],
    partenariats: ['Priorité', 'Vivier', 'Statut'],
    veille: ['Nom', 'Type', 'Tags'],
  }
  const categorical = categoricalColumns
  const split = splitChoices
  function choiceRecords(label: string) {
    return catalog.choices.filter(
      (c) =>
        c.scope === choiceScope(root!.dataset.table!, label) &&
        c.column_name === label &&
        !c.deleted_at,
    )
  }
  const choices = (label: string) => choiceRecords(label).map((c) => c.value)
  const role = (label: string, value: string) =>
    choiceRecords(label).find((c) => c.value === value)?.role ?? ''
  const readFields = () =>
    [...fields.querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>('[data-cell]')].map((t) =>
      t instanceof HTMLSelectElement && t.multiple
        ? [...t.selectedOptions].map((o) => o.value).join(', ')
        : t.value.trim(),
    )
  function choiceControl(select: HTMLSelectElement, label: string) {
    select.hidden = true
    const details = el('details')
    details.className = 'com-choice'
    details.dataset.column = label
    const summary = el('summary')
    summary.id = select.id + '-trigger'
    const menu = el('div')
    menu.className = 'com-choice__menu'
    menu.setAttribute('role', 'group')
    menu.setAttribute('aria-label', `Valeurs de ${label}`)
    const sync = () => {
      summary.textContent =
        [...select.selectedOptions].map((o) => o.text).join(', ') || 'Non renseigné'
      summary.setAttribute('aria-label', `${label} : ${summary.textContent}`)
      menu
        .querySelectorAll<HTMLButtonElement>('[data-option]')
        .forEach((b) =>
          b.setAttribute(
            'aria-pressed',
            String([...select.selectedOptions].some((o) => o.value === b.dataset.option)),
          ),
        )
    }
    for (const o of select.options) {
      const row = el('div')
      row.className = 'com-choice__row'
      const choose = button(o.text, () => {
        if (select.multiple) o.selected = !o.selected
        else {
          select.value = o.value
          details.open = false
        }
        select.dispatchEvent(new Event('change', { bubbles: true }))
        sync()
      })
      choose.dataset.option = o.value
      choose.className = 'com-choice__value'
      row.append(choose)
      const record = choiceRecords(label).find((c) => c.value === o.value)
      if (record) {
        const editor = el('div')
        editor.className = 'com-choice__edit'
        editor.hidden = true
        const name = el('input')
        name.type = 'text'
        name.maxLength = 160
        name.value = record.value
        name.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void changeChoice(label, 'rename', record, name.value)
          }
        })
        name.setAttribute('aria-label', `Nouveau nom de ${record.value}`)
        const rename = button('✎', () => {
          editor.replaceChildren(
            name,
            button(
              'Enregistrer le nom',
              () => void changeChoice(label, 'rename', record, name.value),
            ),
            button('Annuler', () => (editor.hidden = true)),
          )
          editor.hidden = false
          name.focus()
        })
        rename.setAttribute('aria-label', `Renommer ${record.value}`)
        const remove = button('×', () => {
          editor.replaceChildren(
            el(
              'p',
              'Retirer cette valeur des menus ? Les fiches sont conservées. Vous pourrez rétablir la valeur en l’ajoutant de nouveau.',
            ),
            button('Confirmer la suppression', () => void changeChoice(label, 'delete', record)),
            button('Annuler', () => (editor.hidden = true)),
          )
          editor.hidden = false
        })
        remove.setAttribute('aria-label', `Supprimer ${record.value}`)
        row.append(rename, remove)
        menu.append(row, editor)
      } else menu.append(row)
    }
    const addRow = el('div')
    addRow.className = 'com-choice__add'
    const name = el('input')
    name.type = 'text'
    name.maxLength = 160
    name.placeholder = 'Nouvelle valeur'
    name.setAttribute('aria-label', `Ajouter une valeur à ${label}`)
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void changeChoice(label, 'add', undefined, name.value)
      }
    })
    addRow.append(
      name,
      button('Ajouter', () => void changeChoice(label, 'add', undefined, name.value)),
    )
    menu.append(addRow)
    details.append(summary, menu)
    select.addEventListener('change', sync)
    details.addEventListener('toggle', () => {
      if (details.open)
        document.querySelectorAll<HTMLDetailsElement>('.com-choice[open]').forEach((other) => {
          if (other !== details) other.open = false
        })
    })
    sync()
    return details
  }
  async function changeChoice(
    label: string,
    action: string,
    record?: CommunicationChoice,
    newValue = '',
  ) {
    if (choiceSaving || saving || bulkSaving) return
    if (action !== 'delete' && !newValue.trim()) return
    const draft = dialog.open ? readFields() : null,
      selected = editing ? sheets.find((s) => s.id === editing!.sheet_id) : undefined
    choiceSaving = true
    save.disabled = true
    get<HTMLButtonElement>('com-refresh').disabled = true
    get<HTMLButtonElement>('com-trash').disabled = true
    document
      .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        '.com-choice button,.com-choice input',
      )
      .forEach((c) => (c.disabled = true))
    const message = dialog.open ? saveFeedback : feedback
    message.textContent = 'Enregistrement du menu…'
    try {
      const result = await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choiceAction: action,
          column: label,
          choiceId: record?.id,
          version: record?.version,
          value: newValue,
        }),
      })
      const old = record?.value ?? '',
        next = action === 'delete' ? '' : newValue.trim()
      if (activeFilters.get(label) === old) activeFilters.set(label, next)
      if (!(await load()))
        throw new Error(
          'La valeur est enregistrée, mais le tableau n’a pas pu être actualisé. Rechargez avant de poursuivre.',
        )
      if (draft && selected) {
        draft.splice(0, draft.length, ...readFields())
        const index = selected.columns.indexOf(label)
        if (index >= 0) {
          const values = split(label, draft[index])
          draft[index] = (
            action === 'add'
              ? label === 'Tags'
                ? [
                    ...new Set([
                      ...values,
                      choiceRecords(label).find((c) => c.id === result.id)?.value ?? next,
                    ]),
                  ]
                : [choiceRecords(label).find((c) => c.id === result.id)?.value ?? next]
              : values.flatMap((v) => (v === old ? (next ? [next] : []) : [v]))
          ).join(label === 'Tags' ? ', ' : '')
        }
        buildFields(selected, draft)
        dirty = true
        const menu = fields.querySelector<HTMLDetailsElement>(`.com-choice[data-column="${label}"]`)
        if (menu) menu.open = true
      }
      message.textContent =
        action === 'delete'
          ? 'Valeur retirée des menus. Les fiches sont conservées.'
          : action === 'rename'
            ? 'Valeur renommée dans toutes les fiches.'
            : 'Valeur ajoutée au menu.'
    } catch (error) {
      message.textContent =
        error instanceof Error ? error.message : 'Modification du menu non confirmée.'
    } finally {
      choiceSaving = false
      save.disabled = false
      get<HTMLButtonElement>('com-refresh').disabled = false
      get<HTMLButtonElement>('com-trash').disabled = false
      document
        .querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          '.com-choice button,.com-choice input',
        )
        .forEach((c) => (c.disabled = false))
    }
  }
  function updateSelection() {
    const selected = currentVisible.filter((r) => selection.has(r.id))
    get('com-selection').hidden = selected.length === 0
    get('com-selected-count').textContent =
      `${selected.length} ligne${selected.length > 1 ? 's' : ''} sélectionnée${selected.length > 1 ? 's' : ''}`
    content
      .querySelectorAll<HTMLInputElement>('input[data-row]')
      .forEach((c) => (c.checked = selection.has(c.dataset.row!)))
    const all = content.querySelector<HTMLInputElement>('#com-select-all')
    if (all) {
      all.checked = !!currentVisible.length && selected.length === currentVisible.length
      all.indeterminate = selected.length > 0 && selected.length < currentVisible.length
    }
    get<HTMLButtonElement>('com-duplicate').hidden = trash
    get<HTMLButtonElement>('com-delete').hidden = trash
    get<HTMLButtonElement>('com-restore').hidden = !trash
  }
  async function bulk(action: string) {
    if (bulkSaving || choiceSaving || !selection.size) return
    bulkSaving = true
    get<HTMLButtonElement>('com-refresh').disabled = true
    get<HTMLButtonElement>('com-trash').disabled = true
    content
      .querySelectorAll<HTMLInputElement>('input[type=checkbox]')
      .forEach((c) => (c.disabled = true))
    get<HTMLDialogElement>('com-bulk-dialog').close()
    feedback.textContent = 'Enregistrement de la sélection…'
    get('com-selection')
      .querySelectorAll('button')
      .forEach((b) => (b.disabled = true))
    try {
      const result = await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bulkAction: action,
          rows: [...selection].map(([id, version]) => ({ id, version })),
        }),
      })
      selection.clear()
      await load()
      const plural = result.count > 1 ? 's' : ''
      feedback.textContent = `${result.count} ligne${plural} ${action === 'duplicate' ? `dupliquée${plural}` : action === 'delete' ? `placée${plural} dans la corbeille` : `restaurée${plural}`}.`
    } catch (error) {
      feedback.textContent =
        error instanceof Error
          ? error.message
          : 'Action non confirmée. Actualisez avant de réessayer.'
    } finally {
      bulkSaving = false
      get<HTMLButtonElement>('com-refresh').disabled = false
      get<HTMLButtonElement>('com-trash').disabled = false
      content
        .querySelectorAll<HTMLInputElement>('input[type=checkbox]')
        .forEach((c) => (c.disabled = false))
      get('com-selection')
        .querySelectorAll('button')
        .forEach((b) => (b.disabled = false))
    }
  }
  function changeSheet() {
    const container = get('com-filters')
    container.replaceChildren()
    for (const [index, label] of (allowedFilters[root!.dataset.table!] ?? []).entries()) {
      if (!currentSheet()?.columns.includes(label)) continue
      const wrapper = el('div')
      wrapper.className = 'iw-field'
      const caption = el('label', label),
        select = el('select')
      select.id = `com-filter-${index}`
      caption.htmlFor = select.id
      select.dataset.column = label
      select.append(option('Toutes les valeurs', ''))
      const values = [
        ...new Set([
          ...(trash ? deletedRows : rows)
            .filter((r) => r.sheet_id === activeSheetId)
            .flatMap((r) => {
              const i = currentSheet()?.columns.indexOf(label) ?? -1
              return i < 0 ? [] : split(label, r.cells[i] || 'Non renseigné')
            }),
          ...(categorical.includes(label) ? choices(label) : []),
        ]),
      ].sort((a, b) => a.localeCompare(b, 'fr'))
      for (const v of values) select.append(option(v, v))
      const previous = activeFilters.get(label) ?? ''
      select.value = values.includes(previous) ? previous : ''
      activeFilters.set(label, select.value)
      select.addEventListener('change', () => {
        selection.clear()
        activeFilters.set(label, select.value)
        render()
      })
      wrapper.append(caption, select)
      if (categorical.includes(label)) wrapper.append(choiceControl(select, label))
      container.append(wrapper)
    }
    render()
  }
  function render() {
    if (root!.dataset.table === 'suivimedias') renderMediaDashboard(sheets, rows)
    content.replaceChildren()
    currentVisible = []
    add.disabled = trash || !sheets.some((s) => !s.guide)
    let count = 0,
      total = 0
    for (const selected of sheets.filter((s) => s.id === activeSheetId)) {
      const all = (trash ? deletedRows : rows).filter((r) => r.sheet_id === selected.id)
      if (!selected.guide) total += all.length
      const visible = all.filter(
        (r) =>
          (!search.value || norm(r.cells.join(' ')).includes(norm(search.value))) &&
          [...activeFilters].every(
            ([label, v]) =>
              !v ||
              (selected.columns.includes(label) &&
                split(label, r.cells[selected.columns.indexOf(label)] || 'Non renseigné').includes(
                  v,
                )),
          ),
      )
      if (!selected.guide) {
        count += visible.length
        currentVisible = visible
      }
      if (!visible.length) continue
      const section = el('section')
      section.className = 'com-section'
      const heading = el('div')
      heading.className = 'com-section__heading'
      heading.append(el('h2', selected.title))
      if (!selected.guide) heading.append(button('＋ Nouvelle fiche', () => open(null, selected)))

      if (selected.guide) {
        const guide = el('div')
        guide.className = 'com-guide'
        for (const row of visible) {
          const article = el('article')
          article.append(el('h3', row.cells[0]))
          for (const cell of row.cells.slice(1)) if (cell) article.append(el('p', cell))
          guide.append(article)
        }
        section.append(guide)
        content.append(section)
        continue
      }
      const scroll = el('div')
      scroll.className = 'com-scroll'
      scroll.tabIndex = 0
      scroll.setAttribute('role', 'region')
      scroll.setAttribute('aria-label', selected.title)
      const table = el('table')
      table.className = 'com-table'
      const caption = el('caption', selected.title)
      caption.className = 'iw-sr-only'
      table.append(caption)
      const head = el('thead'),
        tr = el('tr')
      const selectTh = el('th'),
        allCheck = el('input')
      allCheck.type = 'checkbox'
      allCheck.id = 'com-select-all'
      allCheck.setAttribute('aria-label', 'Sélectionner toutes les lignes affichées')
      allCheck.addEventListener('change', () => {
        selection.clear()
        if (allCheck.checked) currentVisible.forEach((r) => selection.set(r.id, r.version))
        updateSelection()
      })
      selectTh.append(allCheck)
      tr.append(selectTh, el('th', 'Fiche'))
      selected.columns.forEach((label, i) => {
        const th = el('th')
        th.scope = 'col'
        const b = button(label, () => {
          ascending = sort === i ? !ascending : true
          sort = i
          rows.sort(
            (a, b) =>
              (a.cells[i] ?? '').localeCompare(b.cells[i] ?? '', 'fr', { numeric: true }) *
              (ascending ? 1 : -1),
          )
          render()
        })
        th.append(b)
        tr.append(th)
      })
      head.append(tr)
      table.append(head)
      const body = el('tbody')
      for (const row of visible) {
        const rowName =
          row.cells[selected.columns.indexOf('Nom')] ||
          row.cells[selected.columns.indexOf('Nom média')] ||
          row.cells.find(Boolean) ||
          ''
        const tr = el('tr'),
          action = el('td'),
          b = button('Ouvrir', () => open(row, selected))
        b.setAttribute('aria-label', `Ouvrir la fiche ${rowName}`)
        action.append(b)
        b.disabled = trash
        const selectTd = el('td'),
          check = el('input')
        check.type = 'checkbox'
        check.dataset.row = row.id
        check.setAttribute('aria-label', `Sélectionner la ligne ${rowName}`)
        check.addEventListener('change', () => {
          if (check.checked) selection.set(row.id, row.version)
          else selection.delete(row.id)
          updateSelection()
        })
        selectTd.append(check)
        tr.append(selectTd, action)
        const priority = role('Priorité', row.cells[selected.columns.indexOf('Priorité')] ?? ''),
          type = role('Type', row.cells[selected.columns.indexOf('Type')] ?? '')
        const status = row.cells[selected.columns.indexOf('Statut')] ?? ''
        const statusColor = (
          {
            contact: 'orange',
            waiting: 'attente',
            followup: 'rose',
            cancelled: 'annule',
            accepted: 'vert',
          } as Record<string, string>
        )[role('Statut', status)]
        const color = ['suivimedias', 'partenariats'].includes(root!.dataset.table!)
          ? statusColor
          : root!.dataset.table === 'veille'
            ? (
                {
                  podcast: 'bleu',
                  article: 'vert',
                  articles: 'vert',
                  newsletter: 'orange',
                  film: 'jaune',
                } as Record<string, string>
              )[type]
            : ''
        if (color) tr.className = `com-${color}`
        for (const [index, cell] of row.cells.entries()) {
          const td = el('td')
          if (root!.dataset.table === 'partenariats') {
            if (selected.columns[index] === 'Priorité') {
              td.className = 'com-priority'
              td.dataset.priority = priority ?? ''
            }
          }
          let url: URL | null = null
          try {
            url = new URL(cell.startsWith('www.') ? 'https://' + cell : cell)
            if (!['http:', 'https:'].includes(url.protocol)) url = null
          } catch {}
          if (root!.dataset.table === 'suivimedias' && selected.columns[index] === 'Attribution') {
            const select = el('select')
            select.setAttribute('aria-label', `Attribution de ${rowName}`)
            select.append(
              option('Non attribué', ''),
              ...['Charlotte', 'Candice', 'Pauline'].map((v) => option(v, v)),
            )
            select.value = cell
            select.disabled = trash
            select.addEventListener('change', async () => {
              select.disabled = true
              try {
                const cells = [...row.cells]
                cells[index] = select.value
                await request({
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...row, cells }),
                })
                await load()
              } catch (error) {
                select.value = cell
                feedback.textContent =
                  error instanceof Error ? error.message : 'Attribution non confirmée.'
              } finally {
                select.disabled = trash
              }
            })
            td.append(select)
          } else if (url) {
            const link = el('a', cell)
            link.href = url.href
            link.target = '_blank'
            link.rel = 'noopener noreferrer'
            td.append(link)
          } else td.append(el('p', cell || '—'))
          tr.append(td)
        }
        body.append(tr)
      }
      table.append(body)
      scroll.append(table)
      section.append(scroll)
      content.append(section)
    }
    updateSelection()
    get<HTMLButtonElement>('com-trash').textContent = trash
      ? 'Retour au tableau'
      : `Corbeille (${deletedRows.filter((r) => r.sheet_id === activeSheetId).length})`
    get('com-count').textContent = `${count} / ${total} fiches`
    if (!content.childElementCount)
      content.append(
        el(
          'p',
          sheets.length
            ? 'Aucun résultat pour cette recherche.'
            : 'Les données sources restent à importer.',
        ),
      )
  }
  async function load() {
    if (loading) return false
    loading = true
    content.setAttribute('aria-busy', 'true')
    get<HTMLButtonElement>('com-refresh').disabled = true
    feedback.textContent = 'Chargement du tableau…'
    try {
      const result = await request()
      catalog = { choices: result.choices, aliases: result.aliases }
      deletedRows = result.deletedRows
      selection.clear()
      sheets = result.sheets
        .filter((s: CommunicationSheet) => !s.guide)
        .map((s: CommunicationSheet) => ({
          ...s,
          title: /top\s*10/i.test(s.title) ? 'TOP 10' : s.title,
        }))
      rows = result.rows
      if (!sheets.some((s) => s.id === activeSheetId)) activeSheetId = sheets[0]?.id ?? ''
      renderViews()
      feedback.textContent = sheets.length
        ? 'Les modifications sont partagées avec l’équipe.'
        : 'Le tableau est prêt ; l’import des données sources reste à effectuer.'
      changeSheet()
      return true
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : 'Chargement impossible.'
      add.disabled = true
      return false
    } finally {
      loading = false
      content.setAttribute('aria-busy', 'false')
      get<HTMLButtonElement>('com-refresh').disabled = false
    }
  }
  function open(
    row: CommunicationRow | null,
    selected = row ? sheets.find((s) => s.id === row.sheet_id) : currentSheet(),
  ) {
    if (!selected || selected.guide) return
    editing = row ?? {
      id: crypto.randomUUID(),
      sheet_id: selected.id,
      cells: selected.columns.map(() => ''),
      version: 0,
      updated_by: '',
      updated_at: '',
    }
    dirty = false
    saveFeedback.textContent = ''
    get('com-title').textContent = row ? 'Modifier la fiche' : 'Nouvelle fiche'
    fields.replaceChildren()
    buildFields(selected, editing.cells)
    get('com-audit').textContent = row
      ? `Dernière modification : ${new Date(row.updated_at).toLocaleString('fr-FR')} · ${row.updated_by}`
      : ''
    dialog.showModal()
  }
  function buildFields(selected: CommunicationSheet, cells: string[]) {
    fields.replaceChildren()
    selected.columns.forEach((label, i) => {
      const wrapper = el('div')
      wrapper.className = 'iw-field iw-field--wide'
      const l = el('label', label)
      l.htmlFor = `com-field-${i}`
      const input =
        categorical.includes(label) || label === 'Attribution' ? el('select') : el('textarea')
      input.id = l.htmlFor
      input.name = String(i)
      input.dataset.cell = String(i)
      if (input instanceof HTMLSelectElement) {
        input.multiple = label === 'Tags'
        if (!input.multiple) input.append(option('Non renseigné', ''))
        for (const v of label === 'Attribution'
          ? ['Charlotte', 'Candice', 'Pauline']
          : choices(label)) {
          const o = option(v, v)
          o.selected = split(label, cells[i] ?? '').includes(v)
          input.append(o)
        }
        wrapper.append(l, input)
        if (label !== 'Attribution') wrapper.append(choiceControl(input, label))
      } else {
        input.rows = label === 'Notes' ? 4 : 2
        input.maxLength = 10000
        input.value = cells[i] ?? ''
        wrapper.append(l, input)
      }
      fields.append(wrapper)
    })
  }
  function close() {
    if (saving || choiceSaving) return
    if (dirty && !confirm('Fermer sans enregistrer vos modifications ?')) return
    dialog.close()
    dirty = false
  }
  get('com-close').addEventListener('click', close)
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    close()
  })
  form.addEventListener('input', () => {
    dirty = true
  })
  form.addEventListener('change', () => {
    dirty = true
  })
  window.addEventListener('beforeunload', (e) => {
    if (dirty || choiceSaving || bulkSaving) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (saving || choiceSaving || !editing) return
    const cells = readFields()
    if (!cells.some(Boolean)) {
      saveFeedback.textContent = 'Renseignez au moins un champ.'
      return
    }
    saving = true
    save.disabled = true
    fields
      .querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
      >('textarea,select,input,button')
      .forEach((t) => (t.disabled = true))
    saveFeedback.textContent = 'Enregistrement…'
    try {
      await request({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editing, cells }),
      })
      dirty = false
      dialog.close()
      await load()
      feedback.textContent = 'Fiche enregistrée.'
    } catch (error) {
      saveFeedback.textContent =
        error instanceof Error
          ? error.message
          : 'Enregistrement non confirmé. Votre saisie est conservée.'
    } finally {
      saving = false
      save.disabled = false
      fields
        .querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
        >('textarea,select,input,button')
        .forEach((t) => (t.disabled = false))
    }
  })
  search.addEventListener('input', () => {
    selection.clear()
    render()
  })
  get('com-refresh').addEventListener('click', () => void load())
  add.addEventListener('click', () => open(null))
  setInterval(() => {
    if (
      !dialog.open &&
      !choiceSaving &&
      !bulkSaving &&
      !selection.size &&
      !document.querySelector('.com-choice[open]') &&
      document.visibilityState === 'visible'
    )
      void load()
  }, 60000)
  get('com-clear-selection').addEventListener('click', () => {
    selection.clear()
    updateSelection()
  })
  get('com-duplicate').addEventListener('click', () => void bulk('duplicate'))
  get('com-restore').addEventListener('click', () => void bulk('restore'))
  get('com-delete').addEventListener('click', () => {
    get('com-bulk-description').textContent =
      `Les ${selection.size} lignes sélectionnées de cette vue seront placées dans la corbeille. Vous pourrez les restaurer.`
    get<HTMLDialogElement>('com-bulk-dialog').showModal()
  })
  get('com-bulk-cancel').addEventListener('click', () =>
    get<HTMLDialogElement>('com-bulk-dialog').close(),
  )
  get('com-bulk-confirm').addEventListener('click', () => void bulk('delete'))
  get('com-trash').addEventListener('click', () => {
    trash = !trash
    selection.clear()
    activeFilters.clear()
    changeSheet()
  })
  void load()
}
