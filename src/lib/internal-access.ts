import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

type AccessEnvironment = Record<string, string | undefined>
const keySets = new Map<string, JWTVerifyGetKey>()
const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Type': 'text/plain; charset=utf-8',
}

/** Validate Access at the origin too: a pages.dev URL must never bypass login. */
export async function requireInternalAccess(
  request: Request,
  env: AccessEnvironment,
  keyResolver?: JWTVerifyGetKey,
): Promise<Response | null> {
  const identity = await readInternalIdentity(request, env, keyResolver)
  return identity instanceof Response ? identity : null
}

export async function readInternalIdentity(
  request: Request,
  env: AccessEnvironment,
  keyResolver?: JWTVerifyGetKey,
): Promise<{ email: string } | Response> {
  const domain = env.INTERNAL_ACCESS_DOMAIN?.trim()
  const audience = env.INTERNAL_ACCESS_AUD?.trim()
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience) {
    return new Response(
      'Cet espace interne n’est pas encore disponible. Contactez votre administrateur.',
      { status: 503, headers: privateHeaders },
    )
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token)
    return new Response('Connectez-vous avec votre compte autorisé pour consulter cet espace.', {
      status: 403,
      headers: privateHeaders,
    })
  try {
    const issuer = `https://${domain}`
    let keys = keyResolver ?? keySets.get(issuer)
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
        timeoutDuration: 5000,
      })
      keySets.set(issuer, keys)
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'email'],
    })
    if (typeof payload.email !== 'string' || !payload.email.trim())
      throw new Error('Missing identity')
    return { email: payload.email.trim().toLowerCase() }
  } catch {
    return new Response(
      'Votre accès est absent ou a expiré. Reconnectez-vous avec votre compte autorisé.',
      { status: 403, headers: privateHeaders },
    )
  }
}
