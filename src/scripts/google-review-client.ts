import type { reviewView, ReviewTarget, resolveReconciliationTargets } from '../lib/google-review'
import {
  matchesReviewFilter,
  reviewFilters,
  reviewReasonLabel,
} from '../lib/google-review-presentation'
type Row = Awaited<ReturnType<typeof reviewView>> & {
  resolvedTargets?: ReturnType<typeof resolveReconciliationTargets>
  operation?: { state: string; audit_json: string } | null
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
const root = document.querySelector<HTMLElement>('#google-review')
if (root) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const feedback = get('gr-feedback'),
    list = get('gr-list'),
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
  const labels = {
    integrated: 'Intégration attestée par un reçu',
    partial: 'Intégration partielle',
    pending: 'Intégration en attente',
    unknown: 'Intégration non attestée',
  }
  const summary = (row: Row) =>
    `${labels[row.state]}${row.attachment ? ' · Dossier rattaché manuellement' : ''}${row.operation?.state === 'pending' ? ' · Confirmation à vérifier avant toute nouvelle action' : ''}`
  async function api(body?: unknown) {
    const response = await fetch('/api/interne/reponses-google', {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
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
    const query = search.value.trim().toLocaleLowerCase('fr')
    const visible = rows.filter(
      (row) =>
        matchesReviewFilter(row, filter.value) &&
        JSON.stringify([
          row.form,
          row.answers,
          row.rawAnswers,
          row.attachment?.target.label,
          row.resolvedTargets,
        ])
          .toLocaleLowerCase('fr')
          .includes(query),
    )
    const count = document.createElement('p')
    count.textContent = `${visible.length} entrée(s) affichée(s) sur ${rows.length}. Les différentes versions d’une réponse sont conservées.`
    list.append(count)
    for (const row of visible) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'gr-row'
      const title = document.createElement('strong')
      title.textContent = `Réponse #${row.id}`
      const status = document.createElement('span')
      status.textContent = `${row.submittedAt} · ${summary(row)}`
      button.append(title, status)
      button.addEventListener('click', () => {
        if (!busy) open(row)
      })
      list.append(button)
    }
  }
  function open(row: Row) {
    selected = row
    detail.hidden = false
    get('gr-title').textContent = `Réponse #${row.id}`
    get('gr-source-form').textContent = `Formulaire source : ${row.form || 'Non précisé'}`
    get('gr-summary').textContent = summary(row)
    get('gr-reconciliation').hidden = !row.receipt
    const resolved = get('gr-targets')
    resolved.replaceChildren()
    for (const item of row.resolvedTargets ?? []) {
      const li = document.createElement('li')
      li.textContent = `${item.label}${item.fields.length ? ` · Champs attestés : ${[...new Set(item.fields.map((field) => fieldLabels[field] || 'Autre information du dossier'))].join(', ')}` : ''}`
      resolved.append(li)
    }
    get('gr-reasons').textContent = row.receipt?.reasons.map(reviewReasonLabel).join(' · ') ?? ''

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
    target.replaceChildren(new Option('Choisir un dossier exact…', ''))
    for (const t of targets)
      target.add(
        new Option(
          `${t.kind === 'school' ? 'Établissement' : 'Formateur'} · ${t.label}`,
          `${t.kind}:${t.id}`,
        ),
      )
    form.hidden = root!.dataset.admin !== 'true' || !!row.attachment || !!row.operation
    const readonly = get('gr-readonly')
    readonly.hidden = !form.hidden
    readonly.textContent = row.attachment
      ? `Rattachée à : ${row.attachment.target.label}. Les champs métier n’ont pas été modifiés par ce rattachement.`
      : row.operation
        ? 'Une confirmation est déjà enregistrée ou en attente de vérification. Ne renvoyez pas la demande ; faites vérifier ce reçu.'
        : 'Vous pouvez consulter les réponses. La confirmation est réservée aux responsables.'
    get('gr-title').focus()
  }
  target.addEventListener('change', () => {
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
    selected = null
    rows = []
    list.replaceChildren()
    feedback.textContent = 'Lecture des réponses et des dossiers…'
    try {
      const data = await api()
      rows = data.rows
      targets = data.targets
      renderList()
      feedback.textContent =
        'Réponses actualisées. Les mentions d’intégration proviennent des reçus de reprise.'
    } catch (error) {
      feedback.textContent = (error as Error).message
    } finally {
      busy = false
      refresh.disabled = false
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!selected || busy || !form.reportValidity()) return
    const [kind, id] = target.value.split(':')
    busy = true
    refresh.disabled = true
    const controls = Array.from(
      form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
      >('input,select,textarea,button'),
    )
    const body = {
      id: selected.id,
      version: selected.version,
      targetKind: kind,
      targetId: Number(id),
      reason: reason.value,
      confirmed: confirm.checked,
    }
    controls.forEach((el) => (el.disabled = true))
    feedback.textContent = 'Enregistrement du rattachement…'
    try {
      const result = await api(body)
      result.row.resolvedTargets = selected.resolvedTargets
      rows = rows.map((r) => (r.id === result.row.id ? result.row : r))
      renderList()
      open(result.row)
      feedback.textContent = result.message
    } catch (error) {
      feedback.textContent = (error as Error).message
      form.hidden = true
      get('gr-readonly').hidden = false
      get('gr-readonly').textContent =
        'Le résultat doit être vérifié. Actualisez avant de poursuivre ; votre justification est conservée dans le formulaire.'
    } finally {
      busy = false
      refresh.disabled = false
      controls.forEach((el) => (el.disabled = false))
    }
  })
  refresh.addEventListener('click', load)
  filter.addEventListener('change', renderList)
  search.addEventListener('input', renderList)
  void load()
}
