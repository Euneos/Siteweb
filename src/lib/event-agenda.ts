import { WorkspaceError, type WorkspaceDatabase } from './internal-workspace'
export const agendaPillars = ['santé mentale', 'CPS', 'numérique', 'éducation'] as const
export const agendaPeople = ['Candice', 'Pauline', 'Charlotte', 'CA'] as const
export const agendaStatuses = ['à décider', 'confirmé', 'rejeté'] as const
export type EventFacts = {
  title: string
  organizer: string
  starts_on: string
  city: string
  region: string
  modality: string
  access: string
  pillars: string[]
  interest: string
  registration_url: string
  sources: string[]
}
export type AgendaEvent = EventFacts & {
  id: string
  status: string
  attendance: string[]
  version: number
  updated_at: string
  deleted_at: string
}
const normalized = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
export const agendaToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
export function registrationLink(value: string) {
  if (!value) return ''
  let u: URL
  try {
    u = new URL(value)
  } catch {
    throw new WorkspaceError(400, 'Lien d’inscription invalide.')
  }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
    throw new WorkspaceError(400, 'Lien d’inscription invalide.')
  u.hash = ''
  for (const k of [...u.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(k)) u.searchParams.delete(k)
  u.searchParams.sort()
  return u.toString()
}
export function parseEventFacts(input: unknown, today = agendaToday()): EventFacts {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new WorkspaceError(400, 'Événement invalide.')
  const e = input as Record<string, unknown>,
    text = (k: string, max: number, required = false) => {
      if (
        typeof e[k] !== 'string' ||
        (e[k] as string).length > max ||
        (required && !(e[k] as string).trim())
      )
        throw new WorkspaceError(400, `Champ invalide : ${k}.`)
      return (e[k] as string).trim()
    }
  const title = text('title', 300, true),
    organizer = text('organizer', 200, true),
    starts_on = text('starts_on', 10, true)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(starts_on) ||
    !Number.isFinite(Date.parse(starts_on)) ||
    new Date(starts_on).toISOString().slice(0, 10) !== starts_on ||
    starts_on < today
  )
    throw new WorkspaceError(400, 'Date passée ou invalide : événement non importé.')
  const city = text('city', 160),
    modality = text('modality', 20, true),
    region = modality === 'en ligne' ? 'En ligne' : text('region', 40, true),
    access = text('access', 30)
  if (
    !['présentiel', 'en ligne'].includes(modality) ||
    !['Île-de-France', 'Occitanie', 'En ligne'].includes(region) ||
    (modality === 'présentiel' && (region === 'En ligne' || !city)) ||
    !['', 'gratuit', 'payant', 'sur invitation'].includes(access)
  )
    throw new WorkspaceError(400, 'Lieu, modalité ou accès invalide.')
  if (
    !Array.isArray(e.pillars) ||
    !e.pillars.length ||
    e.pillars.some((p) => !agendaPillars.includes(p as (typeof agendaPillars)[number]))
  )
    throw new WorkspaceError(400, 'Au moins un pilier est requis.')
  if (
    !Array.isArray(e.sources) ||
    !e.sources.length ||
    e.sources.length > 30 ||
    e.sources.some((s) => typeof s !== 'string' || !s.trim() || s.length > 600)
  )
    throw new WorkspaceError(400, 'Indiquez la newsletter source et sa date.')
  return {
    title,
    organizer,
    starts_on,
    city,
    region,
    modality,
    access,
    pillars: [...new Set(e.pillars)] as string[],
    interest: text('interest', 2000, true),
    registration_url: registrationLink(text('registration_url', 2000)),
    sources: [...new Set(e.sources)] as string[],
  }
}
export const eventDedupKey = (e: EventFacts) =>
  `${e.starts_on}:${normalized(e.organizer)}:${normalized(e.title)}`
