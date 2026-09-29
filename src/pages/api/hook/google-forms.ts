import type { APIRoute } from 'astro'
import { modeApercu } from '../../../lib/forms'
import { submissionDatabase } from '../../../lib/candidature-store'
import {
  digest,
  parseGoogleFormEvent,
  validateGoogleFormPayload,
  parseGoogleFormSources,
  planGoogleForm,
  syncGoogleForm,
} from '../../../lib/google-form-sync'

export const prerender = false
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  })
async function configuration(request: Request, locals: unknown) {
  const env = (locals as { runtime?: { env?: Record<string, unknown> } })?.runtime?.env ?? {}
  // Legacy credentials alone can never reactivate the retired endpoint.
  if (env.GOOGLE_FORMS_TRANSITION_ENABLED !== 'true') return reply({ code: 'legacy_retired' }, 410)
  if (modeApercu(request)) return reply({ code: 'preview_disabled' }, 404)
  const secret = env.GOOGLE_FORMS_SYNC_SECRET
  const received = request.headers.get('x-google-forms-secret') ?? ''
  if (
    typeof secret !== 'string' ||
    secret.length < 32 ||
    secret.length > 256 ||
    received.length > 256
  )
    return reply({ code: 'unauthorized' }, 401)
  const a = await digest(secret),
    b = await digest(received)
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  if (difference) return reply({ code: 'unauthorized' }, 401)
  const db = submissionDatabase(locals)
  const mode = env.GOOGLE_FORMS_TRANSITION_MODE ?? 'plan'
  if (!db || !['plan', 'capture', 'apply'].includes(String(mode)))
    return reply({ code: 'configuration_missing' }, 503)
  const token = typeof env.NOCODB_TOKEN === 'string' ? env.NOCODB_TOKEN : ''
  if (mode !== 'capture' && !token) return reply({ code: 'configuration_missing' }, 503)
  try {
    const sources = parseGoogleFormSources(String(env.GOOGLE_FORMS_SYNC_SOURCES ?? ''))
    await db.prepare('SELECT event_key FROM google_form_events LIMIT 1').bind().first()
    await db.prepare('SELECT target_id FROM google_form_locks LIMIT 1').bind().first()
    await db
      .prepare('SELECT target_id,link_hash FROM operational_submission_locks LIMIT 1')
      .bind()
      .first()
    await db
      .prepare('SELECT capture_key FROM google_form_transition_captures LIMIT 1')
      .bind()
      .first()
    return { db, sources, token, mode: mode as 'plan' | 'capture' | 'apply' }
  } catch {
    return reply({ code: 'configuration_missing' }, 503)
  }
}

/** Authenticated preflight with no network or persistence side effects. */
export const GET: APIRoute = async ({ request, locals }) => {
  const config = await configuration(request, locals)
  return config instanceof Response
    ? config
    : reply({
        version: 1,
        ready: true,
        mode: config.mode,
        cohortId: 2,
        sources: config.sources.length,
      })
}
export const POST: APIRoute = async ({ request, locals }) => {
  const config = await configuration(request, locals)
  if (config instanceof Response) return config
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    return reply({ code: 'json_required' }, 415)
  const reader = request.body?.getReader()
  if (!reader) return reply({ code: 'payload_invalid' }, 400)
  const parts: Uint8Array[] = []
  let length = 0
  let rawPayload: string, event: ReturnType<typeof parseGoogleFormEvent>
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 32_768) {
        await reader.cancel()
        return reply({ code: 'payload_too_large' }, 413)
      }
      parts.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const part of parts) {
      bytes.set(part, offset)
      offset += part.byteLength
    }
    rawPayload = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    event = parseGoogleFormEvent(JSON.parse(rawPayload))
    validateGoogleFormPayload({ event, rawPayload })
  } catch {
    return reply({ code: 'payload_invalid' }, 400)
  }
  const sourceConfig = config.sources.find(
    (s) =>
      s.spreadsheetId === event.source.spreadsheetId &&
      s.sheetId === event.source.sheetId &&
      s.kind === event.kind &&
      s.cohortId === event.cohortId,
  )
  if (!sourceConfig || event.source.row < sourceConfig.firstRow)
    return reply({ code: 'source_not_allowed' }, 403)
  try {
    const input = { ...config, event, rawPayload, sourceConfig }
    // Only plan can be requested by the caller; capture cannot escalate to apply.
    if (config.mode === 'plan' || request.headers.get('x-google-forms-mode') === 'plan') {
      if (!config.token) return reply({ code: 'configuration_missing' }, 503)
      return reply(await planGoogleForm(input))
    }
    const result = await syncGoogleForm({ ...input, mode: config.mode })
    return reply(
      result,
      result.state === 'retryable' ? 503 : result.state === 'processing' ? 202 : 200,
    )
  } catch {
    return reply({ code: 'storage_unavailable' }, 503)
  }
}
