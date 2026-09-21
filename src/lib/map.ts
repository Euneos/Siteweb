import { lireToutes, reconcilierActifs } from './nocodb'
import reference from '../data/map-communes.json?raw'
import projections from '../data/map-projections.json'

/** Public reference only: full French commune directory, no client mapping or contacts. */
type Commune = [
  code: string,
  name: string,
  postcodes: string[],
  lon: number | null,
  lat: number | null,
  department: string,
]
const directory = JSON.parse(reference) as { retrieved: string; source: string; rows: Commune[] }
const byPostcode = new Map<string, Commune[]>()
for (const commune of directory.rows)
  for (const postcode of commune[2]) {
    const rows = byPostcode.get(postcode) ?? []
    rows.push(commune)
    byPostcode.set(postcode, rows)
  }
export const normalizeCity = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/[^a-z0-9]/g, '')
export type Location = {
  code: string
  name: string
  territory: string
  lon: number
  lat: number
  x: number
  y: number
}
export type MapGroup = {
  key: string
  establishmentId: number | null
  establishmentKnown: boolean
  name: string
  type: string
  city: string
  postcode: string
  cohortId: number | null
  cohortLabel: string
  cohortKnown: boolean
  participations: { id: number; code: string; status: string }[]
  location: Location | null
  issue: string | null
}
export type MapData = {
  groups: MapGroup[]
  cohorts: { id: number; label: string; active: boolean }[]
  defaultCohort: string
  updatedAt: string
  referenceDate: string
  totals: {
    participations: number
    establishments: number
    groups: number
    located: number
    unlocated: number
    duplicateGroups: number
    orphanParticipations: number
  }
}
type Row = Record<string, unknown> & { Id: number }
const value = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
const id = (x: unknown) => (typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null)
// Legacy imports store postal codes as numeric strings (e.g. "06000" → "6000.0").
// Restore formatting only; a nonzero fraction or other text is never rounded or guessed.
export function normalizePostcode(raw: unknown): string {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 99999)
    return String(raw).padStart(5, '0')
  const text = value(raw)
  return /^\d{4,5}(?:\.0+)?$/.test(text) ? text.split('.')[0].padStart(5, '0') : text
}
const cohortLabel = (row: Row) =>
  value(row.nom) ||
  (id(row.annee_debut) && id(row.annee_fin)
    ? `${row.annee_debut}–${row.annee_fin}`
    : `Cohorte #${row.Id} · nom non renseigné`)

/** Both public municipality name and postal code must agree; never pick a fuzzy first hit.
 * NocoDB lat/lng and street addresses are deliberately neither read nor interpreted. */
