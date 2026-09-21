import type { APIRoute } from 'astro'
import {
  getInternalContext,
  privateJson,
  internalError,
  readInternalBody,
  entryId,
} from '../../../lib/internal-context'
import { safeLink, WorkspaceError } from '../../../lib/internal-workspace'
export const prerender = false
export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // Team audience ONLY. Never accept the trainer/resource audience here.
    const context = await getInternalContext(request, locals, false)
    if (context instanceof Response) return context
    if (!context.identity.admin)
      throw new WorkspaceError(403, 'Seul un responsable peut ajouter une ressource.')
    const body = await readInternalBody(request)
    for (const key of ['title', 'category', 'description']) {
      if (
        typeof body[key] !== 'string' ||
        (body[key] as string).length > (key === 'description' ? 4000 : 180)
      )
        throw new WorkspaceError(400, 'Ressource invalide.')
    }
    if (!(body.title as string).trim() || !(body.category as string).trim())
      throw new WorkspaceError(400, 'Titre et catégorie requis.')
    const url = safeLink(body.url)
    if (!url) throw new WorkspaceError(400, 'Lien requis.')
    const id = entryId(body.requestId)
    const data = {
      title: (body.title as string).trim(),
      category: (body.category as string).trim(),
      description: (body.description as string).trim(),
      url,
      updated_by: context.identity.email,
    }
    const saved = await context.db
      .prepare(
        'INSERT INTO workspace_resources (id,title,category,description,url,published,updated_by) VALUES (?,?,?,?,?,1,?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(id, data.title, data.category, data.description, url, data.updated_by)
      .run()
    if (saved.meta.changes !== 1) {
      const existing = await context.db
        .prepare(
          'SELECT title,category,description,url,updated_by FROM workspace_resources WHERE id=?',
        )
        .bind(id)
        .first<Record<string, unknown>>()
      if (!existing || Object.entries(data).some(([k, v]) => existing[k] !== v))
        throw new WorkspaceError(409, 'Cette demande existe déjà avec une autre ressource.')
    }
    return privateJson({ id }, 201)
  } catch (error) {
    return internalError(error)
  }
}
