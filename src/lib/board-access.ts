import type { JWTVerifyGetKey } from 'jose'
import { readInternalIdentity } from './internal-access'
import { internalEnvironment, privateHeaders } from './internal-context'

/** A third audience, never accepted by team or trainer endpoints. No role escalation. */
export async function readBoardIdentity(request: Request, locals: unknown, keys?: JWTVerifyGetKey) {
  const env = internalEnvironment(locals) as Record<string, string | undefined>
  const team = await readInternalIdentity(request, env, keys)
  if (!(team instanceof Response)) return team
  // Misconfiguration must not silently make a trainer audience a board audience.
  if (!env.BOARD_ACCESS_AUD || [env.INTERNAL_ACCESS_AUD, env.RESOURCE_ACCESS_AUD].includes(env.BOARD_ACCESS_AUD))
    return new Response('L’espace CA est en préparation.', { status: 503, headers: privateHeaders })
  return readInternalIdentity(request, {
    INTERNAL_ACCESS_DOMAIN: env.BOARD_ACCESS_DOMAIN,
    INTERNAL_ACCESS_AUD: env.BOARD_ACCESS_AUD,
  }, keys)
}
