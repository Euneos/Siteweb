import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import type { WorkspaceDatabase } from '../src/lib/internal-workspace'
import { recruitmentFields, parseRecruitment, recruitmentId, importRecruitment, listRecruitment, saveRecruitment, readRecruitment } from '../src/lib/recruitment'
function fixture() {
  const sql = new Database(':memory:')
  sql.exec(readFileSync('migrations/interne/0031_recruitment_campaign.sql', 'utf8'))
  const db: WorkspaceDatabase = {
    prepare(q) { return { bind(...v: any[]) { return {
      all: async <T>() => ({ results: sql.query(q).all(...v) as T[] }),
      first: async <T>() => sql.query(q).get(...v) as T | null,
      run: async () => ({ meta: { changes: sql.query(q).run(...v).changes } }),
    } } } },
    batch: async () => [],
  }
  return { sql, db }
}
export const exampleRecruitment = () => ({
  ...Object.fromEntries(recruitmentFields.map(f => [f, ''])),
  id: 'PROS-0001', establishment: 'Collège exemple', city: 'Toulouse',
  email: 'direction@example.test', sent_on: '2026-11-20',
  response: 'Non vérifiée', status: 'En attente de retour', source: 'Document exemple',
})
test('contact import is additive, read back, preserves separate contacts and sorts oldest first', async () => {
  const {db, sql} = fixture(), row = exampleRecruitment()
  await importRecruitment(db, row, 'charlotte@example.test')
  await importRecruitment(db, {...row,id:'PROS-0002', sent_on:'2026-11-01'}, 'charlotte@example.test')
  expect((await listRecruitment(db)).map(c => c.id)).toEqual(['PROS-0002','PROS-0001'])
  await expect(importRecruitment(db, {...row,notes:'Écraser'}, 'actor')).rejects.toMatchObject({status:409})
  expect((await readRecruitment(db, row.id))?.notes).toBe('')
  sql.close()
})
test('saves read back every field and reject stale updates', async () => {
  const {db,sql} = fixture(), row = exampleRecruitment()
  await importRecruitment(db,row,'actor')
  const changed = await saveRecruitment(db,row.id,{...row,status:'À rappeler',call_report:'Appel sans date : rappeler le lendemain matin.'},1,'actor')
  expect(changed?.version).toBe(2)
  expect(changed?.last_contact_on).toBe('')
  await expect(saveRecruitment(db,row.id,row,1,'actor')).rejects.toMatchObject({status:409})
  expect((await readRecruitment(db,row.id))?.status).toBe('À rappeler')
  sql.close()
})
test('invalid dates, email, status, text, identity and versions cannot be written', async () => {
  const row=exampleRecruitment()
  for(const changes of [{sent_on:'2026-02-30'},{follow_up_on:'demain'},{email:'pas un mail'},{status:'Établissement engagé'},{establishment:''},{source:''},{notes:'x'.repeat(6001)}])
    expect(()=>parseRecruitment({...row,...changes})).toThrow()
  expect(()=>recruitmentId('1 OR 1')).toThrow()
  const {db,sql}=fixture()
  await expect(saveRecruitment(db,row.id,row,undefined,'actor')).rejects.toMatchObject({status:400})
  sql.close()
})
