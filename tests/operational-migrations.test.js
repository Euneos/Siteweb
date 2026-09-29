import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { planOperationalSchema } from '../scripts/plan-operational-schema.mjs'

const migration = (name) => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8')
test('D1 kind extension retains every old link, slot, receipt, mail and uncertain lock', () => {
  const db = new Database(':memory:')
  try {
    db.exec(migration('0003_operational_links.sql'))
    db.exec(migration('0004_operational_submissions.sql'))
    for (const [i, kind] of ['contact', 'deploiement', 'participants'].entries()) {
      const hash = String(i + 1).repeat(64)
      db.query(
        'INSERT INTO operational_links(token_hash,target_id,school_id,cohort_id,kind,issuer_hash,expires_at) VALUES (?,?,?,?,?,?,?)',
      ).run(hash, i + 1, 10, 20, kind, 'f'.repeat(64), 9999999999999)
      db.query('INSERT INTO operational_link_slots VALUES (?,?,?)').run(i + 1, kind, hash)
      db.query(
        "INSERT INTO operational_submissions VALUES (?,?,?,?,?,?,?,'review','write_uncertain',1,'[40]',?,?)",
      ).run(hash, 'e'.repeat(64), i + 1, 10, 20, kind, hash, '2030-01-01', '2030-01-01')
      db.query('INSERT INTO operational_submission_locks(target_id,link_hash) VALUES (?,?)').run(
        i + 1,
        hash,
      )
      db.query("INSERT INTO operational_mail_receipts(link_hash,state) VALUES (?,'uncertain')").run(
        hash,
      )
    }
    const tables = [
      'operational_links',
      'operational_link_slots',
      'operational_submissions',
      'operational_submission_locks',
      'operational_mail_receipts',
    ]
    const before = tables.map((t) => db.query(`SELECT * FROM ${t} ORDER BY 1`).all())
    db.transaction(() => db.exec(migration('0006_operational_activities.sql')))()
    expect(tables.map((t) => db.query(`SELECT * FROM ${t} ORDER BY 1`).all())).toEqual(before)
    db.query(
      'INSERT INTO operational_links(token_hash,target_id,school_id,cohort_id,kind,issuer_hash,expires_at) VALUES (?,?,?,?,?,?,?)',
    ).run('a'.repeat(64), 4, 10, 20, 'activites-jeunes', 'f'.repeat(64), 9999999999999)
    db.query('INSERT INTO operational_link_slots VALUES (?,?,?)').run(
      4,
      'activites-jeunes',
      'a'.repeat(64),
    )
    db.query(
      "INSERT INTO operational_submissions(link_hash,payload_hash,target_id,school_id,cohort_id,kind,receipt,state,code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'complete','saved',?,?)",
    ).run(
      'a'.repeat(64),
      'b'.repeat(64),
      4,
      10,
      20,
      'activites-jeunes',
      'c'.repeat(64),
      '2030-01-02',
      '2030-01-02',
    )
    expect(() =>
      db
        .query('INSERT INTO operational_link_slots VALUES (?,?,?)')
        .run(5, 'unknown', 'd'.repeat(64)),
    ).toThrow()
    expect(db.query('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    expect(
      db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='operational_submissions_recent'",
        )
        .get(),
    ).toBeTruthy()
  } finally {
    db.close()
  }
})
test('NocoDB plan is additive, leaves records/history alone and converges on rerun', () => {
  const metadata = {
    title: 'participations',
    columns: [
      { title: 'notes', uidt: 'LongText' },
      { title: 'date_debut_formation', uidt: 'Date' },
    ],
  }
  const before = structuredClone(metadata),
    plan = planOperationalSchema(metadata)
  expect(metadata).toEqual(before)
  expect(plan.addColumns).toHaveLength(11)
  expect(plan.recordWrites).toEqual([])
  expect(plan.updateColumns).toEqual([])
  expect(plan.deleteColumns).toEqual([])
  expect(plan.addColumns.every((c) => !c.rqd && !('cdf' in c))).toBe(true)
  expect(
    planOperationalSchema({ ...metadata, columns: [...metadata.columns, ...plan.addColumns] })
      .addColumns,
  ).toEqual([])
})
test.each(['wrong-type', 'ambiguous', 'required', 'default', 'renamed', 'unique', 'wrong-table'])(
  'NocoDB schema refuses unsafe preexisting %s instead of changing it',
  (scenario) => {
    let col = { title: 'preformation_questionnaire', uidt: 'SingleLineText' }
    if (scenario === 'wrong-type') col.uidt = 'Number'
    if (scenario === 'required') col.rqd = true
    if (scenario === 'default') col.cdf = 'Non'
    if (scenario === 'renamed')
      col = { ...col, title: 'Other', column_name: 'preformation_questionnaire' }
    if (scenario === 'unique') col.unique = true
    expect(() =>
      planOperationalSchema({
        title: scenario === 'wrong-table' ? 'other' : 'participations',
        columns: scenario === 'ambiguous' ? [col, col] : [col],
      }),
    ).toThrow()
  },
)

test.each([false,'false',0,'0'])('Noco native false Checkbox default %s survives idempotent reread without mutation', cdf=>{
  const column={title:'activites_jeunes_recues',uidt:'Checkbox',cdf,rqd:false,dt:'bool'}
  const metadata={title:'participations',columns:[column]}
  const before=structuredClone(metadata),plan=planOperationalSchema(metadata)
  expect(plan.existingColumns).toContain(column.title)
  expect(plan.addColumns.some(c=>c.title===column.title)).toBe(false)
  expect(plan.updateColumns).toEqual([])
  expect(metadata).toEqual(before)
})
test.each([true,'true',1,'1','FALSE','unexpected'])('Noco refuses incompatible Checkbox default %s',cdf=>{
  expect(()=>planOperationalSchema({title:'participations',columns:[{title:'activites_jeunes_recues',uidt:'Checkbox',cdf}]})).toThrow()
})
