import { defineMiddleware } from 'astro:middleware'

const HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next()
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(HEADERS)) headers.set(name, value)
  if (/^\/(?:suivi|api\/suivi)(?:\/|$)/.test(new URL(context.request.url).pathname)) {
    headers.set('Referrer-Policy', 'no-referrer')
    headers.set('Cache-Control', 'private, no-store, max-age=0')
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
})
