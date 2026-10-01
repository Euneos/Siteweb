import { bilanCatalogueEntry } from './bilan-formateur-catalogue'
import { accordCatalogueEntry } from './accord-formateur-catalogue'
import { internalEnvironment } from './internal-context'
import { lireToutes } from './nocodb'
import { type SubmissionDatabase } from './candidature-store'
import { identityText, operationalRequest, hashOperational, type OperationalInput, type OperationalKind, type OperationalTarget } from './operational-data'
import { closedDossier, operationalConfig, operationalPath, OperationalLinkError } from './operational-links'
import { enregistrerOperational } from './operational-store'
import { finalQuestionnairePublicEntry } from './final-questionnaire'
import { preformationDetails } from './preformation'
import { postformationPublicEntry } from './postformation'
import { readPreformationProjection, preformationPendingReason } from './preformation-projection'

export const publicFormNames: Record<OperationalKind, string> = {
  contact: 'Fiche contact', deploiement: 'Organisation de la formation adultes',
  participants: 'Participants adultes', 'activites-jeunes': 'Organisation des activités avec les jeunes',
}
export function publicFormsConfig(locals: unknown) {
  const config = operationalConfig(locals)
  const table = internalEnvironment(locals).PUBLIC_FORMS_TABLE
  if (typeof table !== 'string' || !/^[a-z0-9]{10,30}$/.test(table))
    throw new OperationalLinkError(503, 'indisponible', 'Ce formulaire est momentanément indisponible.')
  return { ...config, table }
}
export type PublicIdentity = { schoolName: string; city: string; schoolYear: string }
export function parsePublicIdentity(value: unknown): PublicIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OperationalLinkError(400, 'identity', 'Indiquez votre établissement, sa ville et l’année scolaire.')
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(k => !['schoolName', 'city', 'schoolYear'].includes(k)))
    throw new OperationalLinkError(400, 'identity', 'Vérifiez l’identité de votre établissement.')
  const field = (key: string, max: number) => {
    if (typeof v[key] !== 'string' || !v[key].trim() || v[key].length > max || /[\u0000-\u001f\u007f]/.test(v[key]))
      throw new OperationalLinkError(400, 'identity', 'Indiquez votre établissement, sa ville et l’année scolaire.')
    return v[key].normalize('NFC').trim().replace(/\s+/g, ' ')
  }
  const schoolName = field('schoolName', 300), city = field('city', 150)
  const schoolYear = field('schoolYear', 20).replace(/[–—]/g, '-')
  if (!/^20\d{2}-20\d{2}$/.test(schoolYear) || Number(schoolYear.slice(5)) !== Number(schoolYear.slice(0, 4)) + 1)
    throw new OperationalLinkError(400, 'identity', 'Indiquez l’année scolaire au format 2026-2027.')
  return { schoolName, city, schoolYear }
}

// Exact identity and an already-known contact are needed for automatic projection.
// A different spelling or new contact is still collected, never guessed or rejected.
export async function matchPublicDossier(token: string, identity: PublicIdentity, email: string): Promise<OperationalTarget | null> {
  const schools = await lireToutes(token, 'etablissements', 'Id,nom,ville,referent_email,email_direction')
  const matches = schools.filter(s => identityText(s.nom) === identityText(identity.schoolName) && identityText(s.ville) === identityText(identity.city))
  if (matches.length !== 1) return null
  const cohorts = await lireToutes(token, 'cohortes', 'Id,annee_debut,annee_fin,active')
  const active = cohorts.filter(c => (c.active === true || c.active === 1) && `${c.annee_debut}-${c.annee_fin}` === identity.schoolYear)
  if (active.length !== 1) return null
  const parts = await lireToutes(token, 'participations', 'Id,etablissements_id,cohortes_id,fusionne_vers,statut')
  const dossiers = parts.filter(p => p.etablissements_id === matches[0].Id && p.cohortes_id === active[0].Id && p.fusionne_vers == null && !closedDossier(p.statut))
  if (dossiers.length !== 1) return null
  const addresses = [matches[0].referent_email, matches[0].email_direction]
  if (!addresses.some(a => typeof a === 'string' && a.trim().toLowerCase() === email)) return null
  return { participationId: dossiers[0].Id, schoolId: matches[0].Id, cohortId: active[0].Id }
}
type Receipt = { receipt: string; kind: OperationalKind; state: string; noco_id: number | null; target_id: number | null; code: string }
const load = (db: SubmissionDatabase, receipt: string) => db.prepare('SELECT * FROM public_form_receipts WHERE receipt=?').bind(receipt).first<Receipt>()

