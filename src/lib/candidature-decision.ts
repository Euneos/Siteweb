import type { SubmissionDatabase } from './candidature-store'
import { NC } from './nocodb'
import { sourceStatutDossier, statutCandidature, valeurStatutCandidature } from './statut-candidature'
import {
  CandidatureMailError, cancelDecisionDraft, confirmDecisionMail, dispatchCandidatureMail,
  getCandidatureMail, listCandidatureMails, mailHash, prepareDecisionMail, readDossier,
  type CandidatureMailEnv,
} from './candidature-mail'
import { decisionTemplate, renderDecision, type DecisionMailKind } from './candidature-mail-templates'
export interface DecisionEnv extends CandidatureMailEnv {
  CANDIDATURE_DECISIONS_ENABLED?: string
  CANDIDATURE_DECISION_WRITE_OWNER?: string
  CANDIDATURE_DECISION_CONCURRENCY_REVIEW?: string
}
type Context={db:SubmissionDatabase;token:string;env:DecisionEnv}
type Decision={id:string;participation_id:number;actor:string;kind:DecisionMailKind;state:string;snapshot:string;preview_hash:string;expires_at:string;write_started:number;with_email:number|null;saved_status:string|null;error_code:string|null}
const now=()=>new Date().toISOString()
const fail=(message:string):never=>{throw new CandidatureMailError(409,message)}
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value && typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}'
  return JSON.stringify(value)
}
export const decisionWritesEnabled=(env:DecisionEnv)=>env.CANDIDATURE_DECISIONS_ENABLED==='true'
  && env.CANDIDATURE_DECISION_WRITE_OWNER==='site' && !!env.CANDIDATURE_DECISION_CONCURRENCY_REVIEW?.trim()
const canSend=(env:DecisionEnv)=>env.CANDIDATURE_DECISION_SEND_ENABLED==='true' && env.CANDIDATURE_MAIL_SEND_ENABLED==='true' && env.CANDIDATURE_MAIL_OWNER==='site' && !!env.BREVO_API_KEY
const expected=(kind:DecisionMailKind)=>valeurStatutCandidature(kind==='accepted'?'Candidature acceptée':'Refuse')!
async function decision(db:SubmissionDatabase,id:string) {
  const row=await db.prepare('SELECT * FROM candidature_decisions WHERE id=?').bind(id).first<Decision>()
  if(!row)throw new CandidatureMailError(404,'Décision introuvable.')
  return row
}
export async function decisionView(ctx:Context,id:number) {
  const d=await readDossier(ctx.token,id)
  const mails=await listCandidatureMails(ctx.db,id)
  const decisions=(await ctx.db.prepare('SELECT id,state,kind,with_email,saved_status,saved_at,error_code FROM candidature_decisions WHERE participation_id=? ORDER BY created_at DESC').bind(id).all()).results
  return {dossier:{id,school:String(d.school.nom),city:String(d.school.ville ?? ''),code:String(d.part.code ?? `DOS-${id}`),cohort:String(d.cohort.nom ?? ''),
    recipient:String(d.school.referent_email),status:statutCandidature(sourceStatutDossier(d.part as {statut?:string;statut_origine?:string})).label},
    canPrepare:d.code==='Candidature recue' && !decisions.some((x:any)=>['draft','writing','review'].includes(x.state)),
    writesEnabled:decisionWritesEnabled(ctx.env),sendEnabled:canSend(ctx.env),mails,decisions}
}
export async function prepareDecisionScreen(ctx:Context & {participationId:number;kind:DecisionMailKind;actor:string}) {
  const before=await readDossier(ctx.token,ctx.participationId)
  const mail=await prepareDecisionMail(ctx)
  try {
    const after=await readDossier(ctx.token,ctx.participationId)
    if(canonical(before)!==canonical(after))fail('Le dossier a changé pendant la préparation. Rechargez le dossier.')
    const snapshot=canonical(before),hash=await mailHash([mail.id,mail.preview_hash,snapshot])
    await ctx.db.prepare(`INSERT INTO candidature_decisions(id,participation_id,actor,kind,state,snapshot,preview_hash,created_at,expires_at)
      VALUES(?,?,?,?,'draft',?,?,?,?)`).bind(mail.id,ctx.participationId,ctx.actor,ctx.kind,snapshot,hash,now(),mail.expires_at).run()
    return {id:mail.id,previewHash:hash,statusBefore:statutCandidature(String(before.part.statut)).label,statusAfter:expected(ctx.kind),
      payload:mail.payload,approved:mail.canConfirm,canWrite:decisionWritesEnabled(ctx.env),canSend:mail.canConfirm&&canSend(ctx.env),expiresAt:mail.expires_at}
  } catch(error) {await cancelDecisionDraft(ctx.db,mail.id,ctx.actor);throw error}
}
export async function cancelDecisionScreen(ctx:Context & {id:string;actor:string}) {
  const row=await decision(ctx.db,ctx.id)
  if(row.actor!==ctx.actor || row.state!=='draft')fail('Cette décision ne peut pas être annulée ici.')
  const claim=await ctx.db.prepare("UPDATE candidature_decisions SET state='cancelled' WHERE id=? AND state='draft' RETURNING id").bind(row.id).first()
  if(!claim)fail('Cette décision est déjà en cours.')
  await cancelDecisionDraft(ctx.db,row.id,ctx.actor)
}
/** Minimal status PATCH, journaled before the remote request. The shared D1 lock
 * coordinates this site and the Google bridge, not arbitrary external editors.
 * A positive operations review/exclusive-owner flag is mandatory before writes. */
