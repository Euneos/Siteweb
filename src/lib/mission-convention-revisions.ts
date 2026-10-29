import { getConvention, parseMissionPayload } from './mission-convention'
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceIdentity } from './internal-workspace'

/** Archive the exact unsigned version, then reopen the same dossier atomically. */
export async function reviseConvention(db: WorkspaceDatabase, actor: WorkspaceIdentity, id: string, body: Record<string, unknown>) {
  if (!actor.admin) throw new WorkspaceError(403, 'Action réservée à la direction EUNEOS.')
  const row = await getConvention(db, id, actor, true)
  if (row.state !== 'approved' || row.updated_at !== body.expectedUpdatedAt)
    throw new WorkspaceError(409, 'La convention a changé ou a été signée. Rechargez la page.')
  if (body.unsignedConfirmed !== true) throw new WorkspaceError(400, 'Confirmez qu’aucune signature n’a été apposée.')
  const reason = typeof body.note === 'string' ? body.note.trim() : ''
  if (!reason || reason.length > 2000) throw new WorkspaceError(400, 'Indiquez le motif de la correction (2 000 caractères maximum).')
  const payload = parseMissionPayload(body.payload)
  const withoutCase2 = (value: typeof payload) => JSON.stringify({...value,missions:value.missions.map(({cas2,periodeCas2,accordCas2,...mission}) => mission)})
  if (withoutCase2(payload) !== withoutCase2(parseMissionPayload(JSON.parse(row.payload))))
    throw new WorkspaceError(400, 'Cette révision porte sur la formation aux ateliers (cas 2). Conservez les autres informations et montants.')
  const revision = crypto.randomUUID()
  const pending = payload.missions.some(m => m.cas2 !== 'non') ? 1 : 0
  const results = await db.batch([
    db.prepare(`INSERT INTO mission_convention_revisions(id,convention_id,previous_updated_at,snapshot,pdf,sha256,reason,revised_by)
      SELECT ?,c.id,c.updated_at,?,f.pdf,f.sha256,?,? FROM mission_conventions c
      JOIN mission_convention_files f ON f.convention_id=c.id AND f.kind='approved'
      WHERE c.id=? AND c.state='approved' AND c.updated_at=?
      AND NOT EXISTS (SELECT 1 FROM mission_convention_files WHERE convention_id=c.id AND kind IN ('trainer_signed','complete'))`)
      .bind(revision,JSON.stringify(row),reason,actor.email,id,row.updated_at),
    db.prepare(`UPDATE mission_conventions SET state='submitted',payload=?,case2_euros=0,case2_amount_pending=?,review_note=?,reviewed_by=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id=? AND state='approved' AND updated_at=? AND EXISTS (SELECT 1 FROM mission_convention_revisions WHERE id=? AND convention_id=?)`)
      .bind(JSON.stringify(payload),pending,`${row.review_note}\nRéouverture avant signature : ${reason}`.trim(),actor.email,id,row.updated_at,revision,id),
  ])
  if (results.some(r => r.meta.changes < 1)) throw new WorkspaceError(409, 'Réouverture non confirmée. Rechargez la page sans recommencer.')
  const saved = await getConvention(db,id,actor,true)
  const archive = await db.prepare('SELECT id FROM mission_convention_revisions WHERE id=? AND snapshot=?').bind(revision,JSON.stringify(row)).first()
  if (!archive || saved.state !== 'submitted' || saved.payload !== JSON.stringify(payload) || saved.case2_amount_pending !== pending)
    throw new WorkspaceError(503, 'Relecture de la réouverture incertaine. Rechargez la page.')
  return saved
}
