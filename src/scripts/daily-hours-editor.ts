import { parseDailyHours, dailyTotal, type DailyHours } from '../lib/daily-hours'

export function initDailyHours(form: HTMLFormElement) {
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  const stored = field('daily_hours')
  const total = field('hours')
  const root = document.getElementById('iw-daily-hours')!
  const controls = document.getElementById('iw-daily-controls')!
  const target = document.getElementById('iw-daily-rows')!
  const feedback = document.getElementById('iw-daily-feedback')!
  let enabled = false
  const dates = () => {
    const start = field('starts_on').value,
      end = field('ends_on').value
    if (!start || !end || end < start || start.slice(0, 7) !== end.slice(0, 7))
      throw new Error('Choisissez une période dans un seul mois pour saisir les heures par jour.')
    const values: string[] = []
    for (
      let d = new Date(`${start}T12:00:00Z`);
      d.toISOString().slice(0, 10) <= end;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      values.push(d.toISOString().slice(0, 10))
      if (values.length > 31) throw new Error('La période dépasse un mois.')
    }
    return values
  }
  const rows = () =>
    parseDailyHours(stored.value, field('starts_on').value, field('ends_on').value) ?? []
  const notify = () => stored.dispatchEvent(new Event('input', { bubbles: true }))
  function updateTotal() {
    if (!stored.value) return
    const parsed = rows()
    const actual = dailyTotal(parsed, 'actual')
    total.value = actual === null ? '' : String(actual)
    feedback.textContent = `${dailyTotal(parsed, 'planned') ?? 0} h prévues · ${actual === null ? 'Réalisé non renseigné' : `${actual} h réalisées`}. Seuls les jours renseignés apparaîtront au calendrier.`
  }
  function action(text: string, run: () => void) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'iw-button'
    button.textContent = text
    button.addEventListener('click', () => {
      try {
        run()
      } catch (error) {
        feedback.textContent = (error as Error).message
      }
    })
    return button
  }
  function render(team: boolean) {
    enabled = team
    root.hidden = !team
    controls.replaceChildren()
    target.replaceChildren()
    feedback.textContent = ''
    total.readOnly = team && !!stored.value
    if (!team) return
    if (!stored.value) {
      feedback.textContent =
        'Cette fiche couvre toute la période. Passez à la saisie par jour pour choisir uniquement les dates travaillées.'
      controls.append(
        action('Saisir les heures par jour', () => {
          dates()
          if (
            total.value !== '' &&
            !window.confirm(
              `Cette fiche contient un total de ${total.value} h sans répartition. En passant à la saisie par jour, ce total sera remplacé par les heures réalisées que vous renseignerez. Continuer ?`,
            )
          )
            return
          stored.value = '[]'
          render(true)
          notify()
        }),
      )
      return
    }
    let days: string[], existing: DailyHours[]
    try {
      days = dates()
      existing = rows()
    } catch (error) {
      feedback.textContent = `${(error as Error).message} Rétablissez les dates précédentes pour conserver votre saisie.`
      return
    }
    controls.append(
      action('Prévoir 7 h les mardis et jeudis', () => {
        const current = rows()
        for (const date of dates()) {
          if (![2, 4].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue
          const row = current.find((row) => row.date === date)
          if (row) {
            if (row.planned === null) row.planned = 7
          } else current.push({ date, planned: 7, actual: null })
        }
        stored.value = JSON.stringify(current)
        render(true)
        notify()
      }),
    )
    const instructions = document.createElement('p')
    instructions.className = 'iw-small iw-muted'
    instructions.textContent =
      'Pour la demi-journée variable, utilisez « Prévoir 3 h 30 » sur le mercredi ou vendredi choisi chaque semaine. Effacez une ancienne prévision pour déplacer cette demi-journée. Les valeurs déjà saisies ne sont pas remplacées par le préremplissage.'
    controls.append(instructions)
    for (const date of days) {
      const row = existing.find((row) => row.date === date)
      const group = document.createElement('div')
      group.className = 'iw-formgrid iw-daily-day'
      const day = new Date(`${date}T12:00:00Z`)
      const heading = document.createElement('p')
      heading.className = 'iw-field--wide'
      heading.textContent = new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }).format(day)
      group.append(heading)
      let shortcut: HTMLButtonElement | undefined
      for (const key of ['planned', 'actual'] as const) {
        const label = document.createElement('label')
        label.className = 'iw-field'
        label.textContent = key === 'planned' ? 'Heures prévues' : 'Heures réalisées'
        const input = document.createElement('input')
        input.type = 'number'
        input.min = '0'
        input.max = '24'
        input.step = 'any'
        input.inputMode = 'decimal'
        input.setAttribute('aria-label', `${label.textContent} le ${heading.textContent}`)
        input.value = row?.[key] == null ? '' : String(row[key])
        input.addEventListener('input', () => {
          if (!input.validity.valid) return
          const current = rows()
          let entry = current.find((row) => row.date === date)
          if (!entry) {
            entry = { date, planned: null, actual: null }
            current.push(entry)
          }
          entry[key] = input.value === '' ? null : Number(input.value)
          stored.value = JSON.stringify(
            current.filter((row) => row.planned !== null || row.actual !== null),
          )
          updateTotal()
          notify()
        })
        label.append(input)
        group.append(label)
        if (key === 'planned' && [3, 5].includes(day.getUTCDay())) {
          shortcut = action('Prévoir 3 h 30', () => {
            input.value = '3.5'
            input.dispatchEvent(new Event('input', { bubbles: true }))
          })
          shortcut.classList.add('iw-field--wide')
        }
      }
      if (shortcut) group.append(shortcut)
      target.append(group)
    }
    updateTotal()
  }
  for (const name of ['starts_on', 'ends_on'])
    field(name).addEventListener('change', () => render(enabled))
  function validate() {
    if (!enabled || !stored.value) return true
    try {
      dates()
      rows()
      updateTotal()
      return true
    } catch (error) {
      feedback.textContent = (error as Error).message
      return false
    }
  }
  return { render, validate }
}
