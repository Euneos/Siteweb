import { jeton } from './nocodb'
import { lireCartePublique } from './public-network'
import { readPublicNetworkSnapshot } from './public-network-store'
import type { WorkspaceDatabase } from './internal-workspace'

/** Identical public data and editorial filters on every page embedding the maps. */
export async function lireCartesPage(locals: unknown) {
  const token = jeton(locals)
  if (!token) return null
  const runtime = (locals as {runtime?: {env?: Record<string, unknown>; ctx?: {waitUntil(work:Promise<unknown>):void}}}).runtime
  const env = runtime?.env ?? {}
  try {
    const load = () => lireCartePublique(token, env.RESOURCE_NETWORK_LOCATIONS, env.RESOURCE_NETWORK_RESIDENCES)
    const snapshot = env.TEAM_WORKSPACE ? await readPublicNetworkSnapshot(env.TEAM_WORKSPACE as WorkspaceDatabase,load,{
      background:runtime?.ctx ? work => runtime.ctx!.waitUntil(work) : undefined,
    }) : {data:await load(),refreshedAt:Date.now()}
    const data = snapshot.data
    return {
      locations: data.locations,
      periods: data.periods.map(p => ({key:p.key,label:p.cohort,locations:p.locations})),
      trainerLocations: data.trainerLocations,
      updatedAt: new Date(snapshot.refreshedAt).toISOString(),
    }
  } catch { return null }
}
export type PublicMaps = NonNullable<Awaited<ReturnType<typeof lireCartesPage>>>