type StoredEvent = Omit<AgendaEvent, 'pillars' | 'sources' | 'attendance'> & {
  pillars_json: string
  sources_json: string
  attendance_json: string
}
const hydrate = (r: StoredEvent): AgendaEvent => {
  const { pillars_json, sources_json, attendance_json, ...e } = r
  return {
    ...e,
    pillars: JSON.parse(pillars_json),
    sources: JSON.parse(sources_json),
    attendance: JSON.parse(attendance_json),
  }
}
export async function listAgenda(db: WorkspaceDatabase, includeDeleted = false) {
  return (
    await db
      .prepare(
        `SELECT id,title,organizer,starts_on,city,region,modality,access,pillars_json,interest,registration_url,sources_json,status,attendance_json,version,updated_at,deleted_at FROM event_agenda WHERE (?=1 OR deleted_at='') ORDER BY starts_on,title`,
      )
      .bind(includeDeleted ? 1 : 0)
      .all<StoredEvent>()
  ).results.map(hydrate)
}
// Only newsletter facts are accepted here. status/attendance are deliberately absent from SQL.
export async function importAgendaEvent(
  db: WorkspaceDatabase,
  input: unknown,
  existingId?: string,
  today = agendaToday(),
) {
  const e = parseEventFacts(input, today),
    key = eventDedupKey(e)
  const candidates = (
    await db
      .prepare(
        "SELECT * FROM event_agenda WHERE dedup_key=? OR (?<>'' AND registration_url=? AND starts_on=?) OR id=?",
      )
      .bind(key, e.registration_url, e.registration_url, e.starts_on, existingId || '')
      .all<StoredEvent>()
  ).results
  if (candidates.length > 1)
    throw new WorkspaceError(
      409,
      'Plusieurs fiches possibles : rapprochement à vérifier par l’équipe.',
    )
  if (existingId && !candidates.some((c) => c.id === existingId))
    throw new WorkspaceError(409, 'La fiche à actualiser est introuvable.')
  const old = candidates[0],
    id = old?.id || crypto.randomUUID(),
    sources = [...new Set([...(old ? JSON.parse(old.sources_json) : []), ...e.sources])]
  if (old?.deleted_at) return old.id
  if (
    old &&
    [
      'title',
      'organizer',
      'starts_on',
      'city',
      'region',
      'modality',
      'access',
      'interest',
      'registration_url',
    ].every((k) => (old as any)[k] === (e as any)[k]) &&
    old.pillars_json === JSON.stringify(e.pillars) &&
    old.sources_json === JSON.stringify(sources)
  )
    return id
  await db
    .prepare(
      `INSERT INTO event_agenda(id,dedup_key,title,organizer,starts_on,city,region,modality,access,pillars_json,interest,registration_url,sources_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET dedup_key=excluded.dedup_key,title=excluded.title,organizer=excluded.organizer,starts_on=excluded.starts_on,city=excluded.city,region=excluded.region,modality=excluded.modality,access=excluded.access,pillars_json=excluded.pillars_json,interest=excluded.interest,registration_url=excluded.registration_url,sources_json=excluded.sources_json,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=event_agenda.version+1`,
    )
    .bind(
      id,
      key,
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
      JSON.stringify(sources),
    )
    .run()
  return id
}
export async function decideAgendaEvent(
  db: WorkspaceDatabase,
  id: string,
  body: Record<string, unknown>,
  email: string,
) {
  if (
    !agendaStatuses.includes(body.status as (typeof agendaStatuses)[number]) ||
    !Array.isArray(body.attendance) ||
    body.attendance.some((p) => !agendaPeople.includes(p as (typeof agendaPeople)[number])) ||
    new Set(body.attendance).size !== body.attendance.length ||
    !Number.isSafeInteger(body.version) ||
    Number(body.version) < 1
  )
    throw new WorkspaceError(400, 'Statut ou présence invalide.')
  const result = await db
    .prepare(
      "UPDATE event_agenda SET status=?,attendance_json=?,version=version+1,decision_by=?,decision_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=? AND deleted_at=''",
    )
    .bind(body.status as string, JSON.stringify(body.attendance), email, id, body.version as number)
    .run()
  if (!result.meta.changes)
    throw new WorkspaceError(409, 'Cette fiche a changé. Actualisez avant de réessayer.')
}
export function agendaMonths(today = agendaToday()) {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    return {
      key: d.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d),
    }
  })
}

export async function lastAgendaCheck(db: WorkspaceDatabase) {
  return (
    (
      await db
        .prepare('SELECT max(checked_at) checked_at FROM event_agenda_sync_runs')
        .bind()
        .first<{ checked_at: string | null }>()
    )?.checked_at || null
  )
}

export async function removeAgendaEvent(
  db: WorkspaceDatabase,
  id: string,
  version: unknown,
  email: string,
  restore = false,
) {
  if (!Number.isSafeInteger(version) || Number(version) < 1)
    throw new WorkspaceError(400, 'Version invalide.')
  const result = await db
    .prepare(
      `UPDATE event_agenda SET deleted_at=${restore ? "''" : "strftime('%Y-%m-%dT%H:%M:%fZ','now')"},deleted_by=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=? AND ${restore ? "deleted_at<>''" : "deleted_at=''"}`,
    )
    .bind(restore ? '' : email, id, version as number)
    .run()
  if (!result.meta.changes)
    throw new WorkspaceError(409, 'Cette fiche a changé. Actualisez avant de réessayer.')
}
