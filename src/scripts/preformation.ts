export {}
const form = document.querySelector<HTMLFormElement>('#preformation-form')
const feedback = document.querySelector<HTMLElement>('#preformation-feedback')
const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
if (form && feedback && button) {
  let busy = false,
    complete = false,
    pendingBody: string | null = null
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || complete || !form.reportValidity()) return
    busy = true
    button.disabled = true
    feedback.hidden = false
    feedback.textContent = 'Envoi en cours…'
    const values = new FormData(form),
      website = values.get('website')
    const newsletterOptOut = values.has('newsletterOptOut')
    values.delete('website')
    values.delete('newsletterOptOut')
    // After an uncertain response, retry exactly the same payload. Keep values
    // visible; editing them must not create a second copy of a pending response.
    const body =
      pendingBody ??
      JSON.stringify({
        version: form.dataset.version,
        website,
        newsletterOptOut,
        answers: Object.fromEntries(values),
      })
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 45000)
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
          : result.newsletterUnavailable
            ? 'Votre réponse a bien été enregistrée. L’inscription à la newsletter n’a pas pu être confirmée.'
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
          'input[type="radio"], input[name="newsletterOptOut"]',
        ))
          control.disabled = true
      button.textContent = complete
        ? 'Réponse reçue'
        : pendingBody
          ? 'Vérifier la réception'
          : 'Envoyer mes réponses'
      feedback.focus()
    }
  })
}
