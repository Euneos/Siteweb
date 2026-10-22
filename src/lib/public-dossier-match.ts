import { readContact } from './google-form-contact'
import { closedDossier } from './operational-links'
import type { OperationalTarget } from './operational-data'

type Row = Record<string, unknown> & { Id: number }
type Identity = { schoolName: string; city: string; schoolYear: string }
export type DossierMatch = { target: OperationalTarget | null; code: string }
const emailText = (value: unknown) => String(value ?? '').trim().toLowerCase()
export const schoolIdentityText = (value: unknown) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[’‘ʼ']/g, ' ').replace(/[-.]/g, ' ')
  .replace(/\bclg\b/g, 'college').replace(/\bst\b/g, 'saint').replace(/\bste\b/g, 'sainte')
  .replace(/\s+/g, ' ').trim()

function nearName(a: string, b: string) {
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
function initialName(a: string, b: string) {
  const left = a.split(' '), right = b.split(' ')
  if (left.length < 3 || left.length !== right.length) return false
  let initials = 0
  return left.every((word, i) => word === right[i] ||
    (i > 0 && ++initials === 1 && Math.min(word.length, right[i].length) === 1 && word[0] === right[i][0]))
}

/** Only contacts already recorded in this dossier; never trust pending public sources. */
function knownEmails(school: Row, part: Row): string[] {
  const values: unknown[] = [school.referent_email, school.email_direction, part.apporteur_email]
  const contact = readContact(String(part.notes ?? ''))
  if (contact) {
    values.push(...contact.declaredTrainers.map(t => t.email))
    if (Array.isArray(contact.operationalSubmissions)) {
      for (const entry of contact.operationalSubmissions) {
        if (!Array.isArray(entry?.reviewCodes) || entry.reviewCodes.length) continue
        values.push(entry?.data?.referrer?.email, entry?.data?.directionEmail)
      }
    }
  }
  return values.map(emailText).filter(Boolean)
}

export function resolvePublicDossier(
  schools: Row[], parts: Row[], cohorts: Row[], identity: Identity, email: string,
): DossierMatch {
  const review = (code: string): DossierMatch => ({ target: null, code })
  const active = cohorts.filter(c => (c.active === true || c.active === 1) && `${c.annee_debut}-${c.annee_fin}` === identity.schoolYear)
  if (active.length !== 1) return review('identity_cohort_review')
  const eligible = parts.filter(p => p.cohortes_id === active[0].Id &&
    (p.fusionne_vers == null || p.fusionne_vers === '') && !closedDossier(p.statut))
  const name = schoolIdentityText(identity.schoolName), city = schoolIdentityText(identity.city)
  const candidates = eligible.flatMap(part => {
    const school = schools.find(s => s.Id === part.etablissements_id)
    if (!school || !city || schoolIdentityText(school.ville) !== city) return []
    const official = schoolIdentityText(school.nom)
    return nearName(name, official) || initialName(name, official) ? [{ school, part }] : []
  })
  // Even an exact match does not override a second plausible dossier.
  if (candidates.length !== 1) return review(candidates.length ? 'identity_ambiguous' : 'identity_school_review')
  const { school, part } = candidates[0]
  const address = emailText(email)
  if (!address || !knownEmails(school, part).includes(address)) return review('identity_contact_review')
  // A reference address belonging exclusively to another school contradicts identity.
  const owners = schools.filter(s => [s.referent_email, s.email_direction].map(emailText).includes(address))
  if (owners.length && !owners.some(s => s.Id === school.Id)) return review('identity_contact_conflict')
  return { code: 'identity_matched', target: { participationId: part.Id, schoolId: school.Id, cohortId: active[0].Id } }
}

export const publicIdentityReasons: Record<string, string> = {
  identity_cohort_review: 'Année scolaire sans cohorte active unique.',
  identity_ambiguous: 'Plusieurs dossiers correspondent : choix de l’équipe nécessaire.',
  identity_school_review: 'Nom ou ville sans dossier correspondant.',
  identity_contact_review: 'Adresse du répondant non encore connue dans ce dossier.',
  identity_contact_conflict: 'Adresse connue pour un autre établissement.',
  identity_read_failed: 'Lecture de l’annuaire impossible : rapprochement non effectué.',
}
