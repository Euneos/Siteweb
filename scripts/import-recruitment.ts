// Private manifest stays outside Git. This command never changes schema or existing contacts.
// bun --env-file=/private/.env scripts/import-recruitment.ts /private/contacts.json [--confirmer]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { d1Http } from '../src/lib/d1-http'
import { parseRecruitment, recruitmentId, importRecruitment, readRecruitment } from '../src/lib/recruitment'
const file = process.argv[2]
if (!file || resolve(file).startsWith(resolve('.') + '/')) throw new Error('Le manifeste privé doit rester hors du dépôt.')
const rows = JSON.parse(readFileSync(file,'utf8'))
if (!Array.isArray(rows) || !rows.length) throw new Error('Liste vide ou invalide.')
const ids = new Set()
for (const row of rows) {
  const id = recruitmentId(row.id)
  if(ids.has(id)) throw new Error('Identifiant répété dans le manifeste.')
  ids.add(id)
  parseRecruitment(row)
}
if (!process.argv.includes('--confirmer')) {
  console.log(`${rows.length} contacts validés. Simulation uniquement : aucune écriture.`)
} else {
  const env = process.env
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Accès D1 local absent.')
  const db = d1Http(env.CLOUDFLARE_ACCOUNT_ID, env.EUNEOS_D1_DATABASE_ID || 'b178cff0-1860-4929-b697-d7152b32b53f', env.CLOUDFLARE_API_TOKEN)
  // Preflight the entire set before any write; stop if an ID is already present.
  for(const row of rows) if(await readRecruitment(db,row.id)) throw new Error(`La fiche ${row.id} existe déjà. Arrêt sans écriture.`)
  let count=0
  try {
    for(const row of rows) { await importRecruitment(db,row,'charlotte@euneos.fr'); count++ }
    console.log(`${count} contacts créés et relus.`)
  } catch {
    throw new Error(`${count} contacts confirmés avant interruption. Ne pas répéter : relire la base et réconcilier le manifeste restant.`)
  }
}
