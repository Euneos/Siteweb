import type { BoardDashboard } from '../lib/board-dashboard'
import projections from '../data/map-projections.json'
import type { BoardReport } from '../lib/board-report'

type Resource = { title: string; category: string; description: string; url: string }
type Dashboard = BoardDashboard & { resources: Resource[] | null; report: BoardReport | null }
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element
}
const frDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
function bars(id: string, values: { label: string; count: number }[], total: number) {
  el(id).replaceChildren(...values.map(v => {
    const row = node('div', '', 'ca-bar'), label = node('div', '', 'ca-bar-label')
    label.append(node('span', v.label), node('strong', String(v.count)))
    const track = node('div', '', 'ca-bar-track'), fill = node('div', '', 'ca-bar-fill')
    track.setAttribute('aria-hidden', 'true'); fill.style.width = `${total ? v.count / total * 100 : 0}%`
    track.append(fill); row.append(label, track); return row
  }))
}
function pills(id: string, values: [number, string][]) {
  el(id).replaceChildren(...values.map(([n, label]) => {
    const p = node('p', '', 'ca-pill'); p.append(node('strong', String(n)), document.createTextNode(label)); return p
  }))
}
function maps(data: Pick<Dashboard, 'locations'>, prefix = 'ca', unit = 'établissement(s) engagé(s)') {
  const mapEl = <T extends HTMLElement = HTMLElement>(id: string) => el<T>(id.replace(/^ca-/, `${prefix}-`))
  let territory = 'metropole'
  function render() {
    const schools = data.locations.filter(s => s.location?.territory === territory)
    const projection = projections.find(p => p.id === territory)!
    mapEl<HTMLImageElement>('ca-map-image').src = `/maps/${territory}.svg`
    function list(items: typeof schools, title: string) {
      mapEl('ca-map-selection').textContent = title
      mapEl('ca-map-count').textContent = `${items.length} ${unit}`
      mapEl('ca-map-schools').replaceChildren(...items.map(s => node('li', `${s.name} · ${s.city}`)))
      if (!items.length) mapEl('ca-map-schools').append(node('li', 'Aucun repère localisé sur ce territoire.'))
    }
    list(schools, projection.label)
    mapEl('ca-map-all').hidden = true
    mapEl('ca-map-all').onclick = render
    mapEl('ca-map-tabs').replaceChildren(...projections.map(p => {
      const count = data.locations.filter(s => s.location?.territory === p.id).length
      const button = node('button', `${p.label} · ${count}`, 'iw-button')
      button.type = 'button'; button.setAttribute('aria-pressed', String(p.id === territory))
      button.onclick = () => { territory = p.id; render() }
      return button
    }))
    const communes = new Map<string, typeof schools>()
    for (const s of schools) communes.set(s.location!.code, [...(communes.get(s.location!.code) ?? []), s])
    mapEl('ca-markers').replaceChildren(...[...communes.values()].map(items => {
      const first = items[0], point = first.location!
      const b = node('button', '', 'ca-map-marker'); b.type = 'button'
      b.style.left = `${point.x / 10}%`; b.style.top = `${point.y / 6.5}%`
      b.setAttribute('aria-label', `${first.city} : ${items.length} ${unit}`)
      b.setAttribute('aria-pressed', 'false'); b.append(node('span', String(items.length)))
      b.onclick = () => {
        mapEl('ca-markers').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button === b)))
        list(items, first.city); mapEl('ca-map-all').hidden = false
      }
      return b
    }))
  }
  render()
  const unlocated = data.locations.filter(s => !s.location)
  mapEl('ca-unlocated-title').textContent = `${unlocated.length} localisation(s) à préciser`
  mapEl('ca-unlocated').replaceChildren(...unlocated.map(s => node('li', `${s.name} · ${s.city || 'Commune non renseignée'}`)))
}
function render(data: Dashboard) {
  const history = data
  data = { ...data, ...data.periods.find(p => p.cohort === '2026–2027')! }
  const report = data.report
  el('ca-report').hidden = !report
  if (report) {
    el('ca-report-date').textContent = `Situation au ${frDate(report.asOf)}`
    el('ca-report-engaged').textContent = String(report.engagedSites)
    el('ca-report-applications-total').textContent = String(report.applications)
    el('ca-report-applications').textContent = `${report.applicationsInProgress} en cours de candidature · objectif : ${report.goalSchools} engagés`
    el<HTMLProgressElement>('ca-report-progress').max = report.goalSchools
    el<HTMLProgressElement>('ca-report-progress').value = report.engagedSites
    el('ca-report-professionals').textContent = String(report.review?.professionals ?? report.professionals)
    el('ca-report-professional-scope').textContent = report.review ? `2026–2027 uniquement · minimum documenté au ${frDate(report.review.asOf)} · listes partielles` : `Sur ${report.professionalSites} sites · listes partielles · objectif annuel : ${report.goalPeople} formés`
    el('ca-review').hidden = !report.review
    if (report.review) {
      el('ca-review-applications').textContent = report.review.applicationsNote
      el('ca-review-people').textContent = report.review.detail
    }
    el('ca-report-december').textContent = String(report.confirmedBeforeDecember)
    el('ca-report-started').textContent = `${report.started} démarrés · ${report.confirmedBeforeDecember - report.started} autres démarrages confirmés avant fin décembre`
    el('ca-report-regions').textContent = String(report.regions)
    el('ca-report-next').textContent = report.nextStep
    el('ca-developments').hidden = false
    el('ca-developments-list').replaceChildren(...report.developments.map(item => {
      const card = node('article', '', 'ca-resource'); card.append(node('h3', item.title), node('p', item.detail)); return card
    }))
    el('ca-report-schedule').replaceChildren(...report.schedule.map(group => {
      const card = node('article', '', 'ca-report-group'); card.append(node('h3', `${group.title} · ${group.count}`))
      const list = node('ul')
      for (const item of group.items) { const li = node('li', item.name); li.append(node('small', item.timing)); list.append(li) }
      card.append(list); return card
    }))
  }
  el('ca-engaged').textContent = String(data.engaged)
  el('ca-engaged-scope').textContent = data.cohort
  el('ca-scope-note').textContent = `${data.periods.map(p => `${p.cohort} : ${p.engaged} établissements engagés`).join(' · ')}. Total dédoublonné sur les deux années ; unités de la base, distinctes des sites du point d’étape.`
  el('ca-total').textContent = String(data.statuses.filter(s => !['Abandon', 'Refus'].includes(s.label)).reduce((sum, s) => sum + s.count, 0))
  el('ca-people').textContent = String(data.trainers.people)
  el('ca-evaluation').textContent = String(data.trainers.inProgress)
  el('ca-evaluation-detail').textContent = `${data.evaluation.requested} demande(s) explicite(s) d’évaluation jeunes sur ${data.evaluation.total} dossier(s) engagé(s) en 2026–2027.`
  document.getElementById('ca-science-review')?.remove()
  if (report?.review) {
    const note = node('p', report.review.evaluation, 'iw-small'); note.id = 'ca-science-review'
    el('ca-evaluation-detail').after(note)
  }
  bars('ca-pipeline', data.statuses, data.total)
  el('ca-unqualified').textContent = data.unqualified ? `${data.unqualified} dossier(s) avec une décision non renseignée ou à qualifier, hors des cinq barres.` : 'Les cinq statuts de candidature sont représentés ci-dessus.'
  const signals: string[] = []
  if (data.schedule.unknownStart) signals.push(`${data.schedule.unknownStart} dossier(s) engagé(s) sans date de début exploitable.`)
  if (data.attention.missingDocuments) signals.push(`${data.attention.missingDocuments} dossier(s) engagé(s) de 2026–2027 dont les deux justificatifs ne sont pas confirmés dans la base.`)
  if (data.attention.applicationsOver30Days) signals.push(`${data.attention.applicationsOver30Days} candidature(s) reçue(s) depuis au moins 30 jours, sans décision enregistrée.`)
  if (data.attention.duplicateSchools) signals.push(`${data.attention.duplicateSchools} dossier(s) engagé(s) supplémentaire(s) ou sans établissement identifié : le compteur de 30 reste dédoublonné par établissement.`)
  if (data.unqualified) signals.push(`${data.unqualified} décision(s) de candidature à qualifier.`)
  if (!signals.length) signals.push('Aucun signal détecté sur les justificatifs, dates de début et candidatures anciennes contrôlés ici.')
  el('ca-attention').replaceChildren(...signals.map(s => node('li', s)))
  bars('ca-training-statuses', data.trainingStatuses, data.engagedDossiers)
  if (!data.trainingStatuses.length) el('ca-training-statuses').textContent = 'Aucun dossier engagé dans cette cohorte.'
  pills('ca-schedule', [[data.schedule.pastStart, 'date de début passée'], [data.schedule.futureStart, 'date de début à venir'], [data.schedule.unknownStart, 'date à préciser']])
  el('ca-upcoming').replaceChildren(...data.upcoming.map(item => {
    const li = node('li'); const time = node('time', frDate(item.date)); time.dateTime = item.date
    li.append(time, node('span', item.name)); return li
  }))
  if (!data.upcoming.length) el('ca-upcoming').append(node('li', 'Aucun prochain démarrage renseigné.'))
  pills('ca-trainer-summary', [[data.trainers.people, 'formateurs validés'], [data.trainers.inValidation, 'en cours de validation'], [data.trainers.inTraining, 'en cours de formation']])
  bars('ca-trainer-promotions', data.trainers.promotions, data.trainers.people)
  el('ca-trainer-scope').textContent = `${data.trainers.unscoped} parcours validé(s) sans lien à une cohorte d’établissements restent inclus dans le réseau. Les promotions antérieures sont conservées.`
  maps(history)
  maps({ locations: data.trainerLocations }, 'ct', 'formateur(s) validé(s)')
  const resources = el('ca-resource-list'); resources.replaceChildren()
  if (data.resources === null) resources.append(node('p', 'La liste complète n’a pas pu être chargée. Le lien direct vers les supports de formation reste disponible ci-dessus.'))
  else if (!data.resources.length) resources.append(node('p', 'Aucune ressource publiée accessible dans cette vue.'))
  else {
    const more = node('details')
    more.append(node('summary', `Voir les ${Math.max(0, data.resources.length - 6)} autres ressources`))
    const extra = node('div', '', 'ca-resources'); more.append(extra)
    for (const [index, r] of data.resources.entries()) {
    const card = node('article', '', 'ca-resource')
    const link = node('a', `${r.title} ↗`); link.href = r.url; link.target = '_blank'; link.rel = 'noopener noreferrer'
    card.append(node('p', r.category, 'iw-eyebrow'), link, node('p', r.description, 'iw-small'))
      if (index < 6) resources.append(card)
      else extra.append(card)
    }
    if (data.resources.length > 6) resources.append(more)
  }
  el('ca-updated').textContent = `Base consultée le ${new Date(data.readAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (heure de Paris) · Les données évoluent avec les saisies de l’équipe.`
}
async function load() {
  const button = el<HTMLButtonElement>('ca-refresh'); button.disabled = true
  el('ca-data').hidden = true; el('ca-data').setAttribute('aria-busy', 'true')
  el('ca-state').hidden = false; el('ca-state').textContent = 'Chargement de la synthèse…'
  try {
    const response = await fetch('/api/interne/ca', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Lecture impossible')
    const data: Dashboard = await response.json()
    const select = el<HTMLSelectElement>('ca-period')
    select.replaceChildren(new Option('2025–2026 et 2026–2027', 'all'), ...data.periods.map(p => new Option(p.cohort, p.key)))
    select.onchange = () => maps(data.periods.find(p => p.key === select.value) ?? data)
    render(data)
    el('ca-data').hidden = false; el('ca-data').setAttribute('aria-busy', 'false'); el('ca-state').hidden = true
  } catch {
    el('ca-updated').textContent = 'Lecture non confirmée.'
    el('ca-state').textContent = 'La synthèse n’a pas pu être chargée intégralement. Aucun total partiel n’est affiché. Actualisez ou reconnectez-vous.'
  } finally { button.disabled = false }
}
el('ca-refresh')?.addEventListener('click', load)
if (el('ca-app')) load()
