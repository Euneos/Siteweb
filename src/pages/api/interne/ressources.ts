import type { APIRoute } from 'astro'
import { getInternalContext, privateJson, internalError } from '../../../lib/internal-context'
import { GET as conventionGet, POST as conventionPost, PUT as conventionPut } from './conventions-mission'
import { internalEnvironment } from '../../../lib/internal-context'
import { jeton } from '../../../lib/nocodb'
import { lireReseauFormateurs } from '../../../lib/reseau-formateurs'
export const prerender = false
export const GET: APIRoute = async (context) => {
  if (new URL(context.request.url).searchParams.get('convention') === '1') return conventionGet(context)
  try {
    const { request, locals } = context
    const auth = await getInternalContext(request, locals, true)
    if (auth instanceof Response) return auth
    if (new URL(request.url).searchParams.get('reseau') === '1') {
      const token = jeton(locals)
      if (!token) return privateJson({ error: 'La carte du réseau est temporairement indisponible.' }, 503)
      return privateJson(await lireReseauFormateurs(token, internalEnvironment(locals).RESOURCE_NETWORK_LOCATIONS))
    }
    const { results } = await auth.db
      .prepare(
        'SELECT id,title,category,description,url FROM workspace_resources WHERE published=1 ORDER BY category,title',
      )
      .bind()
      .all()
    return privateJson({ resources: results, identity: auth.identity })
  } catch (error) {
    return internalError(error)
  }
}
export const POST: APIRoute = async (context) =>
  new URL(context.request.url).searchParams.get('convention') === '1'
    ? conventionPost(context)
    : new Response('Opération inconnue.', { status: 404 })
export const PUT: APIRoute = async (context) =>
  new URL(context.request.url).searchParams.get('convention') === '1'
    ? conventionPut(context)
    : new Response('Opération inconnue.', { status: 404 })
