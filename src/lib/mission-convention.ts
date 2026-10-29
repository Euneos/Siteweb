import { WorkspaceError, type WorkspaceDatabase, type WorkspaceIdentity } from './internal-workspace'

export type Session = { date: string; duree: number; modalite: 'presentiel' | 'distance' }
export type Mission = {
  etablissement: string; groupe?: string; adresse: string; direction: string; referent: string; contact: string
  format: 'presentiel' | 'hybride'; volume?: number; sessions: Session[]
  financement?: 'euneos' | 'externe'; financeur?: string
  cas1: 'non' | 'oui'; classe: string; ateliers: string
  cas2: 'non' | '2' | '4'; periodeCas2: string; accordCas2: string
}
export type MissionPayload = {
  nom: string; structure: string; identification: string; adresse: string; email: string; telephone: string
  frais: 'aucun' | 'accord' | 'demande'; detailsFrais: string; missions: Mission[]
}
export type ConventionRow = {
  id: string; owner_email: string; state: 'submitted' | 'changes_requested' | 'approved' | 'trainer_signed' | 'complete'
  payload: string; case2_euros: number; fees_decision: string; fees_details: string; fees_euros?: number | null; representative: string; reviewed_by: string; review_note: string
  created_at: string; updated_at: string
  year2_euros?: number | null
  case2_amount_pending?: number
}
const fail = (message: string): never => { throw new WorkspaceError(400, message) }
const field = (value: unknown, max: number, required = true) =>
  typeof value === 'string' && value.length <= max && (!required || !!value.trim())
    ? value.trim() : fail('Un champ est absent ou trop long.')
const choice = <T extends string>(value: unknown, values: readonly T[]): T =>
  values.includes(value as T) ? value as T : fail('Choix invalide.')