export async function limitPublicForm(db: SubmissionDatabase, request: Request) {
  // Cloudflare supplies this header. Missing in local tests: one shared test bucket.
  const now = Date.now(), window = Math.floor(now / 600_000)
  const bucket = await hashOperational(`${window}:${request.headers.get('cf-connecting-ip') ?? 'local'}`)
  const result = await db.prepare(`INSERT INTO public_form_rate_limits(bucket,requests,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET requests=requests+1 WHERE requests<20`).bind(bucket, now + 1_200_000).run()
  if (result.meta.changes !== 1) throw new OperationalLinkError(429, 'rate_limit', 'Trop d’envois rapprochés. Conservez votre saisie et réessayez dans quelques minutes.')
  await db.prepare('DELETE FROM public_form_rate_limits WHERE expires_at<?').bind(now).run()
}

/** Append a durable source BEFORE touching a dossier. No public read, no email,
 * no guessed school, no replacement of another respondent's answer. */
export async function receivePublicForm(input: {
  db: SubmissionDatabase; token: string; table: string; identity: PublicIdentity; kind: OperationalKind; data: OperationalInput
}) {
  const { db, token, table, kind, data } = input
  const identity = parsePublicIdentity(input.identity)
  const payload = JSON.stringify({ identity, kind, answers: data })
  const receipt = await hashOperational(payload), answersHash = await hashOperational(JSON.stringify(data))
  const claimed = await db.prepare('INSERT OR IGNORE INTO public_form_receipts(receipt,kind,answers_hash) VALUES (?,?,?)').bind(receipt, kind, answersHash).run()
  const row = (await load(db, receipt))!
  // A retry may reconcile a lost POST response, but never blindly repeat it.
  const lookup = await operationalRequest(token, `/tables/${table}/records?${new URLSearchParams({ where: `(cle_reponse,eq,${receipt})`, limit: '2' })}`) as { list: Record<string, unknown>[] }
  if (!Array.isArray(lookup.list) || lookup.list.length > 1) throw new Error('Ambiguous source receipt')
  const fields = {
    cle_reponse: receipt, formulaire: publicFormNames[kind], etablissement: identity.schoolName,
    ville: identity.city, annee_scolaire: identity.schoolYear, referent_email: data.referrer.email,
    reponses: payload, source_url: `https://euneos.fr${operationalPath(kind)}`,
  }
  let source = lookup.list[0]
  if (!source) {
    const ownership = await db.prepare('UPDATE public_form_receipts SET capture_started=1 WHERE receipt=? AND capture_started=0 AND noco_id IS NULL').bind(receipt).run()
    if (ownership.meta.changes !== 1) return { state: 'processing', code: 'capture_pending', duplicate: true }
    const saved = await operationalRequest(token, `/tables/${table}/records`, 'POST', [{ ...fields, statut_reprise: 'À rapprocher' }]) as { Id: number } | { Id: number }[]
    const id = Array.isArray(saved) ? saved[0]?.Id : saved?.Id
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid source receipt')
    source = await operationalRequest(token, `/tables/${table}/records/${id}`) as Record<string, unknown>
  }
  if (!Number.isSafeInteger(source.Id) || Object.entries(fields).some(([key, value]) => source[key] !== value))
    throw new Error('Source readback mismatch')
  await db.prepare('UPDATE public_form_receipts SET noco_id=? WHERE receipt=?').bind(Number(source.Id), receipt).run()
  if (row.state !== 'processing') return { state: 'complete', code: 'received', duplicate: true }

  let target: OperationalTarget | null = null
  try { target = await matchPublicDossier(token, identity, data.referrer.email) } catch { /* Source is durable; team can reconcile if directory is unavailable. */ }
  let code = 'identity_review', state = 'review'
  if (target) {
    await db.prepare('UPDATE public_form_receipts SET target_id=?,school_id=?,cohort_id=? WHERE receipt=?')
      .bind(target.participationId, target.schoolId, target.cohortId, receipt).run()
    try {
      const result = await enregistrerOperational({ db, token, linkHash: receipt, target, kind, data, publicReceipt: true })
      code = result.code; state = result.state === 'complete' ? 'complete' : 'review'
    } catch { code = 'projection_review' }
  }
  // Failure here cannot lose the original source or turn it into a fake failure.
  try {
    await operationalRequest(token, `/tables/${table}/records`, 'PATCH', [{ Id: source.Id,
      dossier_id: target?.participationId ?? null,
      statut_reprise: state === 'complete' ? 'Reportée dans le dossier' : 'À vérifier',
      detail_reprise: code,
    }])
  } catch { /* The source keeps its initial À rapprocher label. */ }
  await db.prepare('UPDATE public_form_receipts SET state=?,code=? WHERE receipt=?').bind(state, code, receipt).run()
  // Uniform public receipt: never reveal whether a school, email or dossier exists.
  return { state: 'complete', code: 'received', duplicate: claimed.meta.changes !== 1 }
}

