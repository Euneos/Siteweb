import { parseArgs } from 'node:util'
import { loadMigrations, validateState } from './lib/internal-migrations.mjs'
import { readRemoteState, remoteQuery } from './internal-migrations.mjs'
import { expiredTasksSQL, taskRetentionCutoff } from '../src/lib/team-task-retention'

async function main() {
  const { values } = parseArgs({ options: { environment: { type: 'string' } } })
  const environment = values.environment
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !['preview', 'production'].includes(environment ?? '')
  )
    throw new Error('Nettoyage réservé au workflow main avec environnement explicite.')
  const migrations = loadMigrations()
  if (validateState(readRemoteState(environment), migrations) !== migrations.length)
    throw new Error('Migrations non publiées : nettoyage suspendu.')
  // Only a server-generated ISO timestamp is interpolated; no caller-supplied SQL or row data.
  const cutoff = taskRetentionCutoff()
  const result = remoteQuery(environment, expiredTasksSQL.replace('?', `'${cutoff}'`))
  console.log(
    `Tâches supprimées — ${environment} : nettoyage confirmé (${result[0].meta.changes} lignes effacées).`,
  )
}
if (import.meta.main)
  main().catch(() => {
    console.error('Nettoyage des tâches non confirmé. Consulter le workflow avant toute reprise.')
    process.exitCode = 1
  })
