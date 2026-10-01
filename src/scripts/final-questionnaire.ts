export {}
const form = document.querySelector<HTMLFormElement>('#final-questionnaire-form')
const feedback = document.querySelector<HTMLElement>('#final-questionnaire-feedback')
const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
if (form && feedback && button) {
  const syncValidity = () => {
    for (const group of form.querySelectorAll<HTMLElement>('[data-multiple-required]')) {
      const boxes = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      boxes[0]?.setCustomValidity(
        boxes.some((b) => b.checked) ? '' : 'Choisissez au moins une réponse.',
      )
    }
  }
  form.addEventListener('change', syncValidity)
  syncValidity()
  let busy = false,
    complete = false,
    pendingBody: string | null = null
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    syncValidity()
    if (busy || complete || !form.reportValidity()) return
    busy = true
    button.disabled = true
    feedback.hidden = false
    feedback.textContent = 'Envoi en cours…'
    const values = new FormData(form),
      website = values.get('website')
    values.delete('website')
    const answers: Record<string, string | FormDataEntryValue[]> = Object.fromEntries(
      values,
    ) as Record<string, string>
    for (const checkbox of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      answers[checkbox.name] = values.getAll(checkbox.name)
    // After an uncertain response, retry exactly the same payload. Keep values
    // visible; editing them must not create a second copy of a pending response.
    const body =
      pendingBody ??
      JSON.stringify({
        version: form.dataset.version,
        website,
        answers,
      })
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 20000)
    let uncertain = true
    let errorMessage =
      'La réception n’a pas pu être vérifiée. Conservez votre saisie et réessayez plus tard.'
    try {
      const response = await fetch(form.getAttribute('action')!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
      const result = await response.json()
      if (!response.ok) {
        uncertain = response.status >= 500
        if (response.status >= 500) pendingBody = body
        if (typeof result.message === 'string') errorMessage = result.message
        throw new Error('Submission failed')
      }
      if (result.state === 'complete') {
        complete = true
        feedback.textContent = result.preview
          ? 'Démonstration terminée. Aucune donnée n’a été enregistrée et aucun e-mail n’a été envoyé.'
          : 'Votre réponse a bien été enregistrée. Merci.'
      } else {
        pendingBody = body
        feedback.textContent =
          'Votre réponse est en cours de vérification. Conservez votre saisie ; réessayez pour vérifier sa réception ou contactez l’équipe EUNEOS.'
      }
    } catch {
      if (uncertain) pendingBody = body
      feedback.textContent = errorMessage
    } finally {
      clearTimeout(timeout)
      busy = false
      button.disabled = complete
      if (pendingBody || complete)
        for (const control of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input, textarea',
        ))
          control.readOnly = true
      if (pendingBody || complete)
        for (const control of form.querySelectorAll<HTMLInputElement>(
          'input[type="radio"], input[type="checkbox"], select',
        ))
          control.disabled = true
      button.textContent = complete
        ? 'Réponse reçue'
        : pendingBody
          ? 'Vérifier la réception'
          : 'Envoyer'
      feedback.focus()
    }
  })
}
