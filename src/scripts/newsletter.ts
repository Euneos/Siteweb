import { isNewsletterState, newsletterMessages, newsletterSuccess } from '../lib/newsletter-feedback'

for (const form of document.querySelectorAll<HTMLFormElement>('[data-newsletter-form]')) {
  const status = document.getElementById(form.dataset.newsletterStatus ?? '')
  if (!status) continue
  const feedback = status
  let pending = false

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (pending) return
    pending = true
    // form.elements inclut aussi le bouton externe de la page Newsletter.
    const buttons = Array.from(form.elements).filter(
      (element): element is HTMLButtonElement => element instanceof HTMLButtonElement && element.type === 'submit',
    )
    const disabled = buttons.map((button) => button.disabled)
    const body = new FormData(form)
    form.setAttribute('aria-busy', 'true')
    buttons.forEach((button) => { button.disabled = true })

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(30_000),
      })
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || !('state' in result) || !isNewsletterState(result.state)) {
        throw new Error('Réponse newsletter inattendue')
      }
      showFeedback(result.state)
      if ('download' in result && typeof result.download === 'string' && result.download.startsWith('/api/etude?token=')) {
        const link = document.createElement('a')
        link.href = result.download
        link.textContent = 'Télécharger l’étude'
        link.className = 'cta s-blanc'
        feedback.replaceChildren(document.createTextNode(result.state === 'confirmation'
          ? 'Votre étude se télécharge. Vérifiez votre boîte e-mail pour confirmer votre inscription à la newsletter. '
          : 'Vous êtes déjà inscrits à la newsletter EUNEOS. '), link)
        feedback.classList.remove('is-error')
        feedback.classList.add('is-ok')
        feedback.setAttribute('role', 'status')
        feedback.setAttribute('aria-live', 'polite')
        link.click()
      }
    } catch {
      // Pas de nouvel envoi automatique : le serveur a pu recevoir la demande.
      showFeedback('technique')
    } finally {
      pending = false
      form.removeAttribute('aria-busy')
      buttons.forEach((button, index) => { button.disabled = disabled[index] })
    }
  })

  function showFeedback(state: keyof typeof newsletterMessages) {
    const success = newsletterSuccess(state)
    feedback.classList.toggle('is-ok', success)
    feedback.classList.toggle('is-error', !success)
    feedback.setAttribute('role', success ? 'status' : 'alert')
    feedback.setAttribute('aria-live', success ? 'polite' : 'assertive')
    feedback.textContent = newsletterMessages[state]
    feedback.focus({ preventScroll: true })
    // Révéler seulement le message s'il est hors écran, sans navigation ni retour en haut.
    feedback.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
}
