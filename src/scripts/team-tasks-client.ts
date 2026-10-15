import type { TeamTask } from '../lib/team-tasks'
import { moveTask } from '../lib/task-movement'

const root = document.querySelector('#team-board')
if (root) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const dialog = get<HTMLDialogElement>('task-editor')
  const form = get<HTMLFormElement>('task-form')
  const notice = get('task-notice')
  const error = get('task-error')
  const save = get<HTMLButtonElement>('task-save')
  const completedView = get<HTMLSelectElement>('task-completed-view')
  const priority = get<HTMLInputElement>('task-priority')
  const blocked = get<HTMLInputElement>('task-blocked')
  const archived = get<HTMLInputElement>('task-archived')
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  let tasks: TeamTask[] = []
  let current: TeamTask | undefined
  let requestId = ''
  let busy = false
  let boardBusy = false
  let needsRefresh = false
  let dragging: { id: string; person: string } | undefined
  let initial = ''
  const contributorFields = [
    ...form.querySelectorAll<HTMLInputElement>('input[name="contributors"]'),
  ]
  const values = () => ({
    ...Object.fromEntries(new FormData(form)),
    contributors: contributorFields
      .filter((input) => input.checked && !input.disabled)
      .map((input) => input.value),
    priority: priority.checked,
    blocked: blocked.checked,
    archived: archived.checked,
  })
  const syncPlanning = () => {
    get('task-blocker-field').hidden = !blocked.checked
    get<HTMLTextAreaElement>('task-blocker').required = blocked.checked
    const finished = field('status').value === 'terminee'
    get('task-archive-field').hidden = !finished
    if (!finished) archived.checked = false
  }
  blocked.addEventListener('change', syncPlanning)
  field('status').addEventListener('change', syncPlanning)
  const syncContributors = () => {
    for (const input of contributorFields) {
      input.disabled = input.value === field('person').value
      if (input.disabled) input.checked = false
    }
  }
  field('person').addEventListener('change', syncContributors)
  const render = () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
    for (const summary of root.querySelectorAll<HTMLElement>('[data-person-summary]')) {
      const active = tasks.filter(
        (task) =>
          task.status !== 'terminee' &&
          (task.person === summary.dataset.personSummary ||
            task.contributors.includes(summary.dataset.personSummary!)),
      )
      const priorities = active.filter((task) => task.priority).length
      summary.textContent = `${active.length} en activité · ${priorities} priorité${priorities > 1 ? 's' : ''}${priorities > 3 ? ' — à arbitrer' : ''}`
      summary.classList.toggle('is-overloaded', priorities > 3)
    }
    for (const cell of root.querySelectorAll<HTMLElement>('.task-cell')) {
      cell.replaceChildren()
      const matching = tasks
        .filter(
          (task) =>
            (task.person === cell.dataset.person ||
              task.contributors.includes(cell.dataset.person!)) &&
            task.status === cell.dataset.status &&
            (task.status !== 'terminee' ||
              (completedView.value === 'archived'
                ? task.archived
                : !task.archived &&
                  (completedView.value === 'all' ||
                    Date.parse(task.completed_at) >= Date.now() - 14 * 86400000))),
        )
        .sort((a, b) =>
          a.status === 'terminee'
            ? b.completed_at.localeCompare(a.completed_at)
            : Number(b.priority) - Number(a.priority),
        )
      for (const task of matching) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'task-card'
        const owner = task.person === cell.dataset.person
        if (!owner) button.classList.add('task-card--contributor')
        button.draggable = true
        button.dataset.taskId = task.id
        const role = document.createElement('span')
        role.className = 'task-role'
        role.textContent = owner ? 'Responsable' : 'Contributeur'
        button.append(role)
        const title = document.createElement('strong')
        title.textContent = task.title
        button.title = task.title
        button.append(title)
        const participants = document.createElement('span')
        participants.className = 'task-card-meta'
        participants.textContent = owner
          ? task.contributors.length
            ? `Avec ${task.contributors.join(', ')}`
            : ''
          : `Responsable : ${task.person}`
        if (participants.textContent) button.append(participants)
        const badges = document.createElement('span')
        badges.className = 'task-badges'
        const badge = (text: string, className = '') => {
          const el = document.createElement('span')
          el.className = `task-badge ${className}`
          el.textContent = text
          badges.append(el)
        }
        if (task.priority) badge('Prioritaire', 'task-badge--priority')
        if (task.blocked && task.status !== 'terminee')
          badge('Bloquée / Attente de réponse', 'task-badge--blocked')
        if (task.due_on) {
          const date = new Date(task.due_on + 'T12:00:00').toLocaleDateString('fr-FR')
          const overdue = task.status !== 'terminee' && task.due_on < today
          badge(
            `${overdue ? 'En retard : ' : 'Échéance : '}${date}`,
            overdue ? 'task-badge--overdue' : '',
          )
        }
        if (task.archived) badge('Archivée')
        if (badges.childElementCount) button.append(badges)
        button.addEventListener('dragstart', (event) => {
          if (boardBusy || needsRefresh || busy || dialog.open) {
            event.preventDefault()
            return
          }
          dragging = { id: task.id, person: cell.dataset.person! }
          event.dataTransfer!.effectAllowed = 'move'
          event.dataTransfer!.setData('text/plain', task.id)
          button.classList.add('is-dragging')
        })
        button.addEventListener('dragend', () => {
          dragging = undefined
          button.classList.remove('is-dragging')
          root
            .querySelectorAll('.is-drop-target')
            .forEach((el) => el.classList.remove('is-drop-target'))
        })
        button.addEventListener('click', () => open(task))
        cell.append(button)
      }
      if (!matching.length) {
        const empty = document.createElement('p')
        empty.className = 'iw-small iw-muted'
        empty.textContent = 'Aucune tâche'
        cell.append(empty)
      }
    }
  }
  async function load() {
    const refresh = get<HTMLButtonElement>('task-refresh')
    refresh.disabled = true
    root!.querySelector('table')!.setAttribute('aria-busy', 'true')
    try {
      const response = await fetch('/api/interne/taches', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      tasks = data.tasks
      needsRefresh = false
      render()
      const active = tasks.filter((task) => task.status !== 'terminee').length
      const finished = tasks.filter((task) => task.status === 'terminee' && !task.archived).length
      const archivedCount = tasks.filter((task) => task.archived).length
      notice.textContent = `${active} tâche${active === 1 ? '' : 's'} active${active === 1 ? '' : 's'} · ${finished} terminée${finished === 1 ? '' : 's'} · ${archivedCount} archivée${archivedCount === 1 ? '' : 's'}. Chaque tâche est comptée une seule fois.`
    } catch {
      notice.textContent =
        'Impossible d’actualiser les tâches. Le tableau peut être incomplet. Cliquez sur Actualiser pour réessayer.'
    } finally {
      refresh.disabled = false
      root!.querySelector('table')!.setAttribute('aria-busy', 'false')
    }
  }
  function open(task?: TeamTask, person = 'Charlotte', status = 'en-attente') {
    if (boardBusy || needsRefresh) return
    current = task
    requestId = task?.id ?? crypto.randomUUID()
    form.reset()
    field('title').value = task?.title ?? ''
    field('description').value = task?.description ?? ''
    field('person').value = task?.person ?? person
    field('status').value = task?.status ?? status
    field('due_on').value = task?.due_on ?? ''
    field('blocker').value = task?.blocker ?? ''
    priority.checked = task?.priority ?? false
    blocked.checked = task?.blocked ?? false
    archived.checked = task?.archived ?? false
    syncPlanning()
    for (const input of contributorFields)
      input.checked = task?.contributors.includes(input.value) ?? false
    syncContributors()
    get('task-editor-title').textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche'
    error.textContent = ''
    save.disabled = false
    initial = JSON.stringify(values())
    dialog.showModal()
    field('title').focus()
  }
  function close() {
    if (busy) return
    if (
      JSON.stringify(values()) !== initial &&
      !window.confirm('Fermer sans enregistrer vos modifications ?')
    )
      return
    dialog.close()
  }
  get('task-new').addEventListener('click', () => open())
  get('task-refresh').addEventListener('click', load)
  completedView.addEventListener('change', render)
  get('task-close').addEventListener('click', close)
  get('task-cancel').addEventListener('click', close)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close()
  })
  for (const button of root.querySelectorAll<HTMLButtonElement>('.task-add')) {
    button.addEventListener('click', () =>
      open(undefined, button.dataset.person, button.dataset.status),
    )
  }
  function mailFeedback(state: string) {
    const feedback = get('task-mail-feedback')
    const messages: Record<string, string> = {
      sent: 'Tâche enregistrée. Les notifications ont été transmises au service d’envoi d’e-mails.',
      unavailable: 'Tâche enregistrée, mais au moins une notification par e-mail est indisponible.',
      uncertain:
        'Tâche enregistrée. Au moins un envoi n’a pas pu être confirmé ; aucun nouvel envoi automatique ne sera tenté.',
      preview: 'Tâche enregistrée dans l’espace d’essai. Aucun e-mail n’a été envoyé.',
    }
    feedback.textContent = messages[state] ?? ''
    feedback.hidden = !feedback.textContent
  }
  for (const zone of root.querySelectorAll<HTMLElement>('.task-dropzone')) {
    zone.addEventListener('dragover', (event) => {
      if (!dragging || boardBusy || needsRefresh) return
      event.preventDefault()
      event.dataTransfer!.dropEffect = 'move'
      zone.classList.add('is-drop-target')
    })
    zone.addEventListener('dragleave', (event) => {
      if (!(event.relatedTarget instanceof Node) || !zone.contains(event.relatedTarget))
        zone.classList.remove('is-drop-target')
    })
    zone.addEventListener('drop', async (event) => {
      event.preventDefault()
      zone.classList.remove('is-drop-target')
      if (!dragging || boardBusy || needsRefresh) return
      const source = dragging
      dragging = undefined
      const task = tasks.find((task) => task.id === source.id)
      if (!task || (source.person === zone.dataset.person && task.status === zone.dataset.status))
        return
      let moved
      try {
        moved = moveTask(task, source.person, zone.dataset.person!, zone.dataset.status!)
      } catch (error) {
        notice.textContent = (error as Error).message
        return
      }
      boardBusy = true
      notice.textContent = 'Déplacement en cours…'
      try {
        const response = await fetch('/api/interne/taches', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: task.id, version: task.version, task: moved }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Déplacement non confirmé.')
        if (data.task.status === 'terminee')
          completedView.value = data.task.archived ? 'archived' : 'all'
        await load()
        mailFeedback(data.notification)
      } catch (error) {
        needsRefresh = true
        notice.textContent = `${error instanceof Error ? error.message : 'Déplacement non confirmé.'} Cliquez sur Actualiser avant de poursuivre.`
      } finally {
        boardBusy = false
      }
    })
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || save.disabled) return
    busy = true
    save.disabled = true
    error.textContent = 'Enregistrement…'
    try {
      const response = await fetch('/api/interne/taches', {
        method: current ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, version: current?.version, task: values() }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status < 500 && response.status !== 409) save.disabled = false
        throw new Error(
          data.error || 'Enregistrement non confirmé. Actualisez le tableau avant de réessayer.',
        )
      }
      dialog.close()
      if (data.task.status === 'terminee')
        completedView.value = data.task.archived ? 'archived' : 'all'
      await load()
      mailFeedback(data.notification)
    } catch (failure) {
      error.textContent =
        failure instanceof Error
          ? failure.message
          : 'Enregistrement non confirmé. Actualisez le tableau avant de réessayer.'
    } finally {
      busy = false
    }
  })
  void load()
}
