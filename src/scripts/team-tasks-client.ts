import type { TeamTask } from '../lib/team-tasks'

const root = document.querySelector('#team-board')
if (root) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const dialog = get<HTMLDialogElement>('task-editor')
  const form = get<HTMLFormElement>('task-form')
  const notice = get('task-notice')
  const error = get('task-error')
  const save = get<HTMLButtonElement>('task-save')
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  let tasks: TeamTask[] = []
  let current: TeamTask | undefined
  let requestId = ''
  let busy = false
  let initial = ''
  const values = () => Object.fromEntries(new FormData(form))
  const render = () => {
    for (const cell of root.querySelectorAll<HTMLElement>('.task-cell')) {
      cell.replaceChildren()
      const matching = tasks.filter(
        (task) => task.person === cell.dataset.person && task.status === cell.dataset.status,
      )
      for (const task of matching) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'task-card'
        const title = document.createElement('strong')
        title.textContent = task.title
        button.append(title)
        if (task.description) {
          const detail = document.createElement('span')
          detail.textContent = task.description
          button.append(detail)
        }
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
      render()
      notice.textContent = `${tasks.length} tâche${tasks.length === 1 ? '' : 's'} dans le tableau partagé.`
    } catch {
      notice.textContent =
        'Impossible d’actualiser les tâches. Le tableau peut être incomplet. Cliquez sur Actualiser pour réessayer.'
    } finally {
      refresh.disabled = false
      root!.querySelector('table')!.setAttribute('aria-busy', 'false')
    }
  }
  function open(task?: TeamTask, person = 'Charlotte', status = 'en-attente') {
    current = task
    requestId = task?.id ?? crypto.randomUUID()
    form.reset()
    field('title').value = task?.title ?? ''
    field('description').value = task?.description ?? ''
    field('person').value = task?.person ?? person
    field('status').value = task?.status ?? status
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
      await load()
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
