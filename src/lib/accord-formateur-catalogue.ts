import type { SubmissionDatabase } from './candidature-store'
import { readAccordProjection } from './accord-formateur-projection'

/** Parent's common catalogue dispatcher calls this before OperationalInput parsing.
 * A trainer journey is NEVER returned as participationId (school dossier). */
export async function accordCatalogueEntry(
  db: SubmissionDatabase,
  row: Record<string, unknown>,
  source: unknown,
) {
  if (
    !source ||
    typeof source !== 'object' ||
    (source as { kind?: unknown }).kind !== 'accord_formateur'
  )
    return null
  const s = source as { schema?: unknown; answers?: unknown; receivedAt?: unknown }
  const details: string[][] = Array.isArray(s.answers)
    ? s.answers.flatMap((a) =>
        a && typeof a.label === 'string' && typeof a.value === 'string' ? [[a.label, a.value]] : [],
      )
    : [['Réponse', 'Structure à vérifier dans le journal.']]
  const key =
    typeof row.cle_reponse === 'string' && /^[a-f0-9]{64}$/.test(row.cle_reponse)
      ? row.cle_reponse
      : null
  const proof = key ? await readAccordProjection(db, key) : null
  // Complete in a stale/foreign register is not proof for this journal payload.
  const exactSource =
    proof &&
    JSON.stringify(source) ===
      JSON.stringify({ ...JSON.parse(proof.payload), receivedAt: proof.received_at })
  const verified = exactSource && proof.state === 'complete'
  details.push([
    'Report métier',
    verified
      ? `Accord et date du ${proof.agreement_date} relus dans le parcours formateur #${proof.journey_id}. Autres informations conservées dans la réponse.`
      : 'Réponse conservée ; accord et date non confirmés dans le parcours formateur.',
  ])
  return {
    school: 'Formateur',
    city: '',
    year: '',
    form: String(row.formulaire ?? 'Accord formateur'),
    state: verified
      ? 'Accord vérifié dans le parcours formateur'
      : 'Accord en attente — à vérifier',
    details,
    participationId: null,
  }
}
