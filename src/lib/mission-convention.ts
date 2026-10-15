import { WorkspaceError, type WorkspaceDatabase, type WorkspaceIdentity } from './internal-workspace'

export type Session = { date: string; duree: 2 | 4; modalite: 'presentiel' | 'distance' }
export type Mission = {
  etablissement: string; adresse: string; direction: string; referent: string; contact: string
  format: 'presentiel' | 'hybride'; sessions: Session[]
  cas1: 'non' | 'oui'; classe: string; ateliers: string
  cas2: 'non' | '2' | '4'; periodeCas2: string; accordCas2: string
}
export type MissionPayload = {
  nom: string; structure: string; identification: string; adresse: string; email: string; telephone: string
  frais: 'aucun' | 'accord' | 'demande'; detailsFrais: string; missions: Mission[]
}
export type ConventionRow = {
  id: string; owner_email: string; state: 'submitted' | 'changes_requested' | 'approved' | 'trainer_signed' | 'complete'
  payload: string; case2_euros: number; fees_decision: string; fees_details: string; representative: string; reviewed_by: string; review_note: string
  created_at: string; updated_at: string
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

export function parseMissionPayload(value: unknown): MissionPayload {
  const x = object(value)
  const email = trainerAccountEmail(x.email)
  if (!Array.isArray(x.missions) || x.missions.length < 1 || x.missions.length > 10) fail('Indiquez entre 1 et 10 établissements.')
  const names = new Set<string>()
  const missions = (x.missions as unknown[]).map((raw: unknown): Mission => {
    const m = object(raw)
    const etablissement = field(m.etablissement, 250)
    if (names.has(etablissement.toLowerCase())) fail('Un établissement figure plusieurs fois.')
    names.add(etablissement.toLowerCase())
    const format = choice(m.format, ['presentiel', 'hybride'] as const)
    if (!Array.isArray(m.sessions) || m.sessions.length < 4 || m.sessions.length > 8)
      fail('Indiquez entre 4 et 8 séances par établissement.')
    const sessions = (m.sessions as unknown[]).map((rawSession: unknown): Session => {
      const s = object(rawSession)
      if (s.duree !== 2 && s.duree !== 4) fail('La durée d’une séance doit être de 2 h ou 4 h.')
      return { date: date(s.date), duree: s.duree as 2 | 4, modalite: choice(s.modalite, ['presentiel', 'distance'] as const) }
    })
    if (sessions.reduce((sum, s) => sum + s.duree, 0) !== 16)
      fail('Le calendrier doit totaliser 16 h par établissement.')
    const remote = sessions.filter(s => s.modalite === 'distance').reduce((sum, s) => sum + s.duree, 0)
    if (remote !== (format === 'hybride' ? 8 : 0)) fail('Vérifiez les heures sur site et à distance : le format hybride prévoit 8 h de chaque.')
    const cas1 = choice(m.cas1, ['non', 'oui'] as const)
    const cas2 = choice(m.cas2, ['non', '2', '4'] as const)
    return {
      etablissement, adresse: field(m.adresse, 250), direction: field(m.direction, 250),
      referent: field(m.referent, 250), contact: field(m.contact, 250), format, sessions,
      cas1, classe: field(m.classe ?? '', 120, cas1 === 'oui'),
      ateliers: field(m.ateliers ?? '', 500, cas1 === 'oui'), cas2,
      periodeCas2: field(m.periodeCas2 ?? '', 250, cas2 !== 'non'),
      accordCas2: field(m.accordCas2 ?? '', 250, cas2 !== 'non'),
    }
  })
  const frais = choice(x.frais, ['aucun', 'accord', 'demande'] as const)
  return {
    nom: field(x.nom, 250), structure: field(x.structure, 250), identification: field(x.identification, 250),
    adresse: field(x.adresse, 250), email, telephone: field(x.telephone, 250), frais,
    detailsFrais: field(x.detailsFrais ?? '', 2000, frais !== 'aucun'), missions,
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
  const result = await db.prepare(`UPDATE mission_conventions SET payload=?,state='submitted',review_note='',
    representative='',case2_euros=0,fees_decision='',fees_details='',reviewed_by='',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id=? AND owner_email=? AND state='changes_requested'`)
    .bind(JSON.stringify(parsed), id, identity.email).run()
  if (result.meta.changes !== 1) throw new WorkspaceError(409, 'Cette convention n’est plus modifiable. Rechargez la page.')
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