const date = (value: unknown) => {
  const v = field(value, 10)
  if (!/^20\d\d-\d\d-\d\d$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail('Date invalide.')
  return v
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('Formulaire invalide.')

/** Historical submissions used eight 2-hour sessions with a start time. Preserve
 * them during display, corrections and PDF approval; never silently discard a mission. */
export function normalizeStoredPayload(value: string): MissionPayload {
  const data = JSON.parse(value) as MissionPayload
  return {
    ...data,
    missions: data.missions.map(mission => ({
      ...mission,
      sessions: mission.sessions.map(session => ({
        date: session.date,
        duree: 'duree' in session ? session.duree : 2,
        modalite: session.modalite,
      })),
    })),
  }
}

export function trainerAccountEmail(value: unknown): string {
  const email = field(value, 250).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Indiquez une adresse e-mail valide.')
  return email
}

export function parseMissionPayload(value: unknown, draft = false): MissionPayload {
  const x = object(value)
  const text = (v: unknown, max: number, required = true) => field(v, max, required && !draft)
  const select = <T extends string>(v: unknown, values: readonly T[]): T => draft && v === '' ? '' as T : choice(v, values)
  const email = draft && x.email === '' ? '' : trainerAccountEmail(x.email)
  if (!Array.isArray(x.missions) || x.missions.length < 1 || x.missions.length > 10) fail('Indiquez entre 1 et 10 établissements.')
  const names = new Set<string>()
  const missions = (x.missions as unknown[]).map((raw: unknown): Mission => {
    const m = object(raw)
    const etablissement = text(m.etablissement, 250)
    const groupe = text(m.groupe ?? '', 120, false)
    const key = `${etablissement.toLowerCase()}|${groupe.toLowerCase()}`
    if (names.has(key)) fail('Un établissement et son groupe figurent plusieurs fois.')
    names.add(key)
    const format = select(m.format, ['presentiel', 'hybride'] as const)
    const financement = choice(m.financement ?? 'euneos', ['euneos', 'externe'] as const)
    const financeur = text(m.financeur ?? '', 250, financement === 'externe')
    const volume = m.volume ?? 16
    if (financement === 'externe') {
      if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || (!draft && volume === 0) || volume > 1024)
        fail('Indiquez le volume horaire prévu par l’organisme financeur (supérieur à zéro, au maximum 1 024 h).')
    } else if (volume !== 8 && volume !== 16) fail('Choisissez le parcours de 16 h ou le parcours ateliers jeunes année 2 de 8 h.')
    if (!Array.isArray(m.sessions) || m.sessions.length < (draft ? 0 : 1) || m.sessions.length > 64)
      fail('Indiquez entre 1 et 64 séances par formation.')
    const sessions = (m.sessions as unknown[]).map((rawSession: unknown): Session => {
      const s = object(rawSession)
      if (typeof s.duree !== 'number' || !Number.isFinite(s.duree) || s.duree < 0 || (!draft && s.duree === 0) || s.duree > 16)
        fail('Indiquez une durée positive, au maximum 16 h par séance.')
      return { date: draft && s.date === '' ? '' : date(s.date), duree: s.duree as number, modalite: select(s.modalite, ['presentiel', 'distance'] as const) }
    })
    if (!draft && Math.abs(sessions.reduce((sum, s) => sum + s.duree, 0) - Number(volume)) > 0.000001)
      fail(`Le calendrier doit totaliser ${volume} h pour le parcours choisi.`)
    const remote = sessions.filter(s => s.modalite === 'distance').reduce((sum, s) => sum + s.duree, 0)
    if (!draft && ((format === 'presentiel' && remote !== 0) || (format === 'hybride' && (remote === 0 || Math.abs(remote - Number(volume)) < 0.000001))))
      fail('Le format hybride doit comporter des séances sur site et en visioconférence.')
    const cas1 = select(m.cas1, ['non', 'oui'] as const)
    const cas2 = select(m.cas2, ['non', '2', '4'] as const)
    return {
      etablissement, groupe, adresse: text(m.adresse, 250), direction: text(m.direction, 250),
      referent: text(m.referent, 250), contact: text(m.contact, 250), format, volume: volume as number, sessions, financement, financeur,
      cas1, classe: text(m.classe ?? '', 120, cas1 === 'oui'),
      ateliers: text(m.ateliers ?? '', 500, cas1 === 'oui'), cas2,
      periodeCas2: text(m.periodeCas2 ?? '', 250, cas2 !== 'non'),
      accordCas2: text(m.accordCas2 ?? '', 250, cas2 !== 'non'),
    }
  })
  const frais = select(x.frais, ['aucun', 'accord', 'demande'] as const)
  return {
    nom: text(x.nom, 250), structure: text(x.structure, 250), identification: text(x.identification, 250),
    adresse: text(x.adresse, 250), email, telephone: text(x.telephone, 250), frais,
    detailsFrais: text(x.detailsFrais ?? '', 2000, frais !== 'aucun'), missions,
  }
}

export async function listConventions(db: WorkspaceDatabase, identity: WorkspaceIdentity, team: boolean) {
  const { results } = await db.prepare(team
    ? 'SELECT * FROM mission_conventions ORDER BY created_at DESC LIMIT 100'
    : 'SELECT * FROM mission_conventions WHERE owner_email=? ORDER BY created_at DESC LIMIT 100')
    .bind(...(team ? [] : [identity.email])).all<ConventionRow>()
  return results.map(({ payload, ...row }) => ({ ...row, payload: normalizeStoredPayload(payload) }))
}
export async function getConvention(db: WorkspaceDatabase, id: string, identity: WorkspaceIdentity, team: boolean) {
  const row = await db.prepare('SELECT * FROM mission_conventions WHERE id=?').bind(id).first<ConventionRow>()
  if (!row || (!team && row.owner_email !== identity.email)) throw new WorkspaceError(404, 'Convention introuvable.')
  return row
}
export async function submitConvention(db: WorkspaceDatabase, identity: WorkspaceIdentity, payload: unknown, id?: string) {
  const parsed = parseMissionPayload(payload)
  if (!id) {
    const newId = crypto.randomUUID()
    await db.prepare('INSERT INTO mission_conventions(id,owner_email,state,payload) VALUES(?,?,?,?)')
      .bind(newId, identity.email, 'submitted', JSON.stringify(parsed)).run()
    return getConvention(db, newId, identity, false)
  }
  const previous = await db.prepare("SELECT * FROM mission_conventions WHERE id=? AND owner_email=? AND state='changes_requested'").bind(id,identity.email).first<ConventionRow>()
  if (!previous) throw new WorkspaceError(409, 'Cette convention n’est plus modifiable. Rechargez la page.')
  const year2Key = (p: MissionPayload) => JSON.stringify(p.missions.filter(m => m.volume === 8 && m.financement !== 'externe').map(m => [m.etablissement,m.groupe || '']).sort())
  const year2Euros = year2Key(normalizeStoredPayload(previous.payload)) === year2Key(parsed) ? previous.year2_euros ?? null : null
  const result = await db.prepare(`UPDATE mission_conventions SET payload=?,year2_euros=?,state='submitted',review_note='',
    representative='',case2_euros=0,fees_decision='',fees_details='',fees_euros=NULL,reviewed_by='',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND owner_email=? AND state='changes_requested' AND updated_at=?`)
    .bind(JSON.stringify(parsed), year2Euros, id, identity.email, previous.updated_at).run()
  // D1/Bun may count the notification trigger's write in meta.changes too.
  if (result.meta.changes < 1) throw new WorkspaceError(409, 'Cette convention n’est plus modifiable. Rechargez la page.')
  return getConvention(db, id, identity, false)
}
export async function requestChanges(db: WorkspaceDatabase, id: string, actor: WorkspaceIdentity, note: unknown) {
  const message = field(note, 2000)
  const result = await db.prepare(`UPDATE mission_conventions SET state='changes_requested',review_note=?,reviewed_by=?,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='submitted'`)
    .bind(message, actor.email, id).run()
  if (result.meta.changes !== 1) throw new WorkspaceError(409, 'Statut modifié. Rechargez la page.')
  return getConvention(db, id, actor, true)
}
