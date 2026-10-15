import type { APIRoute } from 'astro'
import { getInternalContext, privateJson, internalError } from '../../../lib/internal-context'
import { GET as conventionGet, POST as conventionPost, PUT as conventionPut } from './conventions-mission'
export const prerender = false
export const GET: APIRoute = async (context) => {
  if (new URL(context.request.url).searchParams.get('convention') === '1') return conventionGet(context)
  try {
    const { request, locals } = context
    const auth = await getInternalContext(request, locals, true)
    if (auth instanceof Response) return auth
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