export async function executeDecision(ctx:Context & {id:string;actor:string;previewHash:string;confirm:boolean;withEmail:boolean}) {
  if(!decisionWritesEnabled(ctx.env))fail('La décision est en lecture seule : les accès concurrents doivent être vérifiés avant activation.')
  const row=await decision(ctx.db,ctx.id)
  if(row.actor!==ctx.actor || !ctx.confirm || row.preview_hash!==ctx.previewHash)fail('Confirmez précisément l’aperçu préparé avec votre compte.')
  if(row.state==='saved'){
    if(row.with_email!==(ctx.withEmail?1:0))fail('La décision enregistrée utilisait un autre choix d’email. Relisez l’historique.')
    return {decision:'saved',status:row.saved_status,mail:await getCandidatureMail(ctx.db,row.id),emailRequested:row.with_email===1,replayed:true}
  }
  if(row.state!=='draft')fail('Cette décision est en cours ou à vérifier. Aucun nouvel essai automatique.')
  if(now()>row.expires_at)fail('L’aperçu a expiré : rechargez avant toute décision.')
  const mail=await getCandidatureMail(ctx.db,row.id)
  if(mail.state!=='draft')fail('Le message associé n’est plus un brouillon.')
  if(ctx.withEmail && (!mail.approval_ref || !canSend(ctx.env)))fail('L’envoi n’est pas disponible. Vous pouvez confirmer explicitement une décision sans email.')
  const claimed=await ctx.db.prepare("UPDATE candidature_decisions SET state='writing',with_email=? WHERE id=? AND state='draft' RETURNING id").bind(ctx.withEmail?1:0,row.id).first()
  if(!claimed)fail('La décision a déjà été prise en charge.')
  const owner='decision:'+row.id;let locked=false,writing=false,saved=false
  const unlock=async()=>{if(locked){await ctx.db.prepare('DELETE FROM operational_submission_locks WHERE target_id=? AND link_hash=?').bind(row.participation_id,owner).run();locked=false}}
  try {
    const lock=await ctx.db.prepare('INSERT INTO operational_submission_locks(target_id,link_hash) VALUES(?,?) ON CONFLICT(target_id) DO NOTHING RETURNING target_id').bind(row.participation_id,owner).first()
    if(!lock)fail('Une autre opération utilise ce dossier. Rechargez après sa fin.')
    locked=true
    if(await ctx.db.prepare('SELECT event_key FROM google_form_locks WHERE target_id=?').bind(row.participation_id).first())fail('Une ancienne écriture Google reste à vérifier.')
    const before=await readDossier(ctx.token,row.participation_id)
    if(canonical(before)!==row.snapshot || before.code!=='Candidature recue')fail('Le dossier ou ses coordonnées ont changé. Aucune décision appliquée : rechargez.')
    if(ctx.withEmail) {
      const template=decisionTemplate(ctx.env.CANDIDATURE_DECISION_TEMPLATES,row.kind)
      const payload=renderDecision(template,{school:String(before.school.nom),cohort:String(before.cohort.nom ?? `${before.cohort.annee_debut}–${before.cohort.annee_fin}`),email:String(before.school.referent_email)})
      const hash=await mailHash([mail.id,row.kind,row.participation_id,before.part.etablissements_id,before.part.cohortes_id,payload,template])
      if(!template.approvalRef || hash!==mail.preview_hash)fail('Le modèle a changé : préparez un nouvel aperçu.')
    }
    const latest=await readDossier(ctx.token,row.participation_id)
    if(canonical(latest)!==row.snapshot)fail('Le dossier a changé avant l’enregistrement. Rechargez.')
    if(!ctx.withEmail)await cancelDecisionDraft(ctx.db,row.id,ctx.actor)
    await ctx.db.prepare('UPDATE candidature_decisions SET write_started=1 WHERE id=? AND state=\'writing\'').bind(row.id).run()
    writing=true
    const status=expected(row.kind)
    const response=await fetch(`https://app.nocodb.com/api/v2/tables/${NC.tables.participations}/records`,{method:'PATCH',headers:{'xc-token':ctx.token,'Content-Type':'application/json'},body:JSON.stringify([{Id:row.participation_id,statut:status}]),signal:AbortSignal.timeout(12_000)})
    if(!response.ok)throw new Error('status_write_unknown')
    const after=await readDossier(ctx.token,row.participation_id)
    // All fields, including status origin, notes and relations must survive.
    const comparison={...after,part:{...after.part,statut:before.part.statut,UpdatedAt:before.part.UpdatedAt},code:before.code}
    if(!Object.hasOwn(before.part,'UpdatedAt'))delete comparison.part.UpdatedAt
    if(after.part.statut!==status || canonical(comparison)!==canonical(before))throw new Error('status_readback_changed')
    const persisted=await ctx.db.prepare("UPDATE candidature_decisions SET state='saved',saved_status=?,saved_at=?,error_code=NULL WHERE id=? AND state='writing' RETURNING id").bind(status,now(),row.id).first()
    if(!persisted)throw new Error('decision_receipt_lost')
    saved=true
    if(ctx.withEmail) {
      try {
        await confirmDecisionMail({...ctx,id:row.id,previewHash:mail.preview_hash,confirm:true})
        await dispatchCandidatureMail({...ctx,id:row.id})
      } catch {await ctx.db.prepare("UPDATE candidature_decisions SET error_code='mail_needs_review' WHERE id=?").bind(row.id).run()}
    }
    await unlock()
    return {decision:'saved',status,mail:await getCandidatureMail(ctx.db,row.id),emailRequested:ctx.withEmail,replayed:false}
  } catch(error) {
    if(writing && !saved) {
      try {await ctx.db.prepare("UPDATE candidature_decisions SET state='review',error_code='write_uncertain' WHERE id=?").bind(row.id).run()} catch {/* durable write marker and non-expiring lock remain */}
      return {decision:'review',status:null,mail:null,message:'L’enregistrement du statut n’a pas pu être confirmé. Aucun email déclenché : ne répétez pas la décision avant vérification.'}
    }
    if(saved) return {decision:'saved',status:expected(row.kind),mail:null,emailRequested:ctx.withEmail,message:'Décision enregistrée. Le suivi de l’email doit être relu avant toute nouvelle tentative.'}
    await ctx.db.prepare("UPDATE candidature_decisions SET state='cancelled',error_code='prewrite_conflict' WHERE id=? AND write_started=0").bind(row.id).run()
    try {await cancelDecisionDraft(ctx.db,row.id,ctx.actor)} catch {/* may already have been cancelled */}
    await unlock();throw error
  }
}
