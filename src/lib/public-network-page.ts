import { jeton } from './nocodb'
import { lireCartePublique } from './public-network'

/** Identical public data and editorial filters on every page embedding the maps. */
export async function lireCartesPage(locals: unknown) {
  const token = jeton(locals)
  if (!token) return null
  const env = (locals as {runtime?: {env?: Record<string, unknown>}}).runtime?.env ?? {}
  try {
    const data = await lireCartePublique(token, env.RESOURCE_NETWORK_LOCATIONS, env.RESOURCE_NETWORK_RESIDENCES)
    return {
      locations: data.locations,
      periods: data.periods.map(p => ({key:p.key,label:p.cohort,locations:p.locations})),
      trainerLocations: data.trainerLocations,
    }
  } catch { return null }
}
export type PublicMaps = NonNullable<Awaited<ReturnType<typeof lireCartesPage>>>
