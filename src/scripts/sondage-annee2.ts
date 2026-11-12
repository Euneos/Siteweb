import { interested, parseSurvey, surveyQuestions, surveyThanks } from '../lib/sondage-annee2'
const form = document.querySelector<HTMLFormElement>('#survey-form')
const feedback = document.querySelector<HTMLElement>('#survey-feedback')
if (form && feedback) {
  const rankMenus = [...form.querySelectorAll<HTMLSelectElement>('[data-rank-choice]')]
  const rankOptions = new Map(rankMenus.map(menu => [menu, [...menu.options].map(option => ({ value: option.value, text: option.text }))]))
  const update = () => {
    const usedRanks = new Set(rankMenus.map(menu => menu.value).filter(Boolean))
    for (const menu of rankMenus) {
      const current = menu.value
      menu.replaceChildren(...rankOptions.get(menu)!
        .filter(option => !option.value || option.value === current || !usedRanks.has(option.value))
        .map(option => new Option(option.text, option.value, false, option.value === current)))
    }
    const data = new FormData(form)
    form.querySelectorAll<HTMLElement>('[data-when], [data-other]').forEach((container) => {
      if (container.dataset.other === 'activities') {
        const input = container.querySelector<HTMLTextAreaElement>('textarea')!
        input.required = !!form.querySelector<HTMLSelectElement>('[data-rank-choice="Autre"]')?.value
        return
      }
      if (container.dataset.other) {
        container.querySelector<HTMLTextAreaElement>('textarea')!.required = data.getAll(container.dataset.other).includes('Autre')
        return
      }
      const active = container.dataset.when
        ? interested(data.get(container.dataset.when))
        : data.getAll(container.dataset.other!).includes('Autre')
      container.hidden = !active
      container
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
        .forEach((input) => {
          input.disabled = !active
          if (container.dataset.other) input.required = active
        })
    })
  }
  form.addEventListener('change', update)
  form.addEventListener('input', event => {
    const input = event.target
    if (!(input instanceof HTMLTextAreaElement) || !input.value.trim()) return
    const key = input.closest<HTMLElement>('[data-other]')?.dataset.other
    if (!key || key === 'activities') return
    const option = form.querySelector<HTMLInputElement>(`input[name="${key}"][value="Autre"]`)
    if (option) option.checked = true
    update()
  })
  update()
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!
    if (button.disabled) return
    feedback.hidden = false
    try {
      const data = new FormData(form),
        raw: Record<string, unknown> = {}
      for (const q of surveyQuestions) {
        if (q.when && !interested(data.get(q.when))) continue
        if (q.type === 'ranking') {
          const ranked = q.choices!.map((choice, i) => ({ choice, rank: Number(data.get(`${q.key}Rank${i}`)) })).filter(item => item.rank > 0).sort((a, b) => a.rank - b.rank)
          if (new Set(ranked.map(item => item.rank)).size !== ranked.length) throw new Error('Question 3 : utilisez chaque rang une seule fois.')
          if (ranked.some((item, i) => item.rank !== i + 1)) throw new Error('Question 3 : commencez à 1 et utilisez des rangs consécutifs.')
          if (String(data.get('activitiesOther') ?? '').trim() && !ranked.some(item => item.choice === 'Autre')) throw new Error('Question 3 : attribuez un rang à votre proposition « Autre ».')
          raw[q.key] = ranked.map(item => item.choice)
        } else raw[q.key] = q.type === 'checkbox' ? data.getAll(q.key) : (data.get(q.key) ?? '')
        if (q.other && data.has(`${q.key}Other`)) raw[`${q.key}Other`] = data.get(`${q.key}Other`)
      }
      const answers = parseSurvey(raw)
      button.disabled = true
      feedback.textContent = 'Envoi en cours…'
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          version: 'sondage-annee2-v1',
          website: data.get('website') ?? '',
          answers,
        }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.message || 'L’envoi n’a pas pu être confirmé. Votre saisie est conservée.',
        )
      if (result.state !== 'complete')
        throw new Error(
          'La réception est en cours de vérification. Conservez votre saisie et contactez EUNEOS avant un nouvel envoi.',
        )
      feedback.textContent = result.preview
        ? 'Simulation réussie : aucune réponse enregistrée.'
        : `Vos réponses ont bien été enregistrées. ${surveyThanks}`
      form.hidden = true
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : 'Envoi non confirmé. Votre saisie est conservée.'
    } finally {
      button.disabled = false
      feedback.focus()
    }
  })
}
