export {}
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const search = document.querySelector<HTMLInputElement>('#recruitment-search')
const status = document.querySelector<HTMLSelectElement>('#recruitment-status')
const action = document.querySelector<HTMLSelectElement>('#recruitment-action')
const cards = [...document.querySelectorAll<HTMLElement>('[data-recruitment-card]')]
function filter() {
  let visible = 0
  for (const card of cards) {
    card.hidden = !normalize(card.dataset.search ?? '').includes(normalize(search?.value ?? ''))
      || Boolean(status?.value && card.dataset.status !== status.value)
      || Boolean(action?.value === 'rappeler' && card.dataset.status !== 'À rappeler')
      || Boolean(action?.value === 'brochure' && card.dataset.status !== 'Brochure à envoyer')
      || Boolean(action?.value === 'date' && !card.dataset.followUp)
    if (!card.hidden) visible++
  }
  const count = document.querySelector('#recruitment-count')
  if (count) count.textContent = `${visible} contact${visible > 1 ? 's' : ''} affiché${visible > 1 ? 's' : ''}`
}
search?.addEventListener('input', filter)
status?.addEventListener('change', filter)
action?.addEventListener('change', filter)
for (const form of document.querySelectorAll<HTMLFormElement>('[data-recruitment-form]')) {
  const feedback = form.querySelector<HTMLElement>('[data-save-status]')!
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  let uncertain = false
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (button.disabled || uncertain) return
    button.disabled = true
    feedback.textContent = 'Enregistrement et vérification…'
    try {
      const response = await fetch('/api/interne/recrutement', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({id: form.dataset.id, version: Number(form.dataset.version), contact: Object.fromEntries(new FormData(form))}),
      })
      const result = await response.json()
      if (!response.ok) {
        if (response.status >= 500 || response.status === 409) uncertain = true
        throw new Error(result.error || 'Enregistrement non confirmé. Rechargez la fiche.')
      }
      if (!result.contact || result.contact.id !== form.dataset.id) {
        uncertain = true
        throw new Error('Réponse non confirmée. Rechargez avant toute nouvelle tentative.')
      }
      // Re-read by the server is required before displaying success.
      feedback.textContent = 'Fiche enregistrée et relue. Rechargement…'
      window.location.reload()
    } catch (error) {
      if (!(error instanceof Error) || error instanceof TypeError) uncertain = true
      feedback.textContent = error instanceof Error ? error.message : 'Enregistrement incertain. Rechargez avant de réessayer.'
    } finally {
      button.disabled = uncertain
    }
  })
}
