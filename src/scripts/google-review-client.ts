import type { reviewView, ReviewTarget, resolveReconciliationTargets } from '../lib/google-review'
import {
  matchesReviewFilter,
  matchesReviewSearch,
  reviewFilters,
  reviewReasonLabel,
  reviewIdentity,
  reviewTitle,
  reviewGuidance,
  reviewRequest,
} from '../lib/google-review-presentation'
type Row = Awaited<ReturnType<typeof reviewView>> & {
  resolvedTargets?: ReturnType<typeof resolveReconciliationTargets>
  operation?: { state: string; audit_json: string } | null
  correction?: { state: string; actor?: string } | null
}
const fieldLabels: Record<string, string> = {
  adulte_id: 'Identifiant du participant',
  nom: 'Nom',
  prenom: 'Prénom',
  email: 'E-mail',
  fonction: 'Fonction',
  participations_id: 'Dossier établissement',
  statut: 'Statut',
  adultes: 'Participants adultes',
  date_pre_recu: 'Réception du questionnaire préformation',
  date_suivi_recu: 'Réception du questionnaire de suivi à 45 jours',
  accord_signe: 'Accord signé',
  date_accord: 'Date de l’accord',
  notes: 'Informations du dossier',
  fiche_contact_recue: 'Fiche contact reçue',
  date_candidature: 'Date de candidature',
  enjeux: 'Enjeux identifiés',
  besoin_partage: 'Besoin partagé par l’équipe',
  nb_professionnels: 'Nombre de professionnels',
  faisabilite: 'Faisabilité',
  point_vigilance: 'Point de vigilance',
  accord_direction: 'Accord de la direction',
  demarrage_souhaite: 'Démarrage souhaité',
  contrainte_calendrier: 'Contraintes de calendrier',
  consentement: 'Consentement',
  apporteur_nom: 'Formateur apporteur',
  apporteur_email: 'E-mail du formateur apporteur',
  formation_instructeur: 'Formation de l’instructeur',
  experience_animation: 'Expérience d’animation',
  pratique_personnelle: 'Pratique personnelle',
  interventions_animees: 'Interventions animées',
  annees_experience: 'Années d’expérience',
  motivation: 'Motivation',
  disponible_2026_27: 'Disponibilité 2026–2027',
  etab_pressenti: 'Établissement pressenti',
  etab_pressenti_nom: 'Nom de l’établissement pressenti',
  etab_pressenti_adresse: 'Adresse de l’établissement pressenti',
  etab_pressenti_type: 'Type d’établissement',
  etab_pressenti_ville: 'Ville de l’établissement pressenti',
  etab_pressenti_cp: 'Code postal de l’établissement',
  etab_pressenti_academie: 'Académie',
  direction_nom: 'Nom de la direction',
  direction_email: 'E-mail de la direction',
  accord_principe: 'Accord de principe',
  contexte_complement: 'Complément de contexte',
  bilan_recu: 'Bilan reçu',
  dates_respectees: 'Respect des dates prévues',
  difficulte: 'Difficultés signalées',
}
type CorrectionChange = { label: string; before: unknown; after: unknown }
type CorrectionPreview = {
  id: string
  hash: string
  title: string
  targetLabel: string
  changes: CorrectionChange[]
  message: string
}
type CorrectionOptions = {
  kind: string | null
  title: string
  message: string
  targetKind: 'school' | 'trainer'
  fields: {
    key: string
    label: string
    type: 'date' | 'checkbox'
    value?: string | boolean
    required?: boolean
  }[]
}
const root = document.querySelector<HTMLElement>('#google-review')
if (root) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const feedback = get('gr-feedback'),
    list = get('gr-list'),
    listView = get('gr-list-view'),
    pendingSummary = get('gr-pending-summary'),
    detail = get('gr-detail'),
    form = get<HTMLFormElement>('gr-form')
  const target = get<HTMLSelectElement>('gr-target'),
    reason = get<HTMLTextAreaElement>('gr-reason'),
    confirm = get<HTMLInputElement>('gr-confirm')
  const filter = get<HTMLSelectElement>('gr-state'),
    search = get<HTMLInputElement>('gr-search'),
    refresh = get<HTMLButtonElement>('gr-refresh')
  let rows: Row[] = [],
    targets: ReviewTarget[] = [],
    selected: Row | null = null,
    busy = false
  let options: CorrectionOptions | null = null,
    preview: CorrectionPreview | null = null,
    lastOperation: { id: string; hash: string } | null = null,
    detailRequest = 0
  const labels = {
    integrated: 'Report vérifié',
    partial: 'Informations reportées en partie',
    pending: 'Vérification à terminer',
    unknown: 'Report à vérifier',
  }
  const summary = (row: Row) =>
    `${labels[row.state]}${row.correction?.state === 'complete' ? ' · Correction ciblée vérifiée' : row.correction ? ' · Correction à vérifier' : ''}${row.attachment ? ' · Dossier rattaché manuellement' : ''}${row.operation?.state === 'pending' ? ' · Confirmation à vérifier avant toute nouvelle action' : ''}`
  async function api(body?: unknown, sourceId?: number) {
    const response = await fetch(
      '/api/interne/reponses-google' + (sourceId ? `?sourceId=${sourceId}` : ''),
      {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      },
    )
    const data = await response.json().catch(() => null)
    if (!response.ok || !data)
      throw new Error(
        data?.error ||
          'Le résultat ne peut pas être confirmé. Actualisez avant toute nouvelle tentative.',
      )
    return data
  }
  function renderList() {
    list.replaceChildren()
    for (const option of Array.from(filter.options)) {
      const label = reviewFilters.find((item) => item.value === option.value)?.label
      if (label)
        option.textContent = `${label} (${rows.filter((row) => matchesReviewFilter(row, option.value)).length})`
    }
    const pendingCount = rows.filter((row) => matchesReviewFilter(row, 'pending')).length
    pendingSummary.textContent = `${pendingCount} entrée${pendingCount > 1 ? 's' : ''} à vérifier. Ouvrez une réponse pour connaître la correction possible ou le point à confirmer.`
    pendingSummary.hidden = pendingCount === 0
    const visible = rows.filter(
      (row) => matchesReviewFilter(row, filter.value) && matchesReviewSearch(row, search.value),
    )
    const count = document.createElement('p')
    count.textContent = `${visible.length} entrée(s) affichée(s) sur ${rows.length}. Les différentes versions d’une réponse sont conservées.`
    list.append(count)
    if (!visible.length) {
      const empty = document.createElement('p')
      empty.textContent =
        'Aucune réponse dans cette sélection. Changez le filtre ou effacez la recherche pour voir les autres réponses.'
      list.append(empty)
    }
    for (const row of visible) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'gr-row'
      button.dataset.responseId = String(row.id)
      const title = document.createElement('strong')
      title.textContent = reviewTitle(row)
      const status = document.createElement('span')
      status.textContent = `${row.submittedAt} · ${summary(row)}`
      const formLabel = document.createElement('span')
      formLabel.textContent = `${row.form || 'Formulaire non précisé'} · Réponse #${row.id}`
      const action = document.createElement('span'),
        owner = document.createElement('span')
      const guidance = reviewGuidance(row)
      action.textContent = guidance.title
      owner.textContent = `${guidance.owner} · Ouvrir la réponse →`
      owner.className = 'gr-row-action'
      button.append(title, formLabel, status, action, owner)
      button.addEventListener('click', () => {
        if (!busy) open(row)
      })
      list.append(button)
    }
  }
  function open(row: Row) {
    selected = row
    detail.hidden = false
    listView.hidden = true
    pendingSummary.hidden = true
    history.replaceState(null, '', `#reponse-${row.id}`)
    const guidance = reviewGuidance(row),
      identity = reviewIdentity(row)
    get('gr-title').textContent = reviewTitle(row)
    get('gr-source-form').textContent =
      `Réponse #${row.id} · ${row.form || 'Formulaire non précisé'} · ${row.submittedAt}${identity.year ? ` · Année déclarée : ${identity.year}` : ''}`
    get('gr-summary').textContent = summary(row)
    get('gr-owner').textContent = guidance.owner
    get('gr-action-title').textContent = guidance.title
    get('gr-next').textContent = guidance.next
    get<HTMLDetailsElement>('gr-source').open = false
    get('gr-reconciliation').hidden = !row.resolvedTargets?.length
    const resolved = get('gr-targets')
    resolved.replaceChildren()
    for (const item of row.resolvedTargets ?? []) {
      const li = document.createElement('li')
      li.textContent = `${item.label}${item.fields.length ? ` · Champs attestés : ${[...new Set(item.fields.map((field) => fieldLabels[field] || 'Autre information du dossier'))].join(', ')}` : ''}`
      resolved.append(li)
    }
    get('gr-reasons').textContent = row.receipt?.reasons.map(reviewReasonLabel).join(' · ') ?? ''
    const dossierLinks = get('gr-dossier-links')
    dossierLinks.replaceChildren()
    const schoolIds = new Map<number, string>()
    for (const t of row.resolvedTargets ?? [])
      if (
        ['participations', 'mbunbu0f1zztce4'].includes(t.table) &&
        Number.isSafeInteger(t.id) &&
        t.id > 0
      )
        schoolIds.set(t.id, t.label)
    if (row.attachment?.target.kind === 'school')
      schoolIds.set(row.attachment.target.id, row.attachment.target.label)
    for (const [id, label] of schoolIds) {
      const link = document.createElement('a')
      link.href = `/etat-candidatures#dossier-${id}`
      link.textContent = `Ouvrir le dossier : ${label}`
      dossierLinks.append(link)
    }

    const answers = get('gr-answers')
    answers.replaceChildren()
    for (const answer of row.answers.length
      ? row.answers
      : [{ question: 'Réponse source (format original)', answer: row.rawAnswers }]) {
      const dt = document.createElement('dt'),
        dd = document.createElement('dd')
      dt.textContent = answer.question
      dd.textContent = answer.answer || 'Non renseigné'
      answers.append(dt, dd)
    }
    get('gr-history').textContent =
      `Statut historique : ${row.status}\n${row.detail}${row.operation ? `\nRegistre de confirmation (${row.operation.state}) : ${row.operation.audit_json}` : ''}`
    form.reset()
    get('gr-choice').textContent = ''
    options = null
    preview = null
    lastOperation = null
    confirm.checked = false
    form.hidden = true
    get('gr-preview').hidden = true
    get('gr-correction-result').hidden = true
    get('gr-readonly').hidden = root!.dataset.admin === 'true'
    get('gr-readonly').textContent =
      'Votre accès est en consultation. Un responsable peut appliquer la correction ; vous pouvez préparer une demande ci-dessous.'
    void loadCorrection(row)
    get('gr-request').hidden = row.state === 'integrated' && row.operation?.state !== 'pending'
    get<HTMLTextAreaElement>('gr-request-text').value = reviewRequest(row)
    get('gr-copy-feedback').textContent = ''
    get('gr-title').focus()
    detail.scrollIntoView({ block: 'start' })
  }
  get('gr-back').addEventListener('click', () => {
    if (busy) return
    const id = selected?.id
    detailRequest++
    detail.hidden = true
    listView.hidden = false
    history.replaceState(null, '', location.pathname + location.search)
    renderList()
    list.querySelector<HTMLButtonElement>(`[data-response-id="${id}"]`)?.focus()
  })
  get('gr-copy-request').addEventListener('click', async () => {
    const text = get<HTMLTextAreaElement>('gr-request-text')
    try {
      await navigator.clipboard.writeText(text.value)
      get('gr-copy-feedback').textContent =
        'Demande copiée. Collez-la dans la conversation de votre choix ; aucun message n’a été envoyé.'
    } catch {
      text.focus()
      text.select()
      get('gr-copy-feedback').textContent =
        'La copie automatique n’est pas disponible. Le texte est sélectionné : copiez-le manuellement.'
    }
  })
  target.addEventListener('change', () => {
    get<HTMLInputElement>('gr-target-confirm').checked = false
    confirm.checked = false
    get('gr-choice').textContent = target.value
      ? `Dossier choisi : ${target.selectedOptions[0].textContent}`
      : ''
  })
  async function load() {
    if (busy) return
    busy = true
    refresh.disabled = true
    detail.hidden = true
    listView.hidden = false
    selected = null
    rows = []
    pendingSummary.hidden = true
    list.replaceChildren()
    feedback.textContent = 'Lecture des réponses et des dossiers…'
    try {
      const data = await api()
      rows = data.rows
      targets = data.targets
      renderList()
      feedback.textContent =
        'Réponses actualisées. Ouvrez un cas pour voir ce qui est déjà reporté et ce qui reste à vérifier.'
      const requested = /^#reponse-(\d+)$/.exec(location.hash)
      const linked = requested ? rows.find((row) => row.id === Number(requested[1])) : undefined
      if (linked) open(linked)
    } catch (error) {
      feedback.textContent = (error as Error).message
    } finally {
      busy = false
      refresh.disabled = false
    }
  }
  const displayValue = (value: unknown) =>
    value == null || value === ''
      ? 'Non renseigné'
      : typeof value === 'boolean'
        ? value
          ? 'Oui'
          : 'Non'
        : String(value)
  function showChanges(container: HTMLElement, changes: CorrectionChange[], completed = false) {
    container.replaceChildren()
    for (const change of changes) {
      const section = document.createElement('div'),
        title = document.createElement('strong'),
        before = document.createElement('p'),
        after = document.createElement('p')
      section.className = 'gr-change'
      title.textContent = change.label
      before.textContent = `${completed ? 'Avant correction' : 'Actuellement'} : ${displayValue(change.before)}`
      after.textContent = `Après correction : ${displayValue(change.after)}`
      section.append(title, before, after)
      container.append(section)
    }
  }
  function showResult(result: { state: string; message?: string; correction?: any }) {
    const correction = result.correction ?? result
    const state = result.state || correction.state
    get('gr-correction-result').hidden = false
    get('gr-result-title').textContent =
      state === 'complete'
        ? 'Correction appliquée et vérifiée'
        : state === 'conflict'
          ? 'La correction n’a pas pu être appliquée'
          : 'Résultat à vérifier'
    get('gr-result-message').textContent =
      result.message ||
      correction.message ||
      'Les valeurs modifiées sont conservées dans l’historique de cette réponse. Les autres informations n’ont pas été modifiées.'
    showChanges(get('gr-result-changes'), correction.changes ?? [], state === 'complete')
    lastOperation =
      correction.id && (correction.hash || correction.planHash)
        ? { id: correction.id, hash: correction.hash || correction.planHash }
        : lastOperation
    if (state === 'complete') {
      get('gr-action-title').textContent = 'Les changements affichés ont été vérifiés'
      get('gr-owner').textContent = 'Correction ciblée terminée'
      get('gr-next').textContent =
        'Le résultat ci-dessous détaille les champs corrigés. Les autres réponses restent conservées ; leur intégration complète n’est pas attestée par cette correction.'
      get('gr-request').hidden = true
      if (get('gr-reasons').textContent)
        get('gr-reasons').textContent =
          'Motif initial de la collecte : ' + get('gr-reasons').textContent
      get('gr-correction-feedback').textContent = ''
    }
    if (selected && correction.id) {
      selected.correction = { state, actor: correction.actor }
      get('gr-summary').textContent = summary(selected)
    }
    get('gr-check-result').hidden =
      !lastOperation ||
      (correction.actor && correction.actor !== root!.dataset.email) ||
      state === 'complete' ||
      state === 'conflict' ||
      root!.dataset.admin !== 'true'
    if (state === 'uncertain' || state === 'writing') form.hidden = true
  }
  async function loadCorrection(row: Row) {
    const request = ++detailRequest
    get('gr-correction-feedback').textContent = 'Vérification des corrections possibles…'
    try {
      const result = await api(undefined, row.id)
      if (request !== detailRequest || selected?.id !== row.id) return
      options = result.options
      get('gr-correction-feedback').textContent =
        options?.message || 'Aucune correction directe disponible pour cette réponse.'
      if (result.correction && result.correction.state !== 'prepared')
        showResult({ ...result.correction, correction: result.correction })
      if (
        !options?.kind ||
        root!.dataset.admin !== 'true' ||
        ['uncertain', 'writing', 'complete'].includes(result.correction?.state)
      )
        return
      get('gr-correction-help').textContent =
        options.title +
        '. Choisissez le dossier et son année, puis relisez l’aperçu. La base ne sera modifiée qu’après votre confirmation.'
      target.replaceChildren(new Option('Choisir le dossier et son année…', ''))
      for (const t of targets.filter((t) => t.kind === options!.targetKind))
        target.add(new Option(t.label, `${t.kind}:${t.id}`))
      const fields = get('gr-correction-fields')
      fields.replaceChildren()
      for (const field of options.fields) {
        const label = document.createElement('label'),
          input = document.createElement('input'),
          span = document.createElement('span')
        input.type = field.type
        input.dataset.correctionField = field.key
        input.required = field.required === true
        if (field.type === 'checkbox') {
          input.checked = field.value === true
          label.className = 'gr-check'
        } else input.value = typeof field.value === 'string' ? field.value : ''
        span.textContent = field.label
        label.append(span, input)
        fields.append(label)
      }
      form.hidden = false
    } catch (error) {
      if (request === detailRequest)
        get('gr-correction-feedback').textContent = (error as Error).message
    }
  }
  form.addEventListener('input', () => {
    preview = null
    get('gr-preview').hidden = true
    confirm.checked = false
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!selected || busy || !options?.kind || !form.reportValidity()) return
    const [kind, id] = target.value.split(':')
    const values: Record<string, unknown> = {}
    for (const input of form.querySelectorAll<HTMLInputElement>('[data-correction-field]')) {
      if (input.type === 'checkbox') {
        if (input.checked) values[input.dataset.correctionField!] = true
      } else if (input.value) values[input.dataset.correctionField!] = input.value
    }
    busy = true
    refresh.disabled = true
    get<HTMLButtonElement>('gr-save').disabled = true
    get('gr-correction-feedback').textContent =
      'Préparation de l’aperçu, sans modification de la base…'
    try {
      const result = await api({
        action: 'prepare-correction',
        id: selected.id,
        version: selected.version,
        targetKind: kind,
        targetId: Number(id),
        values,
        reason: reason.value,
      })
      preview = result.preview
      if (!preview)
        throw new Error('L’aperçu n’a pas pu être confirmé. Actualisez avant de poursuivre.')
      get('gr-preview').hidden = false
      get('gr-preview-title').textContent = preview.title || 'Vérifier avant de modifier'
      get('gr-preview-target').textContent = preview.targetLabel
      get('gr-preview-message').textContent = preview.message
      showChanges(get('gr-changes'), preview.changes)
      confirm.checked = false
      get('gr-correction-feedback').textContent =
        'Aperçu prêt. Rien n’a encore été modifié dans NocoDB.'
      get('gr-preview-title').focus()
    } catch (error) {
      get('gr-correction-feedback').textContent = (error as Error).message
    } finally {
      busy = false
      refresh.disabled = false
      get<HTMLButtonElement>('gr-save').disabled = false
    }
  })
  get('gr-apply').addEventListener('click', async () => {
    if (busy || !preview) return
    if (!confirm.checked) {
      get('gr-correction-feedback').textContent =
        'Relisez les changements, puis cochez la confirmation pour les appliquer.'
      confirm.focus()
      return
    }
    const operation = preview
    lastOperation = { id: operation.id, hash: operation.hash }
    preview = null
    busy = true
    refresh.disabled = true
    get<HTMLButtonElement>('gr-apply').disabled = true
    get('gr-correction-feedback').textContent =
      'Application de la correction et vérification dans NocoDB…'
    try {
      const result = await api({
        action: 'confirm-correction',
        operationId: operation.id,
        planHash: operation.hash,
        confirmed: true,
      })
      get('gr-preview').hidden = true
      form.hidden = true
      showResult(result)
      get('gr-correction-feedback').textContent = result.message
      get('gr-result-title').focus()
    } catch (error) {
      get('gr-preview').hidden = true
      form.hidden = true
      showResult({ state: 'uncertain', message: (error as Error).message })
      get('gr-correction-feedback').textContent =
        'Le résultat est incertain. Utilisez « Vérifier le résultat » ; ne relancez pas la correction.'
    } finally {
      busy = false
      refresh.disabled = false
      get<HTMLButtonElement>('gr-apply').disabled = false
    }
  })
  get('gr-check-result').addEventListener('click', async () => {
    if (busy || !lastOperation) return
    busy = true
    refresh.disabled = true
    get<HTMLButtonElement>('gr-check-result').disabled = true
    try {
      const result = await api({
        action: 'check-correction',
        operationId: lastOperation.id,
        planHash: lastOperation.hash,
      })
      showResult(result)
      get('gr-correction-feedback').textContent = result.message
    } catch (error) {
      get('gr-correction-feedback').textContent = (error as Error).message
    } finally {
      busy = false
      refresh.disabled = false
      get<HTMLButtonElement>('gr-check-result').disabled = false
    }
  })
  refresh.addEventListener('click', load)
  filter.addEventListener('change', renderList)
  search.addEventListener('input', renderList)
  void load()
}
