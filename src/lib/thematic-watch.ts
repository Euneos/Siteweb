import { WorkspaceError, safeLink, type WorkspaceDatabase } from './internal-workspace'
import { agendaToday, eventDedupKey, parseEventFacts, type EventFacts } from './event-agenda'
export const watchThemes = [
  'santé mentale',
  'CPS',
  'numérique',
  'jeunes',
  'éducation',
  'relations sociales',
  'émotions',
] as const
export const watchSources = [
  'officielle',
  'scientifique',
  'média',
  'acteur du secteur',
  'terrain-culture',
] as const
export const watchFormats = [
  'Article',
  'Post LinkedIn',
  'Post Instagram',
  'Vidéo',
  'Podcast',
  'Livre',
  'Film / documentaire',
  'Newsletter',
  'Rapport / étude',
  'Webinaire',
  'BD / manga',
  'Autre',
] as const
export function watchFormat(item: {
  format?: string
  link?: string
  legacy?: { columns: string[]; cells: string[] }
}): string {
  if (item.format && watchFormats.includes(item.format as any)) return item.format
  const original = item.legacy?.cells[item.legacy.columns.indexOf('Type')]?.toLowerCase()
  if (original === 'film') return 'Film / documentaire'
  if (original === 'newsletter') return 'Newsletter'
  if (item.link?.includes('instagram.com')) return 'Post Instagram'
  if (item.link?.includes('linkedin.com') || item.link?.includes('lnkd.in')) return 'Post LinkedIn'
  if (original === 'podcast') return 'Podcast'
  if (original === 'article') return 'Article'
  return 'Autre'
}
export const watchOrigins = [
  'LinkedIn',
  'newsletter reçue',
  'recherche web',
  'ajout manuel',
] as const
export const watchUsages = [
  'Post LinkedIn',
  'Encart newsletter',
  'Idée d’édito',
  'Événement',
  'Contact-partenariat',
] as const
export const watchStatuses = ['à faire', 'brouillon', 'fait', 'abandonné'] as const
export type WatchUsage = { name: string; status: string; draft: string }
export type WatchFacts = {
  title: string
  link: string
  summary: string
  for_euneos: string
  connection: string
  source: string
  published_on: string
  publication_label: string
  themes: string[]
  format?: string
  source_type: string
  deadline: string
  needs_primary: boolean
  quotes: string
  relevance: string
  read_note: string
  usages: WatchUsage[]
  event: EventFacts | null
  legacy?: {
    sheet: string
    columns: string[]
    cells: string[]
    updated_by: string
    updated_at: string
  }
}
export type WatchItem = WatchFacts & {
  id: string
  week: string
  provenance: string
  author: string
  protected: number
  version: number
  updated_by: string
  updated_at: string
  deleted_at: string
}
const fail = (s: string): never => {
  throw new WorkspaceError(400, s)
}
const txt = (v: unknown, max: number, required = false): string =>
  typeof v === 'string' && v.length <= max && (!required || !!v.trim())
    ? v.trim()
    : fail('Champ absent ou trop long.')
