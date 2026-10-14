#!/usr/bin/env bun
/**
 * Les calendriers de l'espace interne (éditorial, équipe & heures), depuis le
 * poste : mêmes règles que les pages, car ce sont les mêmes fonctions.
 *
 *   bun scripts/calendrier.ts mois 2026-10 [editorial|equipe]
 *   bun scripts/calendrier.ts heures 2026-10
 *   bun scripts/calendrier.ts fiche <id>
 *   bun scripts/calendrier.ts creer '<fiche JSON>'
 *   bun scripts/calendrier.ts modifier <id> '<champs JSON à changer>'
 *   bun scripts/calendrier.ts deplacer <id> <AAAA-MM-JJ>
 *
 * La suppression reste dans l'espace interne. Variables dans .env :
 * CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, EUNEOS_EMAIL, EUNEOS_RESPONSABLES.
 */
import {
  getEntry,
  hoursByPerson,
  listEntries,
  movePublication,
  saveEntry,
  WorkspaceError,
  type WorkspaceDatabase,
  type WorkspaceIdentity,
} from '../src/lib/internal-workspace'
import { d1Http } from '../src/lib/d1-http'

/** Base de production `euneos-team-workspace` (wrangler.toml). */
export const PRODUCTION_DATABASE_ID = 'b178cff0-1860-4929-b697-d7152b32b53f'

const json = (value: string | undefined, what: string) => {
  try {
    const parsed = JSON.parse(value ?? '')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {}
  throw new WorkspaceError(400, `${what} : un objet JSON est attendu.`)
}

export async function calendrier(
  db: WorkspaceDatabase,
  actor: WorkspaceIdentity,
  [command, ...args]: string[],
  print: (value: unknown) => void = (value) => console.log(JSON.stringify(value, null, 2)),
) {
  switch (command) {
    case 'mois':
      return print(await listEntries(db, args[0] ?? '', args[1] ?? ''))
    case 'heures':
      return print(hoursByPerson(await listEntries(db, args[0] ?? '', 'equipe')))
    case 'fiche':
      return print(await getEntry(db, args[0] ?? ''))
    case 'creer': {
      const id = await saveEntry(db, actor, json(args[0], 'Fiche'), undefined, undefined, crypto.randomUUID())
      return print(await getEntry(db, id))
    }
    case 'modifier': {
      const current = await getEntry(db, args[0] ?? '')
      const changes = json(args[1], 'Champs à modifier')
      for (const field of ['id', 'version', 'created_by', 'updated_by'])
        if (field in changes) throw new WorkspaceError(400, `Le champ ${field} ne se modifie pas.`)
      await saveEntry(db, actor, { ...current, ...changes }, current.id, current.version)
      return print(await getEntry(db, current.id))
    }
    case 'deplacer': {
      const current = await getEntry(db, args[0] ?? '')
      await movePublication(db, actor, current.id, current.version, args[1])
      return print(await getEntry(db, current.id))
    }
    default:
      throw new WorkspaceError(400, 'Commandes : mois, heures, fiche, creer, modifier, deplacer.')
  }
}

if (import.meta.main) {
  const env = process.env
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'EUNEOS_EMAIL'].filter((name) => !env[name])
  if (missing.length) {
    console.error(`\n  Il manque dans .env : ${missing.join(', ')}\n`)
    process.exit(1)
  }
  const email = env.EUNEOS_EMAIL!.trim().toLowerCase()
  const responsables = (env.EUNEOS_RESPONSABLES ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  const db = d1Http(env.CLOUDFLARE_ACCOUNT_ID!, env.EUNEOS_D1_DATABASE_ID || PRODUCTION_DATABASE_ID, env.CLOUDFLARE_API_TOKEN!)
  calendrier(db, { email, admin: responsables.includes(email) }, process.argv.slice(2)).catch((error) => {
    console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n  Relire la fiche ou le mois avant de réessayer : ne pas répéter la commande à l’aveugle.\n`)
    process.exit(1)
  })
}