export function locateCommune(
  city: string,
  postcode: string,
): { location: Location | null; issue: string | null } {
  if (!city || !postcode) return { location: null, issue: 'Ville ou code postal non renseigné' }
  if (!/^\d{5}$/.test(postcode))
    return { location: null, issue: 'Code postal à vérifier (5 chiffres attendus)' }
  const candidates = (byPostcode.get(postcode) ?? []).filter(
    (row) => normalizeCity(row[1]) === normalizeCity(city),
  )
  if (candidates.length !== 1)
    return {
      location: null,
      issue:
        candidates.length > 1
          ? 'Correspondance communale ambiguë'
          : 'Ville et code postal sans correspondance exacte dans le référentiel',
    }
  const [code, name, , lon, lat, department] = candidates[0]
  if (lon === null || lat === null || !Number.isFinite(lon) || !Number.isFinite(lat))
    return { location: null, issue: 'Centre de commune absent du référentiel' }
  const territory = department.length === 2 ? 'metropole' : department
  const projection = projections.find((p) => p.id === territory)
  if (!projection)
    return {
      location: null,
      issue: 'Territoire hors des fonds disponibles · conservé dans la liste',
    }
  const x = projection.ox + (lon - projection.minLon) * projection.cos * projection.scale
  const y = projection.oy + (projection.maxLat - lat) * projection.scale
  if (x < 0 || x > 1000 || y < 0 || y > 650)
    return { location: null, issue: 'Centre communal hors du cadre · à vérifier' }
  return { location: { code, name, territory, lon, lat, x, y }, issue: null }
}
function validateRows(rows: Row[]) {
  if (
    !Array.isArray(rows) ||
    rows.some((row) => !row || !id(row.Id)) ||
    new Set(rows.map((r) => r.Id)).size !== rows.length
  )
    throw new Error('Lecture NocoDB incohérente')
}
export function buildMapData(
  cohorts: Row[],
  participations: Row[],
  establishments: Row[],
): MapData {
  return buildActiveMapData(
    cohorts,
    reconcilierActifs(participations, ['etablissements_id', 'cohortes_id']),
    establishments,
  )
}
/** Internal assembly: API rows have already been reconciled by lireToutes. */
function buildActiveMapData(cohorts: Row[], participations: Row[], establishments: Row[]): MapData {
  for (const rows of [cohorts, establishments]) validateRows(rows)
  const cohortById = new Map(cohorts.map((row) => [row.Id, row]))
  const establishmentById = new Map(establishments.map((row) => [row.Id, row]))
  const groups = new Map<string, MapGroup>()
  for (const participation of participations) {
    const establishmentId = id(participation.etablissements_id)
    const cohortId = id(participation.cohortes_id)
    const school = establishmentId ? establishmentById.get(establishmentId) : undefined
    const cohort = cohortId ? cohortById.get(cohortId) : undefined
    // Unknown cohorts/establishments cannot prove that two records belong together.
    const key = school && cohort ? `${school.Id}:${cohort.Id}` : `unresolved:${participation.Id}`
    let group = groups.get(key)
    if (!group) {
      const city = value(school?.ville)
      const postcode = normalizePostcode(school?.cp)
      const geographic = school
        ? locateCommune(city, postcode)
        : { location: null, issue: 'Établissement absent ou non relié' }
      group = {
        key,
        establishmentId,
        establishmentKnown: !!school,
        name: value(school?.nom) || 'Établissement non renseigné',
        type: value(school?.type_etab),
        city,
        postcode,
        cohortId,
        cohortLabel: cohort ? cohortLabel(cohort) : 'Cohorte non renseignée ou introuvable',
        cohortKnown: !!cohort,
        participations: [],
        ...geographic,
      }
      groups.set(key, group)
    }
    group.participations.push({
      id: participation.Id,
      code: value(participation.code) || `Dossier #${participation.Id}`,
      status: value(participation.statut) || 'Non renseigné',
    })
  }
  const result = [...groups.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'fr') || a.cohortLabel.localeCompare(b.cohortLabel, 'fr'),
  )
  const active = cohorts.filter((c) => c.active === true || c.active === 1)
  const located = result.filter((group) => group.location !== null).length
  return {
    groups: result,
    cohorts: cohorts
      .map((row) => ({
        id: row.Id,
        label: cohortLabel(row),
        active: row.active === true || row.active === 1,
      }))
      .sort((a, b) => b.label.localeCompare(a.label, 'fr')),
    defaultCohort: active.length === 1 ? String(active[0].Id) : '',
    updatedAt: new Date().toISOString(),
    referenceDate: directory.retrieved,
    totals: {
      participations: participations.length,
      establishments: new Set(
        result.filter((g) => g.establishmentKnown).map((g) => g.establishmentId),
      ).size,
      groups: result.length,
      located,
      unlocated: result.length - located,
      duplicateGroups: result.filter((g) => g.participations.length > 1).length,
      orphanParticipations: result
        .filter(
          (g) => !g.cohortKnown || !g.establishmentId || !establishmentById.has(g.establishmentId),
        )
        .reduce((n, g) => n + g.participations.length, 0),
    },
  }
}
export async function readMapData(token: string): Promise<MapData> {
  // Reuse the existing reader, including its complete pagination; only allowlisted fields.
  const [cohorts, participations, establishments] = await Promise.all([
    lireToutes(token, 'cohortes', 'Id,nom,annee_debut,annee_fin,active'),
    lireToutes(token, 'participations', 'Id,code,statut,etablissements_id,cohortes_id'),
    lireToutes(token, 'etablissements', 'Id,nom,type_etab,ville,cp'),
  ])
  return buildActiveMapData(cohorts, participations, establishments)
}
