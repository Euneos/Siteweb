import type { reviewView, ReviewTarget } from '../lib/google-review'
type Row = Awaited<ReturnType<typeof reviewView>> & {
  operation?: { state: string; audit_json: string } | null
}
const root = document.querySelector<HTMLElement>('#google-review')
if (root) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const feedback = get('gr-feedback'),
    list = get('gr-list'),
    detail = get('gr-detail'),
    form = get<HTMLFormElement>('gr-form')
  const target = get<HTMLSelectElement>('gr-target'),
    reason = get<HTMLTextAreaElement>('gr-reason'),
    confirm = get<HTMLInputElement>('gr-confirm')
  const filter = get<HTMLSelectElement>('gr-state'),
    search = get<HTMLInputElement>('gr-search'),
    refresh = get<HTMLButtonElement>('gr-refresh')
  let rows: Row[] = [],
    targets: ReviewTarget[] = [],
    selected: Row | null = null,
    busy = false
  const labels = {
    integrated: 'Intégration attestée par un reçu',
    partial: 'Intégration partielle',
    pending: 'Intégration en attente',
    unknown: 'Intégration non attestée',
  }
  const summary = (row: Row) =>
    `${labels[row.state]}${row.attachment ? ' · Dossier rattaché manuellement' : ''}${row.operation?.state === 'pending' ? ' · Confirmation à vérifier avant toute nouvelle action' : ''}`
  async function api(body?: unknown) {
    const response = await fetch('/api/interne/reponses-google', {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data)
      throw new Error(
        data?.error ||
          'Le résultat ne peut pas être confirmé. Actualisez avant toute nouvelle tentative.',
      )
    return data
  }
  function renderList() {
    list.replaceChildren()
    const query = search.value.trim().toLocaleLowerCase('fr')
    const visible = rows.filter(
      (row) =>
        (filter.value === 'all' ||
          (filter.value === 'integrated'
            ? row.state === 'integrated'
            : row.state !== 'integrated' || row.operation?.state === 'pending')) &&
        JSON.stringify([row.form, row.answers, row.rawAnswers, row.attachment?.target.label])
          .toLocaleLowerCase('fr')
          .includes(query),
    )
    const count = document.createElement('p')
    count.textContent = `${visible.length} réponse(s) affichée(s) sur ${rows.length}.`
    list.append(count)
    for (const row of visible) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'gr-row'
      const title = document.createElement('strong')
      title.textContent = `${row.form || 'Formulaire non précisé'} · réponse #${row.id}`
      const status = document.createElement('span')
      status.textContent = `${row.submittedAt} · ${summary(row)}`
      button.append(title, status)
      button.addEventListener('click', () => {
        if (!busy) open(row)
      })
      list.append(button)
    }
  }
  function open(row: Row) {
    selected = row
    detail.hidden = false
    get('gr-title').textContent = `Réponse #${row.id} — ${row.form}`
    get('gr-summary').textContent = summary(row)
    const answers = get('gr-answers')
    answers.replaceChildren()
    for (const answer of row.answers.length
      ? row.answers
      : [{ question: 'Réponse source (format original)', answer: row.rawAnswers }]) {
      const dt = document.createElement('dt'),
        dd = document.createElement('dd')
      dt.textContent = answer.question
      dd.textContent = answer.answer || 'Non renseigné'
      answers.append(dt, dd)
    }
    get('gr-history').textContent =
      `Statut historique : ${row.status}\n${row.detail}${row.operation ? `\nRegistre de confirmation (${row.operation.state}) : ${row.operation.audit_json}` : ''}`
    form.reset()
    get('gr-choice').textContent = ''
    target.replaceChildren(new Option('Choisir un dossier exact…', ''))
    for (const t of targets)
      target.add(
        new Option(
          `${t.kind === 'school' ? 'Établissement' : 'Formateur'} · ${t.label}`,
          `${t.kind}:${t.id}`,
        ),
      )
    form.hidden = root!.dataset.admin !== 'true' || !!row.attachment || !!row.operation
    const readonly = get('gr-readonly')
    readonly.hidden = !form.hidden
    readonly.textContent = row.attachment
      ? `Rattachée à : ${row.attachment.target.label}. Les champs métier n’ont pas été modifiés par ce rattachement.`
      : row.operation
        ? 'Une confirmation est déjà enregistrée ou en attente de vérification. Ne renvoyez pas la demande ; faites vérifier ce reçu.'
        : 'Vous pouvez consulter les réponses. La confirmation est réservée aux responsables.'
    get('gr-title').focus()
  }
  target.addEventListener('change', () => {
    confirm.checked = false
    get('gr-choice').textContent = target.value
      ? `Dossier choisi : ${target.selectedOptions[0].textContent}`
      : ''
  })
  async function load() {
    if (busy) return
    busy = true
    refresh.disabled = true
    detail.hidden = true
    selected = null
    rows = []
    list.replaceChildren()
    feedback.textContent = 'Lecture des réponses et des dossiers…'
    try {
      const data = await api()
      rows = data.rows
      targets = data.targets
      renderList()
      feedback.textContent =
        'Réponses actualisées. Les mentions d’intégration proviennent des reçus de reprise.'
    } catch (error) {
      feedback.textContent = (error as Error).message
    } finally {
      busy = false
      refresh.disabled = false
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!selected || busy || !form.reportValidity()) return
    const [kind, id] = target.value.split(':')
    busy = true
    refresh.disabled = true
    const controls = Array.from(
      form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
      >('input,select,textarea,button'),
    )
    const body = {
      id: selected.id,
      version: selected.version,
      targetKind: kind,
      targetId: Number(id),
      reason: reason.value,
      confirmed: confirm.checked,
    }
    controls.forEach((el) => (el.disabled = true))
    feedback.textContent = 'Enregistrement du rattachement…'
    try {
      const result = await api(body)
      rows = rows.map((r) => (r.id === result.row.id ? result.row : r))
      renderList()
      open(result.row)
      feedback.textContent = result.message
    } catch (error) {
      feedback.textContent = (error as Error).message
      form.hidden = true
      get('gr-readonly').hidden = false
      get('gr-readonly').textContent =
        'Le résultat doit être vérifié. Actualisez avant de poursuivre ; votre justification est conservée dans le formulaire.'
    } finally {
      busy = false
      refresh.disabled = false
      controls.forEach((el) => (el.disabled = false))
    }
  })
  refresh.addEventListener('click', load)
  filter.addEventListener('change', renderList)
  search.addEventListener('input', renderList)
  void load()
}
