import frenchTerritories from './map-projections.json'

// Public geography only. Keep this extension separate from the schools' map.
export const networkTerritories = [
  ...frenchTerritories,
  {
    id: 'BE', label: 'Belgique', minLon: 2.513573, maxLat: 51.475024,
    cos: 0.635, scale: 220, ox: 245, oy: 105,
    source: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
  },
]

export const networkPlaces: Record<string, { name: string; territory: string; lon: number; lat: number; source: string }> = {
  'BE-11002': {
    name: 'Anvers', territory: 'BE', lon: 4.3997222222222225, lat: 51.221111111111114,
    source: 'https://www.wikidata.org/wiki/Q12892',
  },
}

export function locateNetworkPlace(code: string) {
  const place = networkPlaces[code]
  if (!place) throw new Error('Localité réseau inconnue')
  const p = networkTerritories.find(p => p.id === place.territory)!
  return {
    code, name: place.name, territory: place.territory, lon: place.lon, lat: place.lat,
    x: p.ox + (place.lon - p.minLon) * p.cos * p.scale,
    y: p.oy + (p.maxLat - place.lat) * p.scale,
  }
}
