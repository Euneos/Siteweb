import { lireToutes, reconcilierActifs } from './nocodb'
import { locateCommune, normalizeCity, normalizePostcode } from './map'
import reference from '../data/map-communes.json?raw'
import { networkTerritories as projections, networkPlaces, locateNetworkPlace } from '../data/network-territories'

type Row = Record<string, unknown> & { Id: number }
type Commune = [string, string, string[], number | null, number | null, string]
const communes = (JSON.parse(reference) as { rows: Commune[] }).rows
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const states = {
  'Formateur validé': 'valide',
  'En cours de formation': 'formation',
  'Formateur en cours de validation': 'validation',
} as const

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

/** A candidacy, invitation or signed agreement never proves training/validation. */
export function construireReseauFormateurs(personnes: Row[], parcours: Row[], locations: NetworkLocations = {}) {
  const people = new Map(personnes.map(person => [person.Id, person]))
  if (people.size !== personnes.length) throw new Error('Identités formateurs ambiguës')
  const current = reconcilierActifs(parcours, ['formateurs_id', 'cohortes_id'], ['cohortes_id'])
  const seen = new Set<number>()
  const members = []
  for (const dossier of current) {
    const statut = text(dossier.statut)
    if (!Object.hasOwn(states, statut)) continue
    const person = people.get(Number(dossier.formateurs_id))
    if (!person || !text(person.nom)) throw new Error('Identité formateur absente')
    // Never choose a promotion/status silently when two active paths disagree.
    if (seen.has(person.Id)) throw new Error('Plusieurs parcours actifs à qualifier pour une personne')
    seen.add(person.Id)
    const promotion = text(dossier.promotion)
    const year = /\b(20\d{2})\b/.exec(promotion)?.[1] ?? ''
    const city = text(person.ville)
    members.push({
      id: dossier.Id,
      nom: [text(person.prenom), text(person.nom)].filter(Boolean).join(' '),
      ville: city,
      promotion,
      annee: year,
      statut,
      etat: states[statut as keyof typeof states],
      localisation: city,
      // Unknown promotion is visible in the list, never assigned to a guessed year.
      ...(year
        ? locations[String(dossier.Id)] ? confirmedLocation(locations[String(dossier.Id)]) : localiserFormateur(city, person.cp)
        : { location: null, issue: 'Promotion à préciser' }),
    })
  }
  members.sort((a, b) => a.annee.localeCompare(b.annee) || a.nom.localeCompare(b.nom, 'fr'))
  return { members, updatedAt: new Date().toISOString() }
}

export type ReseauFormateurs = ReturnType<typeof construireReseauFormateurs>

export async function lireReseauFormateurs(token: string, rawLocations?: unknown) {
  const [people, paths] = await Promise.all([
    lireToutes(token, 'formateurs', 'Id,nom,prenom,ville,cp'),
    lireToutes(token, 'engagements', 'Id,statut,promotion,formateurs_id,cohortes_id,fusionne_vers'),
  ])
  return construireReseauFormateurs(people, paths, lireLocalisationsConfirmees(rawLocations))
}
