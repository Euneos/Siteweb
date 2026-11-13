#!/usr/bin/env bun
import { generateKeyPairSync } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sealAgenda, openAgenda } from './lib/agenda-envelope'
const repository = 'Euneos/Siteweb'
async function gh(args: string[], input?: string) {
  const proc = Bun.spawn(['gh', ...args], {
    stdin: input ? new Blob([input]) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error('Action GitHub indisponible. Vérifier gh auth status.')
  return out
}
export async function agendaSync(operation: string, file?: string) {
  if (!['list', 'import'].includes(operation))
    throw new Error('Commandes : list | import /chemin/selection.json')
  const requestId = crypto.randomUUID(),
    { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
  const source = operation === 'import' ? JSON.parse(await readFile(file!, 'utf8')) : { events: [] }
  const key = await readFile(new URL('../config/agenda-import-public.pem', import.meta.url), 'utf8')
  const envelope = JSON.stringify(
    sealAgenda(
      { operation, events: source.events, source: source.source, replyKey: publicKey, requestId },
      key,
    ),
  )
  if (envelope.length > 60000)
    throw new Error('Lot trop volumineux : préparer des lots de moins de 30 événements.')
  await gh(
    ['workflow', 'run', 'agenda-newsletters.yml', '--repo', repository, '--ref', 'main', '--json'],
    JSON.stringify({ request_id: requestId, envelope }),
  )
  console.error('Demande chiffrée envoyée. Attente de la vérification serveur…')
  let run: any,
    deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    const runs = JSON.parse(
      await gh([
        'run',
        'list',
        '--repo',
        repository,
        '--workflow',
        'agenda-newsletters.yml',
        '--branch',
        'main',
        '--limit',
        '30',
        '--json',
        'databaseId,displayTitle,status,conclusion',
      ]),
    )
    run = runs.find((r: any) => r.displayTitle === `Agenda · ${requestId}`)
    if (run?.status === 'completed') break
    await Bun.sleep(5000)
  }
  if (!run || run.status !== 'completed' || run.conclusion !== 'success')
    throw new Error(
      'Import non confirmé. Ne pas relancer à l’aveugle ; relire via list et consulter le run GitHub.',
    )
  const dir = await mkdtemp(join(tmpdir(), 'euneos-agenda-sealed-'))
  try {
    await gh([
      'run',
      'download',
      String(run.databaseId),
      '--repo',
      repository,
      '--name',
      `agenda-${requestId}`,
      '--dir',
      dir,
    ])
    const result: any = openAgenda(
      JSON.parse(await readFile(join(dir, 'agenda-response.enc.json'), 'utf8')),
      privateKey,
    )
    if (result.requestId !== requestId) throw new Error('Réponse sans correspondance')
    return { ...result, runId: run.databaseId }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
if (import.meta.main)
  agendaSync(process.argv[2], process.argv[3])
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message)
      process.exitCode = 1
    })
