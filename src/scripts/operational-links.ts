type Kind = 'contact' | 'deploiement' | 'participants'
type PersonalLink = { url: string; expiresAt: string }
type Dossier = {
  participationId: number
  schoolName: string
  city: string
  cohortLabel: string
  code: string
  links?: Partial<Record<Kind, PersonalLink>>
}
type Submission = {
  participationId: number
  kind: Kind
  state: string
  code?: string
  createdAt: string
}
const kinds: Record<Kind, string> = {
  contact: 'Fiche contact',
  deploiement: 'Organisation de la formation',
  participants: 'Participants adultes',
}
const reviewReasons: Record<string, string> = {
  dates_conflict:
    'Les dates proposées diffèrent de celles du dossier. Vérifiez avec le référent les dates à retenir.',
  source_dates_conflict:
    'Les dates proposées diffèrent d’une réponse antérieure. Vérifiez avec le référent les dates à retenir.',
  dates_outside_cohort:
    'Les dates proposées dépassent les années de cette cohorte. Vérifiez l’année de formation.',
  participants_ambiguous:
    'Certains noms ou e-mails de participants se contredisent. Vérifiez les identités avant de compléter la liste.',
  historical_issues:
    'Le dossier contient déjà des incohérences à résoudre. Consultez le suivi avant de confirmer cette réponse.',
  pending_team_review: 'Une réponse antérieure attend encore la vérification de l’équipe.',
  formation_status_review:
    'Le statut actuel de la formation demande une vérification avant de reprendre ces informations.',
  deployment_already_declared:
    'Une organisation de la formation a déjà été déclarée. Vérifiez quelle version conserver.',
  read_failed:
    'Le dossier n’a pas pu être lu ; les nouvelles réponses n’ont pas été enregistrées. Un nouvel essai manuel est possible.',
  target_busy:
    'Une autre transmission est en cours pour ce dossier. Les nouvelles réponses n’ont pas été enregistrées ; réessayez après vérification.',
  concurrent_change:
    'Le dossier a changé pendant la transmission. Vérifiez son état actuel avant de réessayer.',
  write_uncertain:
    'L’enregistrement n’a pas pu être confirmé. Vérifiez les informations déjà présentes dans le dossier avant tout nouvel envoi.',
  payload_changed:
    'Une nouvelle saisie a été refusée après une réponse antérieure. Créez un nouveau lien si une correction est nécessaire.',
  link_renewed: 'Le lien a été remplacé. Utilisez le lien actuel conservé dans le dossier.',
}
const app = document.querySelector<HTMLElement>('#operational-links')
if (app) {
  const form = app.querySelector<HTMLFormElement>('#operational-link-form')!
  const dossier = form.querySelector<HTMLSelectElement>('[name=participationId]')!
  const kind = form.querySelector<HTMLSelectElement>('[name=kind]')!
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!
  const feedback = app.querySelector<HTMLElement>('#link-feedback')!
  const result = app.querySelector<HTMLElement>('#link-result')!
  const urlInput = app.querySelector<HTMLInputElement>('#link-url')!
  const expiration = app.querySelector<HTMLElement>('#link-expiration')!
  const copyFeedback = app.querySelector<HTMLElement>('#copy-feedback')!
  const receptionFeedback = app.querySelector<HTMLElement>('#submissions-feedback')!
  const list = app.querySelector<HTMLElement>('#submissions-list')!
  const refresh = app.querySelector<HTMLButtonElement>('#links-refresh')!
  let pending = false,
    loading = false,
    enabled = false
  let dossiers: Dossier[] = []
  const setMessage = (target: HTMLElement, message: string, error = false) => {
    target.textContent = message
    target.setAttribute('role', error ? 'alert' : 'status')
    target.classList.toggle('is-error', error)
  }
  const dateLabel = (value: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Europe/Paris',
    }).format(new Date(value))
  const lock = () => {
    dossier.disabled = kind.disabled = submit.disabled = pending || loading || !enabled
  }
  function linkUrl(value: PersonalLink, chosenKind: Kind) {
    if (
      typeof value?.url !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt))
    )
      throw new Error('invalid link')
    const url = new URL(value.url, location.origin)
    if (
      (url.origin !== location.origin && url.origin !== 'https://euneos.fr') ||
      url.pathname.replace(/\/$/, '') !==
        `/suivi/${chosenKind === 'contact' ? 'fiche-contact' : chosenKind}` ||
      !url.searchParams.get('t') ||
      url.username ||
      url.password
    )
      throw new Error('invalid link')
    return url.href
  }
  function showExisting() {
    result.hidden = true
    urlInput.value = ''
    copyFeedback.textContent = ''
    submit.textContent = 'Créer le lien'
    const current = dossiers.find((d) => String(d.participationId) === dossier.value)?.links?.[
      kind.value as Kind
    ]
    if (current && Date.parse(current.expiresAt) > Date.now()) {
      urlInput.value = linkUrl(current, kind.value as Kind)
      expiration.textContent = `Valable jusqu’au ${dateLabel(current.expiresAt)}.`
      result.hidden = false
      submit.textContent = 'Renouveler le lien'
      setMessage(
        feedback,
        'Un lien valide est déjà conservé dans ce dossier. Copiez-le pour le transmettre. Le renouveler invalide le précédent lien non utilisé.',
      )
    } else if (enabled)
      setMessage(
        feedback,
        'Choisissez le dossier et le formulaire, puis créez le lien à transmettre.',
      )
  }
  async function load() {
    if (loading || pending) return
    loading = true
    enabled = false
    lock()
    refresh.disabled = true
    list.hidden = true
    result.hidden = true
    urlInput.value = ''
    setMessage(receptionFeedback, 'Lecture des réceptions en cours…')
    try {
      const response = await fetch('/api/interne/formulaires', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json()
      if (
        !data ||
        typeof data.enabled !== 'boolean' ||
        !Array.isArray(data.dossiers) ||
        !Array.isArray(data.submissions) ||
        !data.dossiers.every(
          (d: Dossier) =>
            Number.isSafeInteger(d.participationId) &&
            d.participationId > 0 &&
            ['schoolName', 'city', 'cohortLabel', 'code'].every(
              (k) => typeof d[k as keyof Dossier] === 'string',
            ),
        ) ||
        !data.submissions.every(
          (s: Submission) =>
            Number.isSafeInteger(s.participationId) &&
            Object.hasOwn(kinds, s.kind) &&
            typeof s.state === 'string' &&
            Number.isFinite(Date.parse(s.createdAt)),
        )
      )
        throw new Error('invalid response')
      dossiers = data.dossiers
      for (const d of dossiers)
        for (const key of Object.keys(kinds) as Kind[]) {
          if (d.links?.[key]) linkUrl(d.links[key]!, key)
        }
      const selected = dossier.value || new URLSearchParams(location.search).get('dossier') || ''
      dossier.replaceChildren(new Option('Choisir un dossier', ''))
      for (const d of dossiers)
        dossier.add(
          new Option(
            [d.schoolName, d.city, d.cohortLabel, d.code].filter(Boolean).join(' · '),
            String(d.participationId),
          ),
        )
      dossier.value = dossiers.some((d) => String(d.participationId) === selected) ? selected : ''
      enabled = data.enabled && dossiers.length > 0
      setMessage(
        feedback,
        !data.enabled
          ? 'La création des liens est momentanément indisponible. Les réponses déjà reçues restent consultables.'
          : dossiers.length
            ? 'Choisissez le dossier et le formulaire à transmettre.'
            : 'Aucun dossier disponible pour créer un lien.',
      )
      list.replaceChildren()
      const submissions = [...data.submissions] as Submission[]
      submissions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      for (const s of submissions) {
        const d = dossiers.find((d) => d.participationId === s.participationId)
        const card = document.createElement('article')
        card.className = 'of-submission'
        const heading = document.createElement('h3')
        heading.textContent = d
          ? `${d.schoolName} · ${d.cohortLabel}`
          : 'Dossier non disponible dans cette liste'
        const state = document.createElement('p')
        state.className = 'of-state'
        state.textContent = `${kinds[s.kind]} — ${s.state === 'complete' ? 'Réponse enregistrée' : s.state === 'retryable' ? 'Réponses non enregistrées' : s.state === 'review' ? 'Vérification nécessaire' : s.state === 'processing' ? 'Traitement à confirmer' : 'État à vérifier'}`
        const when = document.createElement('p')
        when.textContent = `${s.state === 'complete' ? 'Reçue le' : 'Tentative le'} ${dateLabel(s.createdAt)}`
        card.append(heading, state, when)
        if (s.state !== 'complete') {
          const info = document.createElement('p')
          info.textContent =
            (s.code && reviewReasons[s.code]) ||
            'Consultez le dossier et vérifiez les informations avec l’équipe avant de faire renvoyer une réponse.'
          card.append(info)
        }
        if (d) {
          const link = document.createElement('a')
          link.href = `/etat-candidatures#dossier-${d.participationId}`
          link.textContent = 'Consulter le suivi'
          card.append(link)
        }
        list.append(card)
      }
      const incidents = submissions.filter((s) => s.state !== 'complete').length
      setMessage(
        receptionFeedback,
        submissions.length
          ? `${submissions.length} tentative(s) consultée(s), dont ${incidents} à vérifier.${submissions.length >= 100 ? ' Seules les 100 dernières sont affichées.' : ''}`
          : 'Aucune tentative de transmission dans ce suivi pour le moment.',
      )
      list.hidden = submissions.length === 0
      if (enabled) showExisting()
    } catch {
      setMessage(feedback, 'Les dossiers n’ont pas pu être lus. Actualisez pour réessayer.', true)
      setMessage(
        receptionFeedback,
        'Les réceptions n’ont pas pu être vérifiées. Aucun bilan ne peut être affiché pour le moment.',
        true,
      )
    } finally {
      loading = false
      refresh.disabled = false
      lock()
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (pending || loading || !enabled || !form.reportValidity()) return
    const participationId = Number(dossier.value),
      chosenKind = kind.value as Kind
    if (
      !dossiers.some((d) => d.participationId === participationId) ||
      !Object.hasOwn(kinds, chosenKind)
    )
      return
    pending = true
    lock()
    refresh.disabled = true
    result.hidden = true
    urlInput.value = ''
    copyFeedback.textContent = ''
    form.setAttribute('aria-busy', 'true')
    setMessage(feedback, 'Préparation du lien…')
    // A failed renewal may still have replaced the previous link on the server.
    // Do not offer a cached old link; a manual refresh will verify the current one.
    const previous = dossiers.find((d) => d.participationId === participationId)
    if (previous?.links) delete previous.links[chosenKind]
    try {
      const response = await fetch('/api/interne/formulaires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ participationId, kind: chosenKind }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error('unavailable')
      const data = await response.json()
      const personalLink = { url: linkUrl(data, chosenKind), expiresAt: data.expiresAt }
      const selected = dossiers.find((d) => d.participationId === participationId)!
      selected.links = { ...selected.links, [chosenKind]: personalLink }
      showExisting()
      setMessage(
        feedback,
        'Lien conservé dans le dossier. Vous pouvez le copier et le transmettre ; aucun e-mail n’a été envoyé.',
      )
    } catch {
      setMessage(
        feedback,
        'La création du lien n’a pas pu être confirmée. Aucun nouvel essai automatique n’a été effectué. Vérifiez avant de renouveler le lien.',
        true,
      )
    } finally {
      pending = false
      form.removeAttribute('aria-busy')
      refresh.disabled = false
      lock()
      feedback.focus({ preventScroll: true })
    }
  })
  app.querySelector<HTMLButtonElement>('#link-copy')!.addEventListener('click', async () => {
    if (!urlInput.value) return
    try {
      await navigator.clipboard.writeText(urlInput.value)
      copyFeedback.textContent = 'Lien copié.'
    } catch {
      urlInput.focus()
      urlInput.select()
      copyFeedback.textContent = 'Sélectionnez puis copiez le lien ci-dessus.'
    }
  })
  form.addEventListener('change', showExisting)
  refresh.addEventListener('click', () => {
    void load()
  })
  void load()
}
