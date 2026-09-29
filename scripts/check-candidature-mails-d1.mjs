// Local-only schema/trigger smoke test. Never accepts a remote argument.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
if (process.argv.length !== 2) throw new Error('No arguments: this test is local only')
const scratch = mkdtempSync(join(tmpdir(), 'euneos-mail-d1-'))
try {
  const config = join(scratch, 'wrangler.toml')
  writeFileSync(
    config,
    `name = "euneos-mail-local-test"\ncompatibility_date = "2026-09-01"\n[[d1_databases]]\nbinding = "FORM_SUBMISSIONS"\ndatabase_name = "mail-local-test"\ndatabase_id = "00000000-0000-0000-0000-000000000001"\n`,
  )
  const run = (args) =>
    JSON.parse(
      execFileSync(
        'node',
        [
          resolve('node_modules/wrangler/bin/wrangler.js'),
          'd1',
          'execute',
          'mail-local-test',
          '--config',
          config,
          '--local',
          '--persist-to',
          join(scratch, 'state'),
          '--json',
          ...args,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            WRANGLER_SEND_METRICS: 'false',
            WRANGLER_LOG_PATH: join(scratch, 'logs'),
          },
          maxBuffer: 2_000_000,
        },
      ),
    )
  const schema = join(scratch, 'schema.sql')
  writeFileSync(
    schema,
    readdirSync(new URL('../migrations/', import.meta.url)).filter(name => /^\d.*\.sql$/.test(name)).sort()
      .map((f) => readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'))
      .join('\n'),
  )
  run(['--file', schema])
  assert.deepEqual(run(['--command', 'SELECT count(*) AS n FROM candidature_decisions'])[0].results, [{ n: 0 }])
  const fixture = join(scratch, 'fixture.sql')
  writeFileSync(
    fixture,
    `INSERT INTO form_submissions(submission_key,form_type,cohort_id,state,phase,parent_id,record_id) VALUES('fictive','etablissement',2,'processing','verifying',1,7);
INSERT INTO candidature_mails(id,participation_id,school_id,cohort_id,kind,source,submission_key,state,payload,preview_hash,template_version,issuer,created_at,updated_at)
VALUES('ar:fictive',7,1,2,'ar','site_submission','fictive','awaiting_receipt','{}','test-hash','test-v1','site','2026-09-30T00:00:00Z','2026-09-30T00:00:00Z');`,
  )
  run(['--file', fixture])
  assert.deepEqual(
    run([
      '--command',
      "UPDATE form_submissions SET state='complete',phase='saved' WHERE submission_key='fictive' RETURNING submission_key",
    ])[0].results,
    [{ submission_key: 'fictive' }],
  )
  assert.deepEqual(
    run(['--command', "SELECT state FROM candidature_mails WHERE id='ar:fictive'"])[0].results,
    [{ state: 'queued' }],
  )
  assert.deepEqual(
    run([
      '--command',
      "UPDATE candidature_mails SET state='sending',attempt_id='test-attempt',attempt_started_at='2026-09-30T00:01:00Z' WHERE id='ar:fictive' AND state='queued' RETURNING id",
    ])[0].results,
    [{ id: 'ar:fictive' }],
  )
  assert.deepEqual(
    run([
      '--command',
      "UPDATE candidature_mails SET state='sending',attempt_id='other',attempt_started_at='2026-09-30T00:01:00Z' WHERE id='ar:fictive' AND state='queued' RETURNING id",
    ])[0].results,
    [],
  )
  assert.deepEqual(
    run(['--command', 'SELECT id,state FROM candidature_mail_attempts'])[0].results,
    [{ id: 'test-attempt', state: 'sending' }],
  )
  console.log(
    'Local D1: receipt trigger, atomic attempt and duplicate claim passed; no network email.',
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
