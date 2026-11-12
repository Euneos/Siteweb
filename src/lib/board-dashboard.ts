import { schoolDisplayName } from './school-display-name'
import { lireToutes, reconcilierActifs } from './nocodb'
import { locateCommune, normalizePostcode } from './map'
import projections from '../data/map-projections.json'
import { STATUTS_CANDIDATURE, valeurStatutCandidature, justificatifsEngagementPresents } from './statut-candidature'

type Row = Record<string, unknown> & { Id: number }
const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const checked = (v: unknown) => v === true || v === 1
const date = (v: unknown) => {
  const s = text(v)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : null
}

/** Server-only allowlist. No notes, contact details, signatures or personal trainer records. */
function buildBoardPeriod(cohorts: Row[], raw: Row[], establishments: Row[], trainers: Row[], now = new Date(), selectedCohort: number | null = null) {
  const matching = cohorts.filter(c => Number(c.annee_debut) === 2026 && Number(c.annee_fin) === 2027)
  if (matching.length !== 1) throw new Error('Cohorte absente ou ambiguë')
  const cohort = matching[0]
  const included = cohorts.filter(c => [2025, 2026].includes(Number(c.annee_debut)) && Number(c.annee_fin) === Number(c.annee_debut) + 1)
  const rows = reconcilierActifs(raw, ['etablissements_id', 'cohortes_id']).filter(p => selectedCohort === null ? included.some(c => c.Id === p.cohortes_id) : p.cohortes_id === selectedCohort)
  const schoolById = new Map(establishments.map(s => [s.Id, s]))
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
  const engaged = rows.filter(p => valeurStatutCandidature(p.statut) === 'Établissement engagé')
  const schools = [...new Set(engaged.map(p => p.etablissements_id))].filter((id): id is number => typeof id === 'number' && schoolById.has(id))
  const locations = schools.map(id => {
    const s = schoolById.get(id)!
    const { location } = locateCommune(text(s.ville), normalizePostcode(s.cp))
    return { name: schoolDisplayName(text(s.nom)) || 'Établissement sans nom', city: text(s.ville), location: location ? { territory: location.territory, x: location.x, y: location.y, code: location.code } : null }
  }).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  // Trainer promotions, unlike school participations, are usually NOT linked to a cohort.
  // Keep the complete network, with explicit statuses and promotions, in every school view.
  const allTrainers = reconcilierActifs(trainers, ['formateurs_id', 'cohortes_id'], ['cohortes_id'])
  const scopedTrainers = allTrainers.filter(p => text(p.statut) === 'Formateur validé')
  const uniqueTrainers = new Set(scopedTrainers.map(p => p.formateurs_id).filter(id => typeof id === 'number'))
  const statusCounts = STATUTS_CANDIDATURE.map(s => ({ label: s.label, count: rows.filter(p => valeurStatutCandidature(p.statut) === s.label).length }))
  const upcoming = engaged.filter(p => date(p.date_debut_formation) && date(p.date_debut_formation)! >= today)
    .sort((a, b) => text(a.date_debut_formation).localeCompare(text(b.date_debut_formation)))
    .slice(0, 6).map(p => ({ date: date(p.date_debut_formation)!, name: schoolDisplayName(text(schoolById.get(Number(p.etablissements_id))?.nom)) || 'Établissement à préciser' }))
  return {
    cohort: selectedCohort === null ? '2025–2026 et 2026–2027' : selectedCohort === cohort.Id ? '2026–2027' : '2025–2026', goal: 30, readAt: now.toISOString(), total: rows.length,
    engaged: schools.length, engagedDossiers: engaged.length,
    statuses: statusCounts, unqualified: rows.length - statusCounts.reduce((n, s) => n + s.count, 0),
    locations, upcoming,
    schedule: {
      pastStart: engaged.filter(p => date(p.date_debut_formation) && date(p.date_debut_formation)! < today).length,
      futureStart: engaged.filter(p => date(p.date_debut_formation) && date(p.date_debut_formation)! >= today).length,
      unknownStart: engaged.filter(p => !date(p.date_debut_formation)).length,
    },
    trainingStatuses: [...new Set(engaged.map(p => text(p.statut_formation)))].sort().map(label => ({ label: label || 'Non renseigné', count: engaged.filter(p => text(p.statut_formation) === label).length })),
    evaluation: { requested: engaged.filter(p => checked(p.evaluation_jeunes_demandee) || text(p.evaluation_jeunes_demandee) === 'Oui').length, total: engaged.length },
    trainers: { people: uniqueTrainers.size, dossiers: scopedTrainers.length, agreements: new Set(scopedTrainers.filter(p => checked(p.accord_signe)).map(p => p.formateurs_id).filter(id => typeof id === 'number')).size,
      unscoped: scopedTrainers.filter(p => p.cohortes_id == null).length,
      inTraining: new Set(allTrainers.filter(p => text(p.statut) === 'En cours de formation').map(p => p.formateurs_id).filter(id => typeof id === 'number')).size,
      inValidation: new Set(allTrainers.filter(p => text(p.statut) === 'Formateur en cours de validation').map(p => p.formateurs_id).filter(id => typeof id === 'number')).size,
      inProgress: new Set(allTrainers.filter(p => ['En cours de formation', 'Formateur en cours de validation'].includes(text(p.statut))).map(p => p.formateurs_id).filter(id => typeof id === 'number')).size,
      promotions: [...new Set(scopedTrainers.map(p => text(p.promotion)))].sort().map(label => ({ label: label || 'Promotion à préciser', count: new Set(scopedTrainers.filter(p => text(p.promotion) === label).map(p => p.formateurs_id).filter(id => typeof id === 'number')).size })),
    },
    attention: {
      missingDocuments: engaged.filter(p => p.cohortes_id === cohort.Id && !justificatifsEngagementPresents({ fiche_contact_recue: p.fiche_contact_recue, lettre_interet_signee: p.lettre_interet_signee })).length,
      missingLocations: locations.filter(s => !s.location).length,
      duplicateSchools: engaged.filter(p => !schoolById.has(Number(p.etablissements_id))).length + [...new Set(engaged.map(p => `${p.etablissements_id}:${p.cohortes_id}`))].reduce((n, key) => n + Math.max(0, engaged.filter(p => `${p.etablissements_id}:${p.cohortes_id}` === key).length - 1), 0),
      applicationsOver30Days: rows.filter(p => p.cohortes_id === cohort.Id && valeurStatutCandidature(p.statut) === 'Candidature reçue' && date(p.date_candidature) && (now.getTime() - Date.parse(date(p.date_candidature)!)) / 86400000 >= 30).length,
    },
  }
}
export function buildBoardDashboard(cohorts: Row[], raw: Row[], establishments: Row[], trainers: Row[], now = new Date(), trainerPeople: Row[] = []) {
  for (const year of [2025, 2026]) if (cohorts.filter(c => Number(c.annee_debut) === year && Number(c.annee_fin) === year + 1).length !== 1) throw new Error('Cohorte absente ou ambiguë')
  const all = buildBoardPeriod(cohorts, raw, establishments, trainers, now)
  const periods = cohorts.filter(c => [2025, 2026].includes(Number(c.annee_debut)) && Number(c.annee_fin) === Number(c.annee_debut) + 1)
    .sort((a, b) => Number(b.annee_debut) - Number(a.annee_debut))
    .map(c => ({ key: String(c.Id), ...buildBoardPeriod(cohorts, raw, establishments, trainers, now, c.Id) }))
  const validated = reconcilierActifs(trainers, ['formateurs_id', 'cohortes_id'], ['cohortes_id']).filter(r => text(r.statut) === 'Formateur validé')
  const trainerLocations = [...new Set(validated.map(r => r.formateurs_id))].map(id => {
    const person = trainerPeople.find(p => p.Id === id)
    const city = text(person?.ville)
    const { location } = locateCommune(city, normalizePostcode(person?.cp))
    const territory = projections.find(p => p.label === text(person?.region))
    const regional = !location && territory ? { territory: territory.id, x: 500, y: 325, code: `region-${territory.id}` } : null
    return { name: [...new Set(validated.filter(r => r.formateurs_id === id).map(r => text(r.promotion) || 'Promotion à préciser'))].join(' / '), city: regional ? `${text(person?.region)} · repère régional, commune à préciser` : city,
      location: location ? { territory: location.territory, x: location.x, y: location.y, code: location.code } : regional }
  })
  return { ...all, periods, trainerLocations }
}
export type BoardDashboard = ReturnType<typeof buildBoardDashboard>

