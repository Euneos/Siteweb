import { writeFile } from 'node:fs/promises'
import { openAgenda, sealAgenda } from './lib/agenda-envelope'
import { watchD1 } from './lib/watch-d1'
import { listWatch, parseWatchFacts, saveWatch, watchWeek } from '../src/lib/thematic-watch'
export async function processWatchRequest(db: Parameters<typeof listWatch>[0], request: any) {
  if (!request || !['list', 'import'].includes(request.operation))
    throw new Error('Opération invalide')
  const results = []
  if (request.operation === 'import') {
    if (!Array.isArray(request.items) || request.items.length > 10) throw new Error('Lot invalide')
    const coverage = request.source?.coverage
    if (coverage !== undefined && (typeof coverage !== 'string' || coverage.length > 3000))
      throw new Error('Bilan invalide')
    // Validate the complete selection before any write. An import cannot edit an
    // existing card, finish an usage, or change agenda data through this transport.
    for (const item of request.items) {
      parseWatchFacts(item, true)
      watchWeek(item.week)
      if (
        item.event ||
        !['LinkedIn', 'newsletter reçue', 'recherche web'].includes(item.provenance)
      )
        throw new Error('Import invalide')
    }
    for (const item of request.items)
      results.push(
        await saveWatch(db, item, 'Veille EUNEOS', {
          automated: true,
          provenance: item.provenance,
        }),
      )
    if (coverage && request.items.length)
      await db
        .prepare('INSERT OR IGNORE INTO thematic_watch_runs(id,week,coverage) VALUES(?,?,?)')
        .bind(request.requestId || crypto.randomUUID(), request.items[0].week, coverage)
        .run()
  }
  return { items: await listWatch(db, true), results }
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
    if (
      request.requestId !== env.AGENDA_REQUEST_ID ||
      !/^[a-f0-9-]{36}$/.test(request.requestId) ||
      typeof request.replyKey !== 'string' ||
      request.replyKey.length > 2000
    )
      throw new Error('Requête invalide')
    const db = watchD1(
      env.CLOUDFLARE_ACCOUNT_ID!,
      'b178cff0-1860-4929-b697-d7152b32b53f',
      env.CLOUDFLARE_API_TOKEN!,
    )
    const result = await processWatchRequest(db, request)
    await writeFile(
      'veille-response.enc.json',
      JSON.stringify(sealAgenda({ ...result, requestId: request.requestId }, request.replyKey)),
      { mode: 0o600 },
    )
    console.log('Veille vérifiée. Aucun contenu de fiche dans les journaux.')
  } catch {
    console.error('Synchronisation non confirmée. Relire la veille avant une nouvelle tentative.')
    process.exitCode = 1
  }
}
