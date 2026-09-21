import { readInternalIdentity } from './internal-access'
import {
  WorkspaceError,
  type WorkspaceDatabase,
  type WorkspaceIdentity,
} from './internal-workspace'

type RuntimeEnvironment = Record<string, unknown>
export function internalEnvironment(locals: unknown): RuntimeEnvironment {
  return (locals as { runtime?: { env?: RuntimeEnvironment } })?.runtime?.env ?? {}
}
export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
}
export const privateJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateHeaders })

/** Team and trainer policies have separate Access audiences. A trainer token
 * cannot reach the team calendars or the applications table. */
export async function getInternalContext(
  request: Request,
  locals: unknown,
  resourceAccess = false,
): Promise<{ identity: WorkspaceIdentity; db: WorkspaceDatabase; teamMember: boolean } | Response> {
  const env = internalEnvironment(locals)
  const team = await readInternalIdentity(request, env as Record<string, string>)
  let identity = team
  const teamMember = !(team instanceof Response)
  if (!teamMember && resourceAccess) {
    identity = await readInternalIdentity(request, {
      INTERNAL_ACCESS_DOMAIN: env.RESOURCE_ACCESS_DOMAIN as string | undefined,
      INTERNAL_ACCESS_AUD: env.RESOURCE_ACCESS_AUD as string | undefined,
    })
  }
  if (identity instanceof Response) return identity
  if (!env.TEAM_WORKSPACE)
    return privateJson(
      {
        error:
          'Cet espace est en préparation. Les données existantes restent dans leur outil actuel.',
      },
      503,
    )
  const admins =
    typeof env.INTERNAL_ADMIN_EMAILS === 'string'
      ? env.INTERNAL_ADMIN_EMAILS.split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []
  return {
    teamMember,
    identity: { email: identity.email, admin: teamMember && admins.includes(identity.email) },
    db: env.TEAM_WORKSPACE as WorkspaceDatabase,
  }
}
export async function readInternalBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get('Origin') !== new URL(request.url).origin ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new WorkspaceError(403, 'Rechargez cette page avant de réessayer.')
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    throw new WorkspaceError(415, 'Format de formulaire non pris en charge.')
  if (Number(request.headers.get('Content-Length') ?? '0') > 40000)
    throw new WorkspaceError(413, 'Formulaire trop volumineux.')
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > 40000)
    throw new WorkspaceError(413, 'Formulaire trop volumineux.')
  try {
    const body = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Not an object')
    return body
  } catch {
    throw new WorkspaceError(400, 'Formulaire invalide.')
  }
}
export function internalError(error: unknown) {
  if (error instanceof WorkspaceError) return privateJson({ error: error.message }, error.status)
  // Database errors may include SQL or private input: never send them to the browser.
  console.error(
    '[interne] opération indisponible',
    error instanceof Error ? error.name : 'UnknownError',
  )
  return privateJson(
    {
      error:
        'L’opération n’a pas pu être confirmée. Conservez votre saisie et rechargez avant de réessayer.',
    },
    503,
  )
}
export function entryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
    throw new WorkspaceError(400, 'Identifiant invalide.')
  return value
}
