import type { BrevoEnv } from './brevo'

const encoder = new TextEncoder()
async function key(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function studyToken(email: string, secret: string, now = Date.now()) {
  const payload = btoa(JSON.stringify({ email, expires: now + 7 * 24 * 60 * 60 * 1000 }))
  return `${payload}.${hex(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload)))}`
}
export async function studyEmail(token: string, secret: string, now = Date.now()): Promise<string | null> {
  try {
    const [payload, signature, extra] = token.split('.')
    if (extra || !payload || !/^[a-f0-9]{64}$/.test(signature ?? '')) return null
    const bytes = Uint8Array.from(signature.match(/../g)!, (pair) => parseInt(pair, 16))
    if (!await crypto.subtle.verify('HMAC', await key(secret), bytes, encoder.encode(payload))) return null
    const data = JSON.parse(atob(payload))
    return typeof data.email === 'string' && data.expires > now ? data.email : null
  } catch { return null }
}
export async function studySubscriber(email: string, env: BrevoEnv) {
  const lists = [env.BREVO_LIST_ETABLISSEMENT, env.BREVO_LIST_FORMATEUR, env.BREVO_LIST_PARTENAIRE, env.BREVO_LIST_ENJEUX].map(Number)
  const response = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    headers: { 'api-key': env.BREVO_API_KEY! }, signal: AbortSignal.timeout(12_000),
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error('Vérification de l’inscription indisponible')
  const data = await response.json() as { listIds?: number[]; emailBlacklisted?: boolean }
  return data.emailBlacklisted !== true && Array.isArray(data.listIds) && data.listIds.some(id => lists.includes(id))
}
