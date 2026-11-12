import { lireToutes, reconcilierActifs } from './nocodb'
import { locateCommune, normalizeCity, normalizePostcode } from './map'
import reference from '../data/map-communes.json?raw'
import { networkTerritories as projections, networkPlaces, locateNetworkPlace } from '../data/network-territories'

type Row = Record<string, unknown> & { Id: number }
type Commune = [string, string, string[], number | null, number | null, string]
const communes = (JSON.parse(reference) as { rows: Commune[] }).rows
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

// Private deployment configuration, not a second public address book in Git.
// Keys are dossier ids; only confirmed commune codes / broad territories are accepted.
export type NetworkLocations = Record<string, { commune: string } | { territory: string } | { outside: string } | { place: string }>
export function lireLocalisationsConfirmees(raw: unknown): NetworkLocations {
  if (raw === undefined || raw === '') return {}
  if (typeof raw !== 'string') throw new Error('Configuration réseau invalide')
  const parsed = JSON.parse(raw)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Configuration réseau invalide')
  for (const [key, entry] of Object.entries(parsed)) {
    if (!/^[1-9]\d*$/.test(key) || !entry || typeof entry !== 'object' || Object.keys(entry).length !== 1)
      throw new Error('Localisation réseau invalide')
    const item = entry as Record<string, unknown>
    if ('commune' in item && typeof item.commune === 'string' && communes.some(row => row[0] === item.commune)) continue
    if ('territory' in item && projections.some(p => p.id === item.territory)) continue
    if ('place' in item && typeof item.place === 'string' && Object.hasOwn(networkPlaces, item.place)) continue
    if ('outside' in item && typeof item.outside === 'string' && item.outside.trim() && item.outside.length <= 120) continue
    throw new Error('Localisation réseau invalide')
  }
  return parsed
}

function confirmedLocation(entry: NetworkLocations[string]) {
  if ('place' in entry) {
    const location = locateNetworkPlace(entry.place)
    const territory = projections.find(p => p.id === location.territory)!
    return { location, issue: null, localisation: `${location.name}, ${territory.label}` }
  }
  if ('outside' in entry) return { location: null, issue: `Hors de France : ${entry.outside}`, localisation: entry.outside }
  if ('commune' in entry) {
    const commune = communes.find(row => row[0] === entry.commune)!
    return { ...locateCommune(commune[1], commune[2][0]), localisation: commune[1] }
  }
  const p = projections.find(p => p.id === entry.territory)!
  // A broad marker is explicitly distinct from a municipality centre.
  return {
    location: { code: `territory:${p.id}`, name: p.label, territory: p.id, x: 500, y: 325 },
    issue: null,
    localisation: `${p.label} — repère territorial, commune non précisée`,
  }
}

/** Municipality centres only. Without a postcode, a unique exact city is required. */
export function localiserFormateur(city: string, postcode: unknown) {
  const cp = normalizePostcode(postcode)
  // Generic Paris postal notation: the displayed location remains the city centre,
  // not the 1st arrondissement or a fabricated street address.
  if (normalizeCity(city) === 'paris' && cp === '75000') return locateCommune('Paris', '75001')
  if (cp) return locateCommune(city, cp)
  const matches = communes.filter(row => normalizeCity(row[1]) === normalizeCity(city))
  if (matches.length !== 1) return {
    location: null,
    issue: matches.length > 1 ? 'Ville homonyme : code postal nécessaire' : 'Commune française à préciser',
  }
  return locateCommune(matches[0][1], matches[0][2][0] ?? '')
}

/** Residence-based network for one explicitly selected status; server-side only. */
function construireReseauParStatut(personnes: Row[], parcours: Row[], locations: NetworkLocations = {}, residences: NetworkLocations = {}, statut: 'Formateur validé' | 'En cours de formation' = 'Formateur validé') {
  const people = new Map(personnes.map(person => [person.Id, person]))
  if (people.size !== personnes.length) throw new Error('Identités formateurs ambiguës')
  const current = reconcilierActifs(parcours, ['formateurs_id', 'cohortes_id'], ['cohortes_id'])
  const validated = new Map<number, Row[]>()
  for (const dossier of current) {
    if (text(dossier.statut) !== statut) continue
    const personId = Number(dossier.formateurs_id)
    validated.set(personId, [...(validated.get(personId) ?? []), dossier])
  }
  const members = []
  for (const [personId, dossiers] of validated) {
    const person = people.get(personId)
    if (!person || !text(person.nom)) throw new Error('Identité formateur absente')
    // One person, regardless of the number or years of validated paths.
    // Conflicting residence overrides still require a human decision.
    const overrides = dossiers.map(d => locations[String(d.Id)]).filter(Boolean)
    const residence = residences[String(person.Id)]
    if (!residence && new Set(overrides.map(entry => JSON.stringify(entry))).size > 1)
      throw new Error('Localisations confirmées contradictoires pour une personne')
    const confirmed = residence ?? overrides[0]
    const city = text(person.ville)
    members.push({
      id: person.Id,
      nom: [text(person.prenom), text(person.nom)].filter(Boolean).join(' '),
      statut,
      etat: statut === 'Formateur validé' ? 'valide' as const : 'en_formation' as const,
      localisation: city,
      // Only the person's residence fields, never missions or school locations.
      ...(confirmed ? confirmedLocation(confirmed) : localiserFormateur(city, person.cp)),
    })
  }
  members.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
  return { members, updatedAt: new Date().toISOString() }
}

/** Resource directory: explicit validation only; public trainee counts use a separate reader. */
export function construireReseauFormateurs(personnes: Row[], parcours: Row[], locations: NetworkLocations = {}, residences: NetworkLocations = {}) {
  const network = construireReseauParStatut(personnes, parcours, locations, residences)
  return { ...network, members: network.members.map(m => ({ ...m, statut: 'Formateur validé' as const, etat: 'valide' as const })) }
}

/** Separate public map scope: does not expand the validated resource directory. */
export function construireCartePubliqueFormateurs(personnes: Row[], parcours: Row[], locations: NetworkLocations = {}, residences: NetworkLocations = {}) {
  const formed = construireReseauParStatut(personnes, parcours, locations, residences)
  const training = construireReseauParStatut(personnes, parcours, locations, residences, 'En cours de formation')
  const formedIds = new Set(formed.members.map(m => m.id))
  return { members: [...formed.members, ...training.members.filter(m => !formedIds.has(m.id))], updatedAt: formed.updatedAt }
}

export async function lireCartePubliqueFormateurs(token: string, rawLocations?: unknown, rawResidences?: unknown) {
  const [people, paths] = await Promise.all([
    lireToutes(token, 'formateurs', 'Id,nom,prenom,ville,cp'),
    lireToutes(token, 'engagements', 'Id,statut,formateurs_id,cohortes_id,fusionne_vers'),
  ])
  return construireCartePubliqueFormateurs(people, paths, lireLocalisationsConfirmees(rawLocations), lireLocalisationsConfirmees(rawResidences))
}

export type ReseauFormateurs = ReturnType<typeof construireReseauFormateurs>

export async function lireReseauFormateurs(token: string, rawLocations?: unknown, rawResidences?: unknown) {
  const [people, paths] = await Promise.all([
    lireToutes(token, 'formateurs', 'Id,nom,prenom,ville,cp'),
    lireToutes(token, 'engagements', 'Id,statut,formateurs_id,cohortes_id,fusionne_vers'),
  ])
  return construireReseauFormateurs(people, paths, lireLocalisationsConfirmees(rawLocations), lireLocalisationsConfirmees(rawResidences))
}
