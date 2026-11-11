import type { WorkspaceDatabase } from './internal-workspace'

export const taskRetentionDays = 30
export const taskRetentionCutoff = (now = new Date()) =>
  new Date(now.getTime() - taskRetentionDays * 86400000).toISOString()
export const expiredTasksSQL = "DELETE FROM team_tasks WHERE deleted_at <> '' AND deleted_at <= ?"

/** The deletion trigger also removes notification records in the same transaction. */
export async function purgeExpiredTasks(db: WorkspaceDatabase, now = new Date()) {
  return (await db.prepare(expiredTasksSQL).bind(taskRetentionCutoff(now)).run()).meta.changes
}
