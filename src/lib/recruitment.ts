import { WorkspaceError, type WorkspaceDatabase } from './internal-workspace'

export const recruitmentStatuses = ['À contacter', 'À rappeler', 'Brochure à envoyer', 'En attente de retour', 'Intéressé', 'Non intéressé'] as const
export const recruitmentFields = ['establishment', 'city', 'origin', 'contact', 'email', 'address_type', 'phone', 'sent_on', 'response', 'status', 'last_contact_on', 'call_report', 'next_action', 'follow_up_on', 'notes', 'vigilance', 'source'] as const
export type RecruitmentData = Record<typeof recruitmentFields[number], string>
export type RecruitmentContact = RecruitmentData & { id: string; version: number; updated_at: string; updated_by: string }
export function recruitmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^PROS-\d{4,8}$/.test(value))
    throw new WorkspaceError(400, 'Identifiant de prospection invalide.')
  return value
}
export function parseRecruitment(input: unknown): RecruitmentData {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new WorkspaceError(400, 'Fiche invalide.')
  const x = input as Record<string, unknown>
  const data = {} as RecruitmentData
  for (const field of recruitmentFields) {
    const max = ['notes', 'vigilance', 'call_report'].includes(field) ? 6000 : 1000
    if (typeof x[field] !== 'string' || (x[field] as string).length > max)
      throw new WorkspaceError(400, `Champ absent ou trop long : ${field}.`)
    data[field] = (x[field] as string).trim()
  }
  if (!data.establishment || !data.source || !recruitmentStatuses.includes(data.status as typeof recruitmentStatuses[number]))
    throw new WorkspaceError(400, 'Établissement, source ou suivi invalide.')
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
    throw new WorkspaceError(400, 'Adresse e-mail invalide.')
  for (const field of ['sent_on', 'last_contact_on', 'follow_up_on'] as const) {
    const value = data[field]
    if (value && (!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
      throw new WorkspaceError(400, 'Date invalide.')
  }
  return data
}
export async function listRecruitment(db: WorkspaceDatabase) {
  return (await db.prepare(`SELECT * FROM recruitment_contacts ORDER BY COALESCE(NULLIF(last_contact_on,''),NULLIF(sent_on,''),'9999-12-31'), id`).bind().all<RecruitmentContact>()).results
}
export async function readRecruitment(db: WorkspaceDatabase, id: string) {
  return db.prepare('SELECT * FROM recruitment_contacts WHERE id=?').bind(recruitmentId(id)).first<RecruitmentContact>()
}
export async function saveRecruitment(db: WorkspaceDatabase, id: string, input: unknown, version: unknown, actor: string) {
  recruitmentId(id)
  if (!Number.isSafeInteger(version) || (version as number) < 1)
    throw new WorkspaceError(400, 'Version invalide.')
  const data = parseRecruitment(input)
  const result = await db.prepare(`UPDATE recruitment_contacts SET ${recruitmentFields.map(f => `${f}=?`).join(',')}, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by=? WHERE id=? AND version=?`)
    .bind(...recruitmentFields.map(f => data[f]), actor, id, version as number).run()
  if (result.meta.changes !== 1) throw new WorkspaceError(409, 'Cette fiche a changé. Rechargez avant de modifier à nouveau.')
  const saved = await readRecruitment(db, id)
  if (!saved || saved.version !== (version as number) + 1 || recruitmentFields.some(f => saved[f] !== data[f]))
    throw new WorkspaceError(503, 'Enregistrement non confirmé. Ne répétez pas : rechargez la fiche.')
  return saved
}
/** Import additive only. Existing rows are never overwritten or silently merged. */
export async function importRecruitment(db: WorkspaceDatabase, input: unknown, actor: string) {
  const x = input as RecruitmentContact
  const id = recruitmentId(x?.id), data = parseRecruitment(input)
  const existing = await readRecruitment(db, id)
  if (existing) throw new WorkspaceError(409, `La fiche ${id} existe déjà : import arrêté, aucune réécriture.`)
  await db.prepare(`INSERT INTO recruitment_contacts (id,${recruitmentFields.join(',')},updated_by) VALUES (${Array(recruitmentFields.length + 2).fill('?').join(',')})`)
    .bind(id, ...recruitmentFields.map(f => data[f]), actor).run()
  const saved = await readRecruitment(db, id)
  if (!saved || recruitmentFields.some(f => saved[f] !== data[f]))
    throw new WorkspaceError(503, 'Import non confirmé. Ne pas répéter sans relecture.')
  return saved
}
