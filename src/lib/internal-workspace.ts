/** Team calendars are a separate domain from WISE-UP's NocoDB dossiers.
 * Notion stays canonical until an audited import and an explicit cutover.
 * No live cross-system synchronization or automatic social publication. */
export interface WorkspaceDatabase {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      all<T>(): Promise<{ results: T[] }>
      first<T>(): Promise<T | null>
      run(): Promise<{ meta: { changes: number } }>
    }
  }
}
export type WorkspaceIdentity = { email: string; admin: boolean }
export type Entry = {
  id: string
  kind: 'editorial' | 'equipe'
  title: string
  starts_on: string
  ends_on: string
  person: string
  activity: string
  channel: string
  status: string
  hours: number | null
  attendance: string
  location: string
  notes: string
  content: string
  link: string
  created_by: string
  updated_by: string
  version: number
}
export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
const teamStatuses = ['brouillon', 'a_valider', 'valide', 'programme', 'annule']
const statuses = [...teamStatuses, 'publie', 'en_cours', 'a_creer', 'a_modifier']
const text = (value: unknown, max: number, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new WorkspaceError(400, 'Un champ est absent ou trop long.')
  return value.trim()
}
const date = (value: unknown): string => {
  const d = text(value, 10, true)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
    Number(d.slice(0, 4)) < 1900 ||
    Number(d.slice(0, 4)) > 2200 ||
    !Number.isFinite(Date.parse(d)) ||
    new Date(d).toISOString().slice(0, 10) !== d
  )
    throw new WorkspaceError(400, 'Date invalide.')
  return d
}
export function safeLink(value: unknown): string {
  const s = text(value, 2000)
  if (!s) return ''
  let url: URL
  try {
    url = new URL(s)
  } catch {
    throw new WorkspaceError(400, 'Lien invalide.')
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new WorkspaceError(400, 'Utilisez un lien HTTPS sans identifiants.')
  return url.href
}
export function parseEntry(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new WorkspaceError(400, 'Formulaire invalide.')
  const x = input as Record<string, unknown>
  if (x.kind !== 'editorial' && x.kind !== 'equipe')
    throw new WorkspaceError(400, 'Calendrier inconnu.')
  const starts_on = date(x.starts_on),
    ends_on = date(x.ends_on)
  if (ends_on < starts_on) throw new WorkspaceError(400, 'La fin précède le début.')
  const status = text(x.status, 20)
  if (!(x.kind === 'equipe' ? teamStatuses : statuses).includes(status))
    throw new WorkspaceError(400, 'Statut invalide.')
  const hours = x.hours === null || x.hours === '' ? null : x.hours
  if (
    hours !== null &&
    (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 744)
  )
    throw new WorkspaceError(400, 'Nombre d’heures invalide.')
  // Split time entries at month boundaries: monthly totals must not allocate
  // an arbitrary fraction of a multi-month duration.
  if (hours !== null && hours > 0 && starts_on.slice(0, 7) !== ends_on.slice(0, 7))
    throw new WorkspaceError(400, 'Répartissez les heures en une fiche par mois.')
  const attendance = text(x.attendance ?? '', 20)
  if (!['', 'presence', 'absence', 'conge'].includes(attendance))
    throw new WorkspaceError(400, 'Présence ou absence invalide.')
  const person = text(x.person, 120, true)
  if (x.kind === 'equipe' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person))
    throw new WorkspaceError(400, 'Utilisez l’adresse email de la personne pour le suivi d’équipe.')
  return {
    kind: x.kind,
    title: text(x.title, 180, true),
    starts_on,
    ends_on,
    person: x.kind === 'equipe' ? person.toLowerCase() : person,
    activity: text(x.activity, 120),
    channel: text(x.channel, 80),
    attendance,
    location: text(x.location ?? '', 200),
    status,
    hours: x.kind === 'equipe' ? hours : null,
    notes: text(x.notes, 6000),
    content: text(x.content, 20000),
    link: safeLink(x.link),
  } as const
}
export function monthBounds(month: string) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 1900 ||
    Number(month.slice(0, 4)) > 2200
  )
    throw new WorkspaceError(400, 'Mois invalide.')
  const start = `${month}-01`
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10)
  return { start, end }
}
const entryColumns =
  'id,kind,title,starts_on,ends_on,person,activity,channel,attendance,location,status,hours,notes,content,link,created_by,updated_by,version'
