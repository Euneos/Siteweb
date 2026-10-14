#!/usr/bin/env bun
/**
 * Réponses des formulaires du site restées sans dossier (« À vérifier », « À rapprocher »).
 * Le site ne rattache une réponse que si le nom et la ville correspondent exactement :
 * une faute de frappe suffit à la laisser de côté. Cet outil les montre avec les dossiers
 * candidats, puis les rattache par le même report que le site (`enregistrerOperational`).
 *
 *   bun scripts/rattacher-reponses.ts liste
 *   bun scripts/rattacher-reponses.ts rattacher <Id réponse> <Id dossier> [--essai]
 *
 * Variables .env : NOCODB_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
 */
import { d1Http } from '../src/lib/d1-http'
import { identityText, operationalRequest, type OperationalKind, type OperationalTarget } from '../src/lib/operational-data'
import { enregistrerOperational } from '../src/lib/operational-store'
import { closedDossier } from '../src/lib/operational-links'
import { lireToutes } from '../src/lib/nocodb'

/** Table `reponses_formulaires_site` (PUBLIC_FORMS_TABLE, wrangler.toml). */
const TABLE = 'mu8yi5r8lqwiu1n'
/** Base D1 `euneos-form-submissions` (FORM_SUBMISSIONS, wrangler.toml). */
const FORM_DB = 'cd011a86-8198-4348-b652-aa09ca245d11'
const DONE = 'Reportée dans le dossier'

type Row = Record<string, unknown> & { Id: number }
const env = process.env
const token = env.NOCODB_TOKEN ?? ''
const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()

async function pending(): Promise<Row[]> {
  const where = encodeURIComponent(`(statut_reprise,neq,${DONE})`)
  const response = (await operationalRequest(token, `/tables/${TABLE}/records?where=${where}&limit=200&sort=Id`)) as { list: Row[] }
  return response.list
}

async function directory() {
  const [schools, parts, cohorts] = await Promise.all([
    lireToutes(token, 'etablissements', 'Id,nom,ville,referent_email,email_direction'),
    lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers,statut'),
    lireToutes(token, 'cohortes', 'Id,annee_debut,annee_fin,active'),
  ])
  return { schools, parts, cohorts }
}

/** Dossiers ouverts candidats : même adresse de référent, ou même nom et ville. */
function candidates(row: Row, dir: Awaited<ReturnType<typeof directory>>) {
  const email = lower(row.referent_email)
  const year = String(row.annee_scolaire ?? '')
  const cohort = dir.cohorts.find((c) => (c.active === true || c.active === 1) && `${c.annee_debut}-${c.annee_fin}` === year)
  const schools = dir.schools.filter((s) =>
    (email && [s.referent_email, s.email_direction].some((a) => lower(a) === email)) ||
    (identityText(s.nom) === identityText(row.etablissement) && identityText(s.ville) === identityText(row.ville)))
  return schools.flatMap((s) => dir.parts
    .filter((p) => p.etablissements_id === s.Id && (!cohort || p.cohortes_id === cohort.Id) && p.fusionne_vers == null && !closedDossier(p.statut))
    .map((p) => ({ dossier: p.Id, etablissement: s.nom, ville: s.ville, statut: p.statut, par: email && [s.referent_email, s.email_direction].some((a) => lower(a) === email) ? 'adresse' : 'nom' })))
}

async function liste() {
  const [rows, dir] = await Promise.all([pending(), directory()])
  console.log(JSON.stringify(rows.map((row) => ({
    reponse: row.Id, formulaire: row.formulaire, saisi: `${row.etablissement} (${row.ville})`, email: row.referent_email,
    statut: row.statut_reprise, candidats: candidates(row, dir),
  })), null, 2))
}

async function rattacher(responseId: number, dossierId: number, essai: boolean) {
  const row = (await operationalRequest(token, `/tables/${TABLE}/records/${responseId}`)) as Row
  if (!row?.Id) throw new Error(`Réponse ${responseId} introuvable.`)
  if (row.statut_reprise === DONE) throw new Error(`Réponse ${responseId} déjà reportée dans le dossier ${row.dossier_id}.`)
  const part = (await operationalRequest(token, `/tables/participations/records/${dossierId}`).catch(() => null)) as Row | null
  const dossier = part?.Id ? part : (await lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers,statut')).find((p) => p.Id === dossierId)
  if (!dossier) throw new Error(`Dossier ${dossierId} introuvable.`)
  if (dossier.fusionne_vers != null) throw new Error(`Dossier ${dossierId} est un doublon archivé : utiliser le dossier ${dossier.fusionne_vers}.`)
  if (closedDossier(dossier.statut)) throw new Error(`Dossier ${dossierId} est clos (${dossier.statut}).`)
  const payload = JSON.parse(String(row.reponses)) as { kind: OperationalKind; answers: unknown }
  const target: OperationalTarget = { participationId: dossier.Id, schoolId: Number(dossier.etablissements_id), cohortId: Number(dossier.cohortes_id) }
  const receipt = String(row.cle_reponse)
  if (essai) {
    console.log(JSON.stringify({ essai: true, reponse: row.Id, formulaire: row.formulaire, saisi: row.etablissement, vers: target, rien_ecrit: true }, null, 2))
    return
  }
  const missing = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((name) => !env[name])
  if (missing.length) throw new Error(`Il manque dans .env : ${missing.join(', ')}`)
  const db = d1Http(env.CLOUDFLARE_ACCOUNT_ID!, FORM_DB, env.CLOUDFLARE_API_TOKEN!)
  // Même séquence que receivePublicForm (src/lib/public-forms.ts), avec le dossier choisi par l'équipe.
  await db.prepare('UPDATE public_form_receipts SET target_id=?,school_id=?,cohort_id=? WHERE receipt=?')
    .bind(target.participationId, target.schoolId, target.cohortId, receipt).run()
  let code = 'projection_review', state = 'review'
  try {
    const result = await enregistrerOperational({ db, token, linkHash: receipt, target, kind: payload.kind, data: payload.answers as never, publicReceipt: true })
    code = result.code; state = result.state === 'complete' ? 'complete' : 'review'
  } catch (error) {
    code = `projection_review: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200)
  }
  await operationalRequest(token, `/tables/${TABLE}/records`, 'PATCH', [{ Id: row.Id, dossier_id: target.participationId,
    statut_reprise: state === 'complete' ? DONE : 'À vérifier', detail_reprise: code }])
  await db.prepare('UPDATE public_form_receipts SET state=?,code=? WHERE receipt=?').bind(state, code.slice(0, 60), receipt).run()
  const relu = (await operationalRequest(token, `/tables/${TABLE}/records/${row.Id}`)) as Row
  console.log(JSON.stringify({ reponse: relu.Id, dossier: relu.dossier_id, statut: relu.statut_reprise, detail: relu.detail_reprise }, null, 2))
}

if (import.meta.main) {
  if (!token) { console.error('\n  Il manque NOCODB_TOKEN dans .env\n'); process.exit(1) }
  const [command, a, b, flag] = process.argv.slice(2)
  const run = command === 'liste' ? liste()
    : command === 'rattacher' && Number(a) > 0 && Number(b) > 0 ? rattacher(Number(a), Number(b), flag === '--essai')
    : Promise.reject(new Error('Commandes : liste · rattacher <Id réponse> <Id dossier> [--essai]'))
  run.catch((error) => { console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n  Relire avec « liste » avant de réessayer.\n`); process.exit(1) })
}
