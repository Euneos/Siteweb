import type { APIRoute } from 'astro'
import { lireCartesPage } from '../../lib/public-network-page'
export const prerender = false
export const GET: APIRoute = async ({locals,url}) => {
  const kind = url.searchParams.get('carte')
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0'}
  if (kind !== 'school' && kind !== 'trainer') return new Response('null',{status:400,headers})
  const maps = await lireCartesPage(locals)
  if (!maps) return new Response('null',{status:503,headers})
  return new Response(JSON.stringify(kind === 'school' ? {locations:maps.locations,periods:maps.periods} : {locations:maps.trainerLocations}),{headers})
}