export async function getEntry(db: WorkspaceDatabase, id: string): Promise<Entry> {
  const entry = await db
    .prepare(`SELECT ${entryColumns} FROM workspace_entries WHERE id=?`)
    .bind(id)
    .first<Entry>()
  if (!entry) throw new WorkspaceError(404, 'Fiche introuvable.')
  return entry
}
export async function listEntries(
  db: WorkspaceDatabase,
  month: string,
  kind: string,
): Promise<Entry[]> {
  if (!['editorial', 'equipe'].includes(kind)) throw new WorkspaceError(400, 'Calendrier inconnu.')
  const { start, end } = monthBounds(month)
  const { results } = await db
    .prepare(
      `SELECT ${entryColumns} FROM workspace_entries WHERE kind = ? AND starts_on <= ? AND ends_on >= ? ORDER BY starts_on, title`,
    )
    .bind(kind, end, start)
    .all<Entry>()
  return results
}
export async function saveEntry(
  db: WorkspaceDatabase,
  actor: WorkspaceIdentity,
  input: unknown,
  id?: string,
  version?: number,
  requestId?: string,
): Promise<string> {
  const entry = parseEntry(input)
  if (entry.kind === 'equipe' && !actor.admin && entry.person.toLowerCase() !== actor.email)
    throw new WorkspaceError(403, 'Vous pouvez déclarer uniquement vos propres heures et absences.')
  const previous = id
    ? await db.prepare('SELECT * FROM workspace_entries WHERE id = ?').bind(id).first<Entry>()
    : null
  if (id && !previous) throw new WorkspaceError(404, 'Fiche introuvable.')
  if (previous && entry.kind !== previous.kind)
    throw new WorkspaceError(400, 'Le calendrier d’une fiche ne peut pas changer.')
  if (previous?.kind === 'equipe' && previous.created_by !== actor.email && !actor.admin)
    throw new WorkspaceError(403, 'Seul l’auteur ou un responsable peut modifier cette fiche.')
  if (
    entry.kind === 'equipe' &&
    entry.status === 'valide' &&
    (!previous || previous.status !== 'valide') &&
    !actor.admin
  )
    throw new WorkspaceError(403, 'La validation des heures est réservée aux responsables.')
  // Editing an approved entry invalidates its approval, even if a stale form
  // silently retains the validated status.
  if (
    previous?.kind === 'equipe' &&
    previous.status === 'valide' &&
    !actor.admin &&
    entry.status === 'valide'
  )
    throw new WorkspaceError(403, 'Remettez cette fiche à valider avant de modifier les heures.')
  const values = [
    entry.title,
    entry.starts_on,
    entry.ends_on,
    entry.person,
    entry.activity,
    entry.channel,
    entry.attendance,
    entry.location,
    entry.status,
    entry.hours,
    entry.notes,
    entry.content,
    entry.link,
  ]
  if (previous && id) {
    if (!Number.isSafeInteger(version) || (version ?? 0) < 1)
      throw new WorkspaceError(400, 'Version de fiche absente.')
    const result = await db
      .prepare(
        `UPDATE workspace_entries SET title=?, starts_on=?, ends_on=?, person=?, activity=?, channel=?, attendance=?, location=?, status=?, hours=?, notes=?, content=?, link=?, updated_by=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?`,
      )
      .bind(...values, actor.email, id, version!)
      .run()
    if (result.meta.changes !== 1)
      throw new WorkspaceError(
        409,
        'Cette fiche a changé. Rechargez-la avant de réessayer ; votre saisie est conservée.',
      )
    return id
  }
  const newId = requestId ?? crypto.randomUUID()
  const inserted = await db
    .prepare(
      `INSERT INTO workspace_entries (id,kind,title,starts_on,ends_on,person,activity,channel,attendance,location,status,hours,notes,content,link,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    )
    .bind(newId, entry.kind, ...values, actor.email, actor.email)
    .run()
  if (inserted.meta.changes !== 1) {
    const saved = await db
      .prepare('SELECT * FROM workspace_entries WHERE id=?')
      .bind(newId)
      .first<Entry>()
    if (
      !saved ||
      saved.created_by !== actor.email ||
      Object.entries(entry).some(([k, v]) => saved[k as keyof Entry] !== v)
    )
      throw new WorkspaceError(
        409,
        'Cette demande existe déjà avec une autre saisie. Rechargez avant de réessayer.',
      )
  }
  return newId
}
export async function comments(db: WorkspaceDatabase, id: string) {
  const parent = await db.prepare('SELECT id FROM workspace_entries WHERE id=?').bind(id).first()
  if (!parent) throw new WorkspaceError(404, 'Fiche introuvable.')
  return (
    await db
      .prepare(
        'SELECT id,author,content,created_at FROM workspace_comments WHERE entry_id=? ORDER BY created_at,id',
      )
      .bind(id)
      .all()
  ).results
}
export async function addComment(
  db: WorkspaceDatabase,
  actor: WorkspaceIdentity,
  id: string,
  content: unknown,
  requestId: string = crypto.randomUUID(),
) {
  const message = text(content, 6000, true)
  const result = await db
    .prepare(
      'INSERT INTO workspace_comments (id,entry_id,author,content) SELECT ?,id,?,? FROM workspace_entries WHERE id=? ON CONFLICT(id) DO NOTHING',
    )
    .bind(requestId, actor.email, message, id)
    .run()
  if (result.meta.changes !== 1) {
    const saved = await db
      .prepare('SELECT entry_id,author,content FROM workspace_comments WHERE id=?')
      .bind(requestId)
      .first<{ entry_id: string; author: string; content: string }>()
    if (!saved) throw new WorkspaceError(404, 'Fiche introuvable.')
    if (saved.entry_id !== id || saved.author !== actor.email || saved.content !== message)
      throw new WorkspaceError(
        409,
        'Cette demande de commentaire existe déjà avec une autre saisie.',
      )
  }
}
export function hoursByPerson(entries: Entry[]) {
  const totals = new Map<string, { declared: number; approved: number }>()
  for (const entry of entries) {
    if (entry.kind !== 'equipe' || entry.status === 'annule' || entry.hours === null) continue
    const row = totals.get(entry.person) ?? { declared: 0, approved: 0 }
    row.declared += entry.hours
    if (entry.status === 'valide') row.approved += entry.hours
    totals.set(entry.person, row)
  }
  return [...totals].map(([person, v]) => ({ person, ...v }))
}
