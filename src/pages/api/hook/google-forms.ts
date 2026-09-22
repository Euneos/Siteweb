import type { APIRoute } from 'astro';
import { modeApercu } from '../../../lib/forms';
import { submissionDatabase } from '../../../lib/candidature-store';
import { digest, parseGoogleFormEvent, parseGoogleFormSources, planGoogleForm, syncGoogleForm } from '../../../lib/google-form-sync';

export const prerender = false;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function configuration(request: Request, locals: unknown) {
  if (modeApercu(request)) return reply({ code: 'preview_disabled' }, 404);
  const env = (locals as { runtime?: { env?: Record<string, unknown> } })?.runtime?.env ?? {};
  const secret = env.GOOGLE_FORMS_SYNC_SECRET;
  const received = request.headers.get('x-google-forms-secret') ?? '';
  if (typeof secret !== 'string' || secret.length < 32 || received.length > 256) return reply({ code: 'unauthorized' }, 401);
  const a = await digest(secret), b = await digest(received);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (difference) return reply({ code: 'unauthorized' }, 401);
  const db = submissionDatabase(locals);
  if (!db || typeof env.NOCODB_TOKEN !== 'string' || !env.NOCODB_TOKEN) return reply({ code: 'configuration_missing' }, 503);
  try {
    const sources = parseGoogleFormSources(String(env.GOOGLE_FORMS_SYNC_SOURCES ?? ''));
    await db.prepare('SELECT event_key FROM google_form_events LIMIT 1').bind().first();
    await db.prepare('SELECT target_id FROM google_form_locks LIMIT 1').bind().first();
    return { db, sources, token: env.NOCODB_TOKEN, mode: env.GOOGLE_FORMS_SYNC_MODE === 'apply' ? 'apply' : 'plan' };
  } catch { return reply({ code: 'configuration_missing' }, 503); }
}

/** Side-effect-free preflight. Only authenticated callers learn readiness. */
export const GET: APIRoute = async ({ request, locals }) => {
  const config = await configuration(request, locals);
  return config instanceof Response ? config : reply({ version: 1, ready: true, mode: config.mode, cohortId: 2, sources: config.sources.length });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const config = await configuration(request, locals);
  if (config instanceof Response) return config;
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply({ code: 'json_required' }, 415);
  // Bound actual streamed bytes, not only the optional Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) return reply({ code: 'payload_invalid' }, 400);
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_768) { await reader.cancel(); return reply({ code: 'payload_too_large' }, 413); }
      parts.push(value);
    }
    const data = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.byteLength; }
    const event = parseGoogleFormEvent(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)));
    const sourceConfig = config.sources.find(s => s.spreadsheetId === event.source.spreadsheetId && s.sheetId === event.source.sheetId && s.kind === event.kind && s.cohortId === event.cohortId);
    if (!sourceConfig || event.source.row < sourceConfig.firstRow)
      return reply({ code: 'source_not_allowed' }, 403);
    try {
      // Fail safe until the operator has reviewed real before/after plans.
      // A caller may force plan mode, never force apply over server configuration.
      if (config.mode !== 'apply' || request.headers.get('x-google-forms-mode') === 'plan')
        return reply(await planGoogleForm({ ...config, event, sourceConfig }));
      const result = await syncGoogleForm({ ...config, event, sourceConfig });
      return reply(result, result.state === 'retryable' ? 503 : result.state === 'processing' ? 202 : 200);
    } catch { return reply({ code: 'storage_unavailable' }, 503); }
  } catch { return reply({ code: 'payload_invalid' }, 400); }
};
