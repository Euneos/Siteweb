import { Database } from 'bun:sqlite'
import { readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { importWorkspaceSnapshot } from './lib/workspace-import'

// Usage: bun scripts/prepare-workspace-import.ts snapshot.json [new-private.sqlite]
// No output path = validation only. Output must not exist; no live data is edited.
const [, , inputPath, outputPath] = process.argv
if (!inputPath)
  throw new Error(
    'Usage: bun scripts/prepare-workspace-import.ts snapshot.json [new-private.sqlite]',
  )
const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'))
if (outputPath) writeFileSync(outputPath, '', { flag: 'wx', mode: 0o600 })
const db = new Database(outputPath ?? ':memory:')
try {
  db.exec(
    readFileSync(new URL('../migrations/interne/0001_workspace.sql', import.meta.url), 'utf8'),
  )
  const result = importWorkspaceSnapshot(db, snapshot)
  const replay = importWorkspaceSnapshot(db, snapshot)
  if (replay.inserted !== 0 || replay.skipped !== result.entries)
    throw new Error('Import replay failed')
  if (outputPath) chmodSync(outputPath, 0o600)
  console.log(
    JSON.stringify({
      mode: outputPath ? 'offline-staging' : 'validation-only',
      ...result,
      idempotent: true,
    }),
  )
} catch (error) {
  db.close()
  if (outputPath) unlinkSync(outputPath)
  throw error
} finally {
  db.close()
}