/** Private team catalogue only; this function is never exposed on public GETs. */
export async function listPublicForms(locals: unknown) {
  if (!internalEnvironment(locals).PUBLIC_FORMS_TABLE) return []
  const { db, token, table } = publicFormsConfig(locals)
  const response = await operationalRequest(token, `/tables/${table}/records?limit=50&sort=-Id`) as { list: Record<string, unknown>[] }
  if (!Array.isArray(response.list)) throw new Error('Invalid public response list')
  const { results } = await db.prepare('SELECT receipt,state,code,target_id FROM public_form_receipts ORDER BY created_at DESC LIMIT 100').bind().all<Receipt>()
  const pending = await pendingQuestionnaireSources(db, new Set(response.list.map(row => String(row.cle_reponse))))
  const entries = await Promise.all(response.list.map(async row => {
    const receipt = results.find(r => r.receipt === row.cle_reponse)
    const source = JSON.parse(String(row.reponses)) as { answers: OperationalInput }
    const postformation = await postformationPublicEntry(db, row, source)
    if (postformation) return postformation
    const finalEntry = await finalQuestionnairePublicEntry(db, row, source)
    if (finalEntry) return finalEntry
    const questionnaire = preformationDetails(source)
    if (questionnaire) {
      const projection = await readPreformationProjection(db, String(row.cle_reponse))
      const verified = projection?.state === 'complete'
      return { school: String(row.etablissement), city: String(row.ville ?? ''), year: String(row.annee_scolaire), form: String(row.formulaire),
        state: verified ? 'Réception préformation vérifiée sur l’adulte' : 'Réception préformation en attente — à vérifier',
        details: [...questionnaire, ['Réception métier', verified ? `Adulte #${projection.adult_id} · réception du ${projection.date_pre} vérifiée. Réponses pédagogiques conservées au journal.` : preformationPendingReason(projection?.code ?? 'projection_pending')]],
        participationId: verified ? projection.participation_id : null,
      }
    }
    const bilan = await bilanCatalogueEntry(db, row, source)
    if (bilan) return bilan
    const agreement = await accordCatalogueEntry(db, row, source)
    if (agreement) return agreement
    const a = source.answers
    const details = [
      ['Référent', `${a.referrer.name} — ${a.referrer.email}`],
      ['Direction', a.directionEmail],
      ['Établissement', [a.schoolDetails.academy, a.schoolDetails.address, a.schoolDetails.postalCode, a.schoolDetails.type].filter(Boolean).join(' · ')],
      ['Regroupement', a.operations.associatedSchools],
      ['Formation', a.formation ? [a.formation.format, a.formation.start, a.formation.end, a.formation.sessions ? `${a.formation.sessions} séances` : '', a.formation.planning].filter(Boolean).join(' · ') : ''],
      ['Formateurs déclarés', a.declaredTrainers.map(p => `${p.name} — ${p.email}`).join('\n')],
      ['Participants adultes', a.participants.map(p => `${p.firstName} ${p.lastName} — ${p.email} — ${p.role}`).join('\n')],
      ['Pré-formation', a.preformation ?? ''],
      ['Intérêt pour l’évaluation', a.evaluationInterest ? `${a.evaluationInterest.answer} — ${a.evaluationInterest.level}` : ''],
      ['Activités jeunes', a.youth ? `${a.youth.totalClasses} classes · ${a.youth.totalStudents} élèves · ${a.youth.levels}\nÉvaluation : ${a.youth.evaluation ? 'Oui' : 'Non'}\nGroupes actifs : ${a.youth.activeClasses} (${a.youth.activeCount ?? 'à préciser'})\nGroupes contrôle : ${a.youth.controlClasses} (${a.youth.controlCount ?? 'à préciser'})\nT1 actif : ${a.youth.activeT1} · T2 actif : ${a.youth.activeT2} · T1 contrôle : ${a.youth.controlT1}\n${a.youth.workshopCount ?? 'À préciser'} ateliers · ${a.youth.workshopSchedule}` : ''],
    ].filter(([, value]) => value)
    return { school: String(row.etablissement), city: String(row.ville), year: String(row.annee_scolaire), form: String(row.formulaire),
      state: receipt?.state === 'complete' ? 'Reportée dans le dossier' : 'Réponse reçue — à vérifier', details,
      participationId: receipt?.target_id ?? null,
    }
  }))
  return [...pending, ...entries]
}

