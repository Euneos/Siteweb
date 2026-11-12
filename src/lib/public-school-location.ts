import reference from '../data/map-communes.json?raw'
import confirmed from '../data/public-school-communes.json'
import { locateCommune, normalizeCity } from './map'
const communes = (JSON.parse(reference) as { rows: [string,string,string[],number|null,number|null,string][] }).rows
/** Publicly verified school + city pairs only; never guess between homonymous cities. */
export function publicSchoolLocation<T extends {name: string; city: string; location: unknown}>(school: T): T {
  if (school.location) return school
  const match = confirmed.find(entry => normalizeCity(entry.school) === normalizeCity(school.name) && normalizeCity(entry.city) === normalizeCity(school.city))
  const commune = match && communes.find(row => row[0] === match.commune)
  if (!commune) return school
  const { location } = locateCommune(commune[1], commune[2][0])
  return location ? { ...school, city: commune[1], location: {code:location.code, territory:location.territory, x:location.x, y:location.y} } : school
}
