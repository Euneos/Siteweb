import type { APIRoute } from 'astro'
import { requireInternalAccess } from '../../../lib/internal-access'
import { jeton } from '../../../lib/nocodb'
import { readMapData } from '../../../lib/map'
export const prerender = false
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
}
export const GET: APIRoute = async ({ request, locals }) => {
  const env = (locals as { runtime?: { env?: Record<string, string> } }).runtime?.env ?? {}
  const denied = await requireInternalAccess(request, env)
  if (denied) return denied
  const token = jeton(locals)
  if (!token)
    return Response.json(
      { error: 'La lecture de la base est indisponible. Contactez un responsable.' },
      { status: 503, headers },
    )
  try {
    return Response.json(await readMapData(token), { headers })
  } catch {
    return Response.json(
      { error: 'La base n’a pas pu être lue intégralement. Réessayez dans un instant.' },
      { status: 503, headers },
    )
  }
}