/** A failed or uncertain journal POST must remain visible to the team. Do not
 * reset the write marker or blindly send it again. Payloads are private D1 data. */
async function pendingQuestionnaireSources(db: SubmissionDatabase, visibleReceipts: Set<string>) {
  const { results: tables } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('public_bilan_formateur_projections','public_accord_projections','public_final_questionnaire_projections')").bind().all<{ name: string }>()
  const pending = []
  for (const { name } of tables) {
    if (!['public_bilan_formateur_projections', 'public_accord_projections', 'public_final_questionnaire_projections'].includes(name)) continue
    const { results } = await db.prepare(`SELECT p.receipt,p.payload,p.received_at FROM ${name} p
      JOIN public_form_receipts r ON r.receipt=p.receipt
      WHERE r.noco_id IS NULL AND r.capture_started=1 ORDER BY p.received_at DESC LIMIT 100`).bind().all<{receipt:string;payload:string;received_at:string}>()
    for (const row of results) {
      if (visibleReceipts.has(row.receipt)) continue
      const payload = JSON.parse(row.payload)
      const answers = Array.isArray(payload.answers) ? payload.answers : []
      const field = (key: string) => answers.find((a: any) => a.key === key)?.value
      pending.push({
        school: typeof field('school') === 'string' ? field('school') : '', city: '',
        year: typeof field('year') === 'string' ? field('year') : '',
        form: name === 'public_bilan_formateur_projections' ? 'Bilan formateur' : name === 'public_accord_projections' ? 'Accord formateur' : payload.kind === 'evaluation_fin_formation' ? 'Évaluation de fin de formation' : 'Bilan établissement',
        state: 'Transmission au journal non confirmée — à vérifier', participationId: null,
        details: [
          ['Référence de réception', row.receipt],
          ['Conservation', `Réponse conservée dans le registre du site le ${row.received_at}. Aucun report métier confirmé. Vérifier le journal avant toute reprise ; ne pas demander un nouvel envoi.`],
          ...answers.flatMap((a: any) => typeof a?.label === 'string' && (typeof a.value === 'string' || (Array.isArray(a.value) && a.value.every((v: any) => typeof v === 'string'))) ? [[a.label, Array.isArray(a.value) ? a.value.join(' · ') : a.value]] : []),
        ],
      })
    }
  }
  return pending
}
