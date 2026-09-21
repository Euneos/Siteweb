import type { APIRoute } from 'astro'
import { getInternalContext, privateJson, internalError } from '../../../lib/internal-context'
export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  try {
    const context = await getInternalContext(request, locals, true)
    if (context instanceof Response) return context
    const { results } = await context.db
      .prepare(
        'SELECT id,title,category,description,url FROM workspace_resources WHERE published=1 ORDER BY category,title',
      )
      .bind()
      .all()
    return privateJson({ resources: results, identity: context.identity })
  } catch (error) {
    return internalError(error)
  }
}