export async function readBoardDashboard(token: string) {
  const [cohorts, participations, schools, trainers, trainerPeople] = await Promise.all([
    lireToutes(token, 'cohortes', 'Id,annee_debut,annee_fin'),
    lireToutes(token, 'participations', 'Id,statut,date_candidature,date_debut_formation,statut_formation,evaluation_jeunes_demandee,fiche_contact_recue,lettre_interet_signee'),
    lireToutes(token, 'etablissements', 'Id,nom,ville,cp'),
    lireToutes(token, 'engagements', 'Id,accord_signe,statut,promotion'),
    lireToutes(token, 'formateurs', 'Id,ville,cp,region'),
  ])
  return buildBoardDashboard(cohorts, participations, schools, trainers, new Date(), trainerPeople)
}

export function boardResources(rows: Record<string, unknown>[]) {
  return rows.flatMap(row => {
    try {
      const url = new URL(text(row.url))
      if (url.protocol !== 'https:' || url.username || url.password) return []
      // The CA catalogue excludes community invitations, slide decks and their shared folders.
      const label = `${text(row.title)} ${text(row.category)} ${text(row.description)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      if (/(^|\.)whatsapp\.(com|net)$/.test(url.hostname) || url.hostname === 'wa.me') return []
      if (/whats\s*app|\bpptx?\b|powerpoint|diaporama|slides|supports? de formation/.test(label)) return []
      if (/\.(pptx?|ppsx?)(?:$|[?#])/i.test(url.href) || (url.hostname === 'docs.google.com' && url.pathname.startsWith('/presentation/'))) return []
      if (url.hostname === 'drive.google.com' && url.pathname.includes('/folders/')) return []
      // Internal operations are never exposed via a catalogue shortcut.
      if (['euneos.fr', 'www.euneos.fr'].includes(url.hostname) && /^\/(interne|api|etat-candidatures)(\/|$)/.test(url.pathname)) return []
      return [{ title: text(row.title), category: text(row.category), description: text(row.description), url: url.href }]
    } catch { return [] }
  })
}
