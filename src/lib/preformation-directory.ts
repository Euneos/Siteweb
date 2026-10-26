import { NC } from './nocodb'
import { schoolIdentityText } from './public-dossier-match'
import { closedDossier } from './operational-links'
import type { PersonOutcome, PersonProjectionConfig, PersonRead } from './google-form-person'
import type { PreformationAnswers } from './preformation'

type Row = Record<string, unknown> & { Id: number }
const validId = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0
const text = (v: unknown) => String(v ?? '').trim()
const email = (v: unknown) => text(v).toLowerCase()
const schoolName = (v: unknown) => schoolIdentityText(v).replace(/\blgt\b/g, 'lycee')
const personName = (v: unknown) => schoolIdentityText(v).split(' ').filter(Boolean).sort().join(' ')
const review = (code: string): PersonOutcome => ({ state: 'review', code })

function closeSchool(a: string, b: string) {
  if (!a || !b || Math.abs(a.length - b.length) > 2) return false
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]))
    previous = current
  }
  return previous[b.length] <= 2
}

/** Bounded, complete snapshots only. An incomplete directory must never pick a winner. */
async function inventory(read: PersonRead, table: string, where?: string, fields?: string): Promise<Row[]> {
  const rows: Row[] = [], seen = new Set<number>()
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ limit: '200', offset: String(rows.length), sort: 'Id' })
    if (where) query.set('where', where)
    if (fields) query.set('fields', fields)
    const response = await read(`tables/${table}/records?${query}`) as { list?: Row[]; pageInfo?: { isLastPage?: boolean } }
    if (!Array.isArray(response.list)) throw new Error('identity_directory_incomplete')
    for (const row of response.list) {
      if (!validId(row.Id) || seen.has(row.Id)) throw new Error('identity_directory_incomplete')
      seen.add(row.Id); rows.push(row)
    }
    if (response.pageInfo?.isLastPage === true) return rows
    if (!response.list.length) throw new Error('identity_directory_incomplete')
  }
  throw new Error('identity_directory_incomplete')
}

/** Site-only fallback for an existing adult. Never expands the Google creation
 * policy or infers that a formateur is a stagiaire. All mutations remain in the
 * existing durable planner/checker/claim workflow. */
export async function planKnownPreformationAdult(
  config: PersonProjectionConfig, answers: PreformationAnswers, receivedAt: string,
  sourceTable: string, read: PersonRead,
): Promise<PersonOutcome> {
  const cohorts = config.cohorts.filter(c => [c.answer, ...(c.answers ?? [])].includes(answers.year))
  if (cohorts.length !== 1 || !validId(cohorts[0].id)) return review('cohort_unresolved')
  const cohort = cohorts[0]
  const parts = (await inventory(read, config.tables.records, `(cohortes_id,eq,${cohort.id})`, 'Id,cohortes_id,etablissements_id,fusionne_vers,statut'))
    .filter(p => p.cohortes_id === cohort.id && (p.fusionne_vers == null || p.fusionne_vers === '') && !closedDossier(p.statut))
  const schools = await inventory(read, NC.tables.etablissements, undefined, 'Id,nom')
  const name = schoolName(answers.school)
  // Only completed reports may supply a previously approved spelling. Never use
  // the current submission, pending replies or an unconfirmed dossier proposal.
  const sources = await inventory(read, sourceTable, '(statut_reprise,eq,Reportée dans le dossier)', 'Id,etablissement,annee_scolaire,dossier_id,statut_reprise')
  const aliases = sources.filter(s => s.statut_reprise === 'Reportée dans le dossier' && s.annee_scolaire === answers.year && validId(s.dossier_id))
  const candidates = parts.flatMap(part => {
    const school = schools.find(s => s.Id === part.etablissements_id)
    if (!school) return []
    const approved = (cohort.establishments ?? []).filter(e => e.participationId === part.Id && e.schoolId === school.Id)
    const labels = [school.nom, ...approved.map(e => e.answer), ...aliases.filter(s => s.dossier_id === part.Id).map(s => s.etablissement)]
    return labels.some(label => closeSchool(name, schoolName(label))) ? [{ school, part }] : []
  })
  if (candidates.length !== 1) return review(candidates.length ? 'establishment_not_unique' : 'establishment_unresolved')
  const { school, part } = candidates[0]
  const address = email(answers.email)
  const linkedEmail = await inventory(read, config.tables.people, `(email,eq,${address})~or(email_2,eq,${address})`)
  if (linkedEmail.length > 1) return review('identity_not_unique')
  if (linkedEmail.some(p => p.participations_id !== part.Id)) return review('cohort_conflict')
  const adults = await inventory(read, config.tables.people, `(participations_id,eq,${part.Id})`)
  if (adults.some(p => p.participations_id !== part.Id)) throw new Error('identity_directory_incomplete')
  const sameName = adults.filter(p => personName(`${text(p.prenom)} ${text(p.nom)}`) === personName(answers.name))
  if (sameName.length > 1) return review('identity_not_unique')
  if (!sameName.length) return review(linkedEmail.length ? 'identity_conflict' : 'identity_unresolved')
  const adult = sameName[0]
  if (linkedEmail.length && linkedEmail[0].Id !== adult.Id) return review('identity_conflict')
  const known = [email(adult.email), email(adult.email_2)].filter(Boolean)
  if (known.length && !known.includes(address)) return review('identity_conflict')
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(receivedAt))
  if (adult.date_pre_recu && adult.date_pre_recu !== date) return review('existing_value_conflict')
  const fillEmail = !known.length
  return { state: 'planned', plan: {
    family: 'preformation_a', table: config.tables.people, id: adult.Id,
    before: { date_pre_recu: adult.date_pre_recu ?? null, ...(fillEmail ? { email: adult.email ?? null } : {}) },
    after: { date_pre_recu: date, ...(fillEmail ? { email: address } : {}) },
    guard: [
      { table: config.tables.records, id: part.Id, fields: { cohortes_id: part.cohortes_id, etablissements_id: part.etablissements_id, fusionne_vers: part.fusionne_vers ?? null, statut: part.statut ?? null } },
      { table: NC.tables.etablissements, id: school.Id, fields: { nom: school.nom } },
      { table: config.tables.people, id: adult.Id, fields: { nom: adult.nom, prenom: adult.prenom ?? null, participations_id: part.Id, email_2: adult.email_2 ?? null, ...(!fillEmail ? { email: adult.email ?? null } : {}) } },
    ], remaining: true,
  } }
}
