import {
  parseDailyHours,
  dailyTotal,
  slotHours,
  type DailyHours,
  type TimeSlot,
} from '../lib/daily-hours'
import { planMonth } from '../lib/monthly-availability'

export function initDailyHours(form: HTMLFormElement) {
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  const stored = field('daily_hours')
  const total = field('hours')
  const root = document.getElementById('iw-daily-hours')!
  const controls = document.getElementById('iw-daily-controls')!
  const target = document.getElementById('iw-daily-rows')!
  const feedback = document.getElementById('iw-daily-feedback')!
  let enabled = false
  let unapplied = false
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
  function slotPicker(labelText: string, initial?: TimeSlot[]) {
    const presets: Record<string, TimeSlot[]> = {
      morning: [{ start: '09:00', end: '12:30' }],
      afternoon: [{ start: '13:30', end: '17:00' }],
      day: [
        { start: '09:00', end: '12:30' },
        { start: '13:30', end: '17:00' },
      ],
    }
    const wrapper = document.createElement('div')
    wrapper.className = 'iw-field'
    const label = document.createElement('label')
    label.textContent = labelText
    const select = document.createElement('select')
    select.setAttribute('aria-label', labelText)
    for (const [value, caption] of Object.entries({
      '': 'Aucune prévision',
      morning: 'Matin · 9 h – 12 h 30',
      afternoon: 'Après-midi · 13 h 30 – 17 h',
      day: 'Journée · 7 h, pause exclue',
      custom: 'Créneau personnalisé',
    }))
      select.add(new Option(caption, value))
    select.value = initial
      ? (Object.keys(presets).find((k) => JSON.stringify(presets[k]) === JSON.stringify(initial)) ??
        'custom')
      : ''
    label.append(select)
    wrapper.append(label)
    const custom = document.createElement('div')
    custom.className = 'iw-formgrid'
    const inputs = ['start', 'end'].map((key, index) => {
      const fieldLabel = document.createElement('label')
      fieldLabel.className = 'iw-field'
      fieldLabel.textContent = index ? 'Fin' : 'Début'
      const input = document.createElement('input')
      input.type = 'time'
      input.setAttribute('aria-label', `${index ? 'Fin' : 'Début'} — ${labelText}`)
      input.value = initial?.[0]?.[key as 'start' | 'end'] ?? (index ? '12:30' : '09:00')
      fieldLabel.append(input)
      custom.append(fieldLabel)
      return input
    })
    const secondLabel = document.createElement('label')
    secondLabel.className = 'iw-field--wide'
    const second = document.createElement('input')
    second.type = 'checkbox'
    second.checked = initial?.length === 2
    second.setAttribute('aria-label', `Second créneau — ${labelText}`)
    secondLabel.append(second, ' Ajouter un second créneau')
    custom.append(secondLabel)
    const secondFields = document.createElement('div')
    secondFields.className = 'iw-formgrid iw-field--wide'
    const secondInputs = ['start', 'end'].map((key, index) => {
      const label = document.createElement('label')
      label.className = 'iw-field'
      label.textContent = index ? 'Fin du second créneau' : 'Début du second créneau'
      const input = document.createElement('input')
      input.type = 'time'
      input.setAttribute(
        'aria-label',
        `${index ? 'Fin' : 'Début'} du second créneau — ${labelText}`,
      )
      input.value = initial?.[1]?.[key as 'start' | 'end'] ?? (index ? '17:00' : '13:30')
      label.append(input)
      secondFields.append(label)
      return input
    })
    secondFields.hidden = !second.checked
    second.addEventListener('change', () => {
      secondFields.hidden = !second.checked
      unapplied = true
    })
    custom.append(secondFields)
    const visibility = () => {
      custom.hidden = select.value !== 'custom'
    }
    select.addEventListener('change', visibility)
    select.addEventListener('change', () => {
      unapplied = true
    })
    ;[...inputs, ...secondInputs].forEach((input) =>
      input.addEventListener('input', () => {
        unapplied = true
      }),
    )
    visibility()
    wrapper.append(custom)
    return {
      wrapper,
      read: () => {
        if (!select.value) return undefined
        const slots =
          select.value === 'custom'
            ? [
                { start: inputs[0].value, end: inputs[1].value },
                ...(second.checked
                  ? [{ start: secondInputs[0].value, end: secondInputs[1].value }]
                  : []),
              ]
            : presets[select.value]
        slotHours(slots)
        return slots
      },
    }
  }
  function render(team: boolean) {
    enabled = team
    unapplied = false
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
    const recurring = document.createElement('details')
    recurring.open = existing.length === 0
    const summary = document.createElement('summary')
    summary.textContent = 'Répéter des jours chaque semaine'
    recurring.append(summary)
    const explanation = document.createElement('p')
    explanation.className = 'iw-small iw-muted'
    explanation.textContent =
      'Choisissez les jours et horaires, puis appliquez à la période. Corrigez ensuite les exceptions ci-dessous. Une nouvelle application remplace les prévisions et leurs exceptions, jamais les heures réalisées.'
    recurring.append(explanation)
    const week = document.createElement('div')
    week.className = 'iw-formgrid'
    const pickers = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(
      (day, i) => {
        const picker = slotPicker(`Chaque ${day.toLowerCase()}`)
        week.append(picker.wrapper)
        return { ...picker, weekday: (i + 1) % 7 }
      },
    )
    recurring.append(
      week,
      action('Appliquer les jours à la période', () => {
        const rules = pickers.flatMap((p) => {
          const slots = p.read()
          return slots ? [{ weekday: p.weekday, slots }] : []
        })
        const current = rows()
        if (
          current.some((r) => r.planned !== null) &&
          !window.confirm(
            'Remplacer les prévisions et leurs exceptions par ces jours récurrents ? Les heures réalisées seront conservées.',
          )
        )
          return
        stored.value = JSON.stringify(
          planMonth(field('starts_on').value, field('ends_on').value, rules, current),
        )
        render(true)
        notify()
      }),
    )
    controls.append(recurring)
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
      'Le raccourci mardi/jeudi complète seulement les prévisions vides. Pour une demi-journée variable, choisissez le mercredi ou vendredi concerné ci-dessous. Effacez l’ancienne prévision pour la déplacer.'
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
          if (key === 'planned') delete entry.slots // A free duration no longer claims exact times.
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
      const exception = document.createElement('details')
      exception.className = 'iw-field--wide'
      const caption = document.createElement('summary')
      caption.textContent =
        row?.slots?.map((s) => `${s.start}–${s.end}`).join(' · ') ??
        'Créneau ou exception pour ce jour'
      const picker = slotPicker(`Prévision le ${heading.textContent}`, row?.slots)
      exception.append(
        caption,
        picker.wrapper,
        action('Appliquer à ce jour', () => {
          const slots = picker.read()
          const current = rows().filter((r) => r.date !== date)
          const actual = rows().find((r) => r.date === date)?.actual ?? null
          if (slots || actual !== null)
            current.push({
              date,
              actual,
              planned: slots ? slotHours(slots) : null,
              ...(slots ? { slots } : {}),
            })
          stored.value = JSON.stringify(current)
          render(true)
          notify()
        }),
      )
      group.append(exception)
      target.append(group)
    }
    updateTotal()
  }
  for (const name of ['starts_on', 'ends_on'])
    field(name).addEventListener('change', () => render(enabled))
  function validate() {
    if (enabled && unapplied) {
      feedback.textContent =
        'Appliquez les jours récurrents ou le créneau modifié avant d’enregistrer la fiche.'
      feedback.scrollIntoView({ block: 'center' })
      return false
    }
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
  return { render, validate, hasPending: () => unapplied }
}