export function watchDate(v: unknown) {
  const s = txt(v, 10, true)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    s < '1900-01-01' ||
    s > '2200-12-31' ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    fail('Date invalide.')
  return s
}
export function watchWeek(v: unknown) {
  const s = watchDate(v)
  if (new Date(s).getUTCDay() !== 1) fail('La semaine doit commencer un lundi.')
  return s
}
export function currentWatchWeek(today = agendaToday()) {
  const d = new Date(today)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
export function watchLink(v: unknown) {
  const u = new URL(safeLink(txt(v, 2000, true)))
  u.hash = ''
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  for (const k of [...u.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid|trk)$/i.test(k)) u.searchParams.delete(k)
  u.searchParams.sort()
  u.pathname = u.pathname.replace(/\/$/, '') || '/'
  return u.href
}
export function watchKeys(f: WatchFacts) {
  return [
    'url:' + watchLink(f.link),
    'title:' +
      f.title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
  ]
}
export function parseWatchFacts(
  input: unknown,
  automated = false,
  today = agendaToday(),
): WatchFacts {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Fiche invalide.')
  const x = input as Record<string, unknown>
  const themes = x.themes
  if (
    !Array.isArray(themes) ||
    !themes.length ||
    themes.length > 7 ||
    themes.some((t) => !watchThemes.includes(t))
  )
    fail('Choisissez au moins un thème.')
  if (!watchSources.includes(x.source_type as any)) fail('Type de source invalide.')
  if (!Array.isArray(x.usages) || x.usages.length > 5) fail('Usages invalides.')
  const usages = (x.usages as Record<string, unknown>[]).map((u) => {
    if (!u || !watchUsages.includes(u.name as any) || !watchStatuses.includes(u.status as any))
      fail('Usage ou statut invalide.')
    if (automated && !['à faire', 'brouillon'].includes(u.status as string))
      fail('Un import ne peut pas terminer un usage.')
    return { name: u.name as string, status: u.status as string, draft: txt(u.draft ?? '', 6000) }
  })
  if (new Set(usages.map((u) => u.name)).size !== usages.length)
    fail('Un usage est présent deux fois.')
  const published_on = x.published_on ? watchDate(x.published_on) : ''
  if (published_on > today) fail('La date de parution est dans le futur.')
  const relevance = txt(x.relevance ?? '', 1200)
  if (
    automated &&
    (!published_on ||
      published_on < new Date(Date.parse(today) - 15 * 86400000).toISOString().slice(0, 10)) &&
    !relevance
  )
    fail('Justifiez le retour dans l’actualité de ce sujet ancien ou sans date.')
  const read_note = txt(x.read_note ?? '', 2000, automated)
  const event = x.event ? parseEventFacts(x.event, automated ? today : '1900-01-01') : null
  if (usages.some((u) => u.name === 'Événement') && !event)
    fail('Indiquez les informations vérifiées de l’événement pour l’ajouter à l’agenda.')
  return {
    title: txt(x.title, 300, true),
    link: watchLink(x.link),
    summary: txt(x.summary ?? '', 1200, automated),
    for_euneos: txt(x.for_euneos ?? '', 1600, automated),
    connection: txt(x.connection ?? '', 1000),
    source: txt(x.source, 200, true),
    published_on,
    publication_label: txt(x.publication_label ?? '', 160),
    themes: [...new Set(themes as string[])],
    format:
      x.format === undefined
        ? undefined
        : watchFormats.includes(x.format as any)
          ? (x.format as string)
          : fail('Format de ressource invalide.'),
    source_type: x.source_type as string,
    deadline: txt(x.deadline ?? '', 120),
    needs_primary: x.needs_primary === true,
    quotes: txt(x.quotes ?? '', 1600),
    relevance,
    read_note,
    usages,
    event,
  }
}
export const watchUsed = (i: Pick<WatchFacts, 'usages'>) =>
  i.usages.length > 0 && i.usages.every((u) => ['fait', 'abandonné'].includes(u.status))
const hydrate = (r: any): WatchItem => {
  const { payload, ...meta } = r
  return { ...JSON.parse(payload), ...meta }
}
export async function listWatch(db: WorkspaceDatabase, includeDeleted = false) {
  return (
    await db
      .prepare(
        "SELECT * FROM thematic_watch WHERE (?=1 OR deleted_at='') ORDER BY week DESC,updated_at,id",
      )
      .bind(includeDeleted ? 1 : 0)
      .all()
  ).results.map(hydrate)
}
export async function watchSnapshot(db: WorkspaceDatabase) {
  return {
    items: await listWatch(db),
    runs: (
      await db
        .prepare('SELECT * FROM thematic_watch_runs ORDER BY checked_at DESC LIMIT 52')
        .bind()
        .all()
    ).results,
  }
}
export async function saveWatch(
  db: WorkspaceDatabase,
  input: unknown,
  actor: string,
  options: {
    id?: string
    version?: unknown
    automated?: boolean
    provenance?: string
    today?: string
  } = {},
) {
  const today = options.today ?? agendaToday(),
    f = parseWatchFacts(input, !!options.automated, today),
    x = input as Record<string, unknown>,
    week = watchWeek(x.week)
  const keys = watchKeys(f)
  const matches = (
    await db
      .prepare('SELECT DISTINCT item_id FROM thematic_watch_keys WHERE key IN (?,?)')
      .bind(...keys)
      .all<{ item_id: string }>()
  ).results
  // Historical aliases may contain shortened or tracked URLs. Compare normalized keys
  // without rewriting any original source fields or metadata.
  for (const historical of (await listWatch(db, true)).filter((i) => i.legacy)) {
    try {
      if (
        watchKeys(historical).some((k) => keys.includes(k)) &&
        !matches.some((m) => m.item_id === historical.id)
      )
        matches.push({ item_id: historical.id })
    } catch {
      /* A missing old link remains visible for human completion. */
    }
  }
  if (options.automated && matches.length) return { id: matches[0].item_id, skipped: true }
  if (matches.some((m) => m.item_id !== options.id))
    throw new WorkspaceError(
      409,
      'Ce sujet existe déjà, ou a été supprimé et ne sera pas reproposé.',
    )
  const id = options.id ?? crypto.randomUUID()
  let old: WatchItem | undefined
  if (options.id) {
    const r = await db.prepare('SELECT * FROM thematic_watch WHERE id=?').bind(id).first()
    if (!r) throw new WorkspaceError(404, 'Fiche introuvable.')
    old = hydrate(r)
    if (old.deleted_at || old.version !== options.version)
      throw new WorkspaceError(
        409,
        'Cette fiche a changé. Votre saisie est conservée ; rechargez avant de réessayer.',
      )
    if (options.automated) return { id, skipped: true } // Imports are insert-only, including usages/drafts.
  }
  const provenance = options.automated ? options.provenance : (old?.provenance ?? 'ajout manuel')
  if (
    !watchOrigins.includes(provenance as any) ||
    (options.automated && provenance === 'ajout manuel')
  )
    fail('Provenance invalide.')
  if (old?.legacy) f.legacy = old.legacy
  const stmts = [],
    mutation = crypto.randomUUID()
  if (old)
    stmts.push(
      db
        .prepare(
          "UPDATE thematic_watch SET week=?,payload=?,mutation_id=?,protected=1,version=version+1,updated_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=? AND deleted_at='' ",
        )
        .bind(week, JSON.stringify(f), mutation, actor, id, old.version),
    )
  else
    stmts.push(
      db
        .prepare(
          'INSERT INTO thematic_watch(id,week,payload,provenance,author,protected,updated_by,mutation_id) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          week,
          JSON.stringify(f),
          provenance!,
          actor,
          options.automated ? 0 : 1,
          actor,
          mutation,
        ),
    )
  // Subsequent statements are conditional on the exact version saved in the same transaction.
  for (const k of keys)
    stmts.push(
      db
        .prepare(
          'INSERT INTO thematic_watch_keys(key,item_id) SELECT ?,id FROM thematic_watch WHERE id=? AND mutation_id=? AND NOT EXISTS(SELECT 1 FROM thematic_watch_keys WHERE key=? AND item_id=?)',
        )
        .bind(k, id, mutation, k, id),
    )
  if (f.event) {
    const e = f.event,
      eid = crypto.randomUUID()
    // Never overwrite an agenda decision, manually edited facts or its trash.
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO event_agenda(id,dedup_key,title,organizer,starts_on,city,region,modality,access,pillars_json,interest,registration_url,sources_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? FROM thematic_watch WHERE id=? AND mutation_id=? AND NOT EXISTS(SELECT 1 FROM event_agenda WHERE dedup_key=? OR (registration_url<>'' AND registration_url=? AND starts_on=?))`,
        )
        .bind(
          eid,
          eventDedupKey(e),
          e.title,
          e.organizer,
          e.starts_on,
          e.city,
          e.region,
          e.modality,
          e.access,
          JSON.stringify(e.pillars),
          e.interest,
          e.registration_url,
          JSON.stringify(e.sources),
          id,
          mutation,
          eventDedupKey(e),
          e.registration_url,
          e.starts_on,
        ),
    )
  }
  const results = await db.batch(stmts)
  if (results[0].meta.changes !== 1)
    throw new WorkspaceError(409, 'Cette fiche a changé. Rechargez avant de réessayer.')
  return { id, skipped: false }
}
export async function deleteWatch(
  db: WorkspaceDatabase,
  id: string,
  version: unknown,
  actor: string,
) {
  if (!Number.isSafeInteger(version) || Number(version) < 1) fail('Version invalide.')
  const r = await db
    .prepare(
      "UPDATE thematic_watch SET deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),protected=1,version=version+1,updated_by=? WHERE id=? AND version=? AND deleted_at='' ",
    )
    .bind(actor, id, Number(version))
    .run()
  if (r.meta.changes !== 1)
    throw new WorkspaceError(409, 'Cette fiche a changé. Actualisez avant de supprimer.')
}
