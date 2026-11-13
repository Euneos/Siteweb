import { writeFile } from 'node:fs/promises'
import { openAgenda, sealAgenda } from './lib/agenda-envelope'
import { d1Http } from '../src/lib/d1-http'
import {
  listAgenda,
  lastAgendaCheck,
  importAgendaEvent,
  parseEventFacts,
} from '../src/lib/event-agenda'
import { entryId } from '../src/lib/internal-context'
export async function processAgendaRequest(db: Parameters<typeof listAgenda>[0], request: any) {
  if (!request || !['list', 'import'].includes(request.operation))
    throw new Error('Opération invalide')
  if (request.operation === 'import') {
    if (!Array.isArray(request.events) || request.events.length > 30)
      throw new Error('Lot invalide')
    const entries = request.events.map((r: any) => ({
      event: parseEventFacts(r.event),
      existingId: r.existingId ? entryId(r.existingId) : undefined,
    }))
    for (const e of entries) await importAgendaEvent(db, e.event, e.existingId)
    const source = request.source || {}
    const count =
      Number.isSafeInteger(source.messagesCount) && source.messagesCount >= 0
        ? source.messagesCount
        : null
    const start =
      typeof source.windowStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.windowStart)
        ? source.windowStart
        : ''
    const end =
      typeof source.windowEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.windowEnd)
        ? source.windowEnd
        : ''
    if (source.complete === true)
      await db
        .prepare(
          'INSERT INTO event_agenda_sync_runs(id,window_start,window_end,newsletters_count,events_count) VALUES(?,?,?,?,?)',
        )
        .bind(request.requestId || crypto.randomUUID(), start, end, count, entries.length)
        .run()
  }
  return { events: await listAgenda(db, true), checkedAt: await lastAgendaCheck(db) }
}
if (import.meta.main) {
  try {
    const env = process.env
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main')
      throw new Error('Contexte non autorisé')
    const request: any = openAgenda(
      JSON.parse(env.AGENDA_ENVELOPE || ''),
      env.AGENDA_IMPORT_PRIVATE_KEY || '',
    )
    if (request.requestId !== env.AGENDA_REQUEST_ID || !/^[a-f0-9-]{36}$/.test(request.requestId))
      throw new Error('Requête invalide')
    if (typeof request.replyKey !== 'string' || request.replyKey.length > 2000)
      throw new Error('Clé de réponse invalide')
    const db = d1Http(
      env.CLOUDFLARE_ACCOUNT_ID!,
      'b178cff0-1860-4929-b697-d7152b32b53f',
      env.CLOUDFLARE_API_TOKEN!,
    )
    const result = await processAgendaRequest(db, request)
    await writeFile(
      'agenda-response.enc.json',
      JSON.stringify(sealAgenda({ ...result, requestId: request.requestId }, request.replyKey)),
      { mode: 0o600 },
    )
    console.log(
      'Synchronisation chiffrée de l’agenda vérifiée. Aucun contenu de fiche dans les journaux.',
    )
  } catch {
    console.error('Synchronisation non confirmée. Relire l’agenda avant toute nouvelle tentative.')
    process.exitCode = 1
  }
}
