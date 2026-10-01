import type { SubmissionDatabase } from './candidature-store'
import { readBilanProjection } from './bilan-formateur-store'
const fieldNames: Record<string, string> = {
  bilan_recu: 'bilan reçu',
  date_debut: 'début de mission',
  date_fin_reelle: 'fin réelle de mission',
  nb_adultes_formes: 'nombre d’adultes formés',
  dates_respectees: 'respect des dates',
  difficulte: 'difficulté signalée',
}
export async function bilanCatalogueEntry(
  db: SubmissionDatabase,
  row: Record<string, unknown>,
  source: unknown,
) {
  if (!source || typeof source !== 'object' || (source as any).kind !== 'bilan_formateur')
    return null
  const s = source as any
  const details: string[][] = Array.isArray(s.answers)
    ? s.answers.flatMap((a: any) =>
        typeof a?.label === 'string' &&
        (typeof a.value === 'string' ||
          (Array.isArray(a.value) && a.value.every((v: any) => typeof v === 'string')))
          ? [[a.label, Array.isArray(a.value) ? a.value.join(' · ') : a.value]]
          : [],
      )
    : []
  const proof =
    typeof row.cle_reponse === 'string' && /^[a-f0-9]{64}$/.test(row.cle_reponse)
      ? await readBilanProjection(db, row.cle_reponse)
      : null
  const verified =
    proof?.state === 'complete' &&
    JSON.stringify(source) ===
      JSON.stringify({ ...JSON.parse(proof.payload), receivedAt: proof.received_at })
  const fields = verified ? JSON.parse(proof.fields_json ?? '{}') : {}
  const plan = proof?.plan ? JSON.parse(proof.plan) : null
  details.push([
    'Informations vérifiées',
    verified
      ? `Mission #${proof.mission_id} identifiée. Champs relus : ${
          Object.keys(fields)
            .map((key) => fieldNames[key] ?? 'information à vérifier')
            .join(', ') || 'aucun report de champ'
        }. Les autres réponses restent au journal ; ni statut, ni contrat, ni facture validés.`
      : 'Réponse conservée ; mission ou report non confirmé.',
  ])
  if (plan?.reasons?.length)
    details.push([
      'À vérifier',
      plan.reasons
        .map((reason: string) =>
          reason.startsWith('nonempty_conflict:')
            ? `Valeur existante conservée : ${fieldNames[reason.slice('nonempty_conflict:'.length)] ?? 'information à vérifier'}.`
            : 'Rapprochement à vérifier.',
        )
        .join(' '),
    ])
  return {
    school: String(row.etablissement ?? ''),
    city: '',
    year: String(row.annee_scolaire ?? ''),
    form: String(row.formulaire ?? 'Bilan formateur'),
    state: verified
      ? Object.keys(fields).length
        ? 'Bilan — report partiel vérifié'
        : 'Bilan reçu — mission identifiée, sans report'
      : 'Bilan en attente — à vérifier',
    details,
    participationId: verified ? proof.participation_id : null,
  }
}
