import { WorkspaceError, type WorkspaceDatabase, type WorkspaceIdentity } from './internal-workspace'
import { parseMissionPayload, getConvention } from './mission-convention'

type Draft = { id: string; owner_email: string; payload: string; note: string; revision: number; submitted_id: string | null }
export async function getDraft(db: WorkspaceDatabase, id: string, identity: WorkspaceIdentity, team: boolean) {
  const row = await db.prepare('SELECT * FROM mission_convention_drafts WHERE id=?').bind(id).first<Draft>()
  if (!row || (!team && row.owner_email !== identity.email)) throw new WorkspaceError(404, 'Brouillon introuvable.')
  return row
}
export async function listDrafts(db: WorkspaceDatabase, identity: WorkspaceIdentity, team: boolean) {
  const { results } = await db.prepare(team
    ? 'SELECT * FROM mission_convention_drafts WHERE submitted_id IS NULL ORDER BY created_at DESC LIMIT 100'
    : 'SELECT * FROM mission_convention_drafts WHERE submitted_id IS NULL AND owner_email=? ORDER BY created_at DESC LIMIT 100')
    .bind(...(team ? [] : [identity.email])).all<Draft>()
  return results.map(row => ({ ...row, payload: JSON.parse(row.payload) }))
}
export async function saveDraft(db: WorkspaceDatabase, owner: WorkspaceIdentity, actor: WorkspaceIdentity, id: string, revision: unknown, payload: unknown, note: unknown) {
  const parsed = parseMissionPayload(payload, true)
  if (typeof note !== 'string' || note.length > 6000) throw new WorkspaceError(400, 'Note du brouillon trop longue.')
  if (revision === 0) {
    const result = await db.prepare('INSERT OR IGNORE INTO mission_convention_drafts(id,owner_email,payload,note,created_by) VALUES(?,?,?,?,?)')
      .bind(id, owner.email, JSON.stringify(parsed), note, actor.email).run()
    if (result.meta.changes !== 1) throw new WorkspaceError(409, 'Brouillon déjà enregistré. Rechargez la page.')
  } else {
    if (!Number.isInteger(revision) || Number(revision) < 1) throw new WorkspaceError(400, 'Version du brouillon invalide.')
    const result = await db.prepare(`UPDATE mission_convention_drafts SET payload=?,note=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND owner_email=? AND revision=? AND submitted_id IS NULL`)
      .bind(JSON.stringify(parsed), note, id, owner.email, Number(revision)).run()
    if (result.meta.changes !== 1) throw new WorkspaceError(409, 'Le brouillon a changé. Rechargez la page avant de le modifier.')
  }
  return getDraft(db, id, owner, false)
}
export async function submitDraft(db: WorkspaceDatabase, owner: WorkspaceIdentity, id: string, revision: unknown, payload: unknown) {
  const current = await getDraft(db, id, owner, false)
  if (current.submitted_id) throw new WorkspaceError(409, 'Ce brouillon a déjà été soumis. Rechargez la page.')
  if (current.revision !== revision) throw new WorkspaceError(409, 'Le brouillon a changé. Rechargez la page.')
  const parsed = parseMissionPayload(payload)
  // The deterministic convention ID plus a conditional transaction prevents duplicate submissions.
  const results = await db.batch([
    db.prepare(`INSERT INTO mission_conventions(id,owner_email,state,payload)
      SELECT id,owner_email,'submitted',? FROM mission_convention_drafts WHERE id=? AND owner_email=? AND revision=? AND submitted_id IS NULL`)
      .bind(JSON.stringify(parsed), id, owner.email, revision),
    db.prepare(`UPDATE mission_convention_drafts SET submitted_id=id,payload=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND owner_email=? AND revision=? AND submitted_id IS NULL`)
      .bind(JSON.stringify(parsed), id, owner.email, revision),
  ])
  if (results.some(result => result.meta.changes !== 1)) throw new WorkspaceError(409, 'Soumission non confirmée. Rechargez la page.')
  return getConvention(db, id, owner, false)
}
