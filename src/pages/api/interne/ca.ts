import type { APIRoute } from 'astro'
import { readBoardIdentity } from '../../../lib/board-access'
import { internalEnvironment, privateJson, privateHeaders } from '../../../lib/internal-context'
import type { WorkspaceDatabase } from '../../../lib/internal-workspace'
import { boardResources, readBoardDashboard } from '../../../lib/board-dashboard'
import { jeton } from '../../../lib/nocodb'
import { readBoardReport } from '../../../lib/board-report'
export const prerender = false
export const GET: APIRoute = async ({ request, locals }) => {
  const identity = await readBoardIdentity(request, locals)
  if (identity instanceof Response) return identity
  const visual = new URL(request.url).searchParams.get('visual')
  if (visual !== null) {
    if (!['1', '2'].includes(visual)) return new Response('Visuel introuvable.', { status: 404, headers: privateHeaders })
    try {
      const storage = internalEnvironment(locals).CA_VISUALS as { get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null> } | undefined
      const image = await storage?.get(`deploiement-2026-11-07-${visual}`, 'arrayBuffer')
      if (!image) return new Response('Visuel indisponible.', { status: 503, headers: privateHeaders })
      return new Response(image, { headers: { ...privateHeaders, 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff' } })
    } catch {
      return new Response('Visuel indisponible.', { status: 503, headers: privateHeaders })
    }
  }
  const token = jeton(locals)
  if (!token) return privateJson({ error: 'La synthèse est momentanément indisponible.' }, 503)
  try {
    const dashboard = await readBoardDashboard(token)
    let resources = null
    try {
      const db = internalEnvironment(locals).TEAM_WORKSPACE as WorkspaceDatabase | undefined
      if (db) {
        const { results } = await db.prepare('SELECT title,category,description,url FROM workspace_resources WHERE published=1 ORDER BY category,title').bind().all<Record<string, unknown>>()
        resources = boardResources(results)
      }
    } catch { /* The independently unavailable catalogue is not an empty catalogue. */ }
    return privateJson({ ...dashboard, resources, report: readBoardReport(internalEnvironment(locals).BOARD_PROGRESS_REPORT) })
  } catch {
    return privateJson({ error: 'La base n’a pas pu être lue intégralement. Aucun total partiel n’est affiché. Réessayez dans un instant.' }, 503)
  }
}
export const ALL: APIRoute = () => new Response('Lecture seule.', { status: 405, headers: { ...privateHeaders, Allow: 'GET' } })
