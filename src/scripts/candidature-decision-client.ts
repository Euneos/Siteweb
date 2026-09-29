const root=document.querySelector<HTMLElement>('#decision-app')
if(root){
  const id=Number(root.dataset.dossier),admin=root.dataset.admin==='true'
  const el=<T extends HTMLElement=HTMLElement>(key:string)=>root.querySelector<T>('#dm-'+key)!
  const api='/api/interne/candidature-emails'
  let preview:any=null,busy=false,attempted=false
  const feedback=(message:string)=>{el('feedback').textContent=message}
  const updateButtons=()=>{
    const confirmed=el<HTMLInputElement>('consent').checked
    el<HTMLButtonElement>('save-only').disabled=!preview?.canWrite||!confirmed||busy||attempted
    el<HTMLButtonElement>('send').disabled=!preview?.canWrite||!preview?.canSend||!confirmed||busy||attempted
    el<HTMLButtonElement>('cancel').disabled=busy||attempted
  }
  async function call(body:Record<string,unknown>){
    const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    const data=await response.json()
    if(!response.ok)throw new Error(data.error ?? 'Opération indisponible. Actualisez pour vérifier son état.')
    return data
  }
  const names:Record<string,string>={ar:'Accusé de réception',accepted:'Acceptation',refused:'Refus'}
  const states:Record<string,string>={draft:'Brouillon — aucun envoi',cancelled:'Annulé — aucun envoi',awaiting_receipt:'Dépôt à vérifier — aucun envoi',queued:'Email en attente',sending:'Envoi à vérifier — ne pas renvoyer',uncertain:'Résultat incertain — ne pas renvoyer',accepted:'Accepté par Brevo — livraison à vérifier',rejected:'Rejeté par Brevo — aucun renvoi automatique'}
  async function load(keepFeedback=false){
    el<HTMLButtonElement>('refresh').disabled=true
    try{
      const response=await fetch(`${api}?participationId=${id}`,{cache:'no-store'}),data=await response.json()
      if(!response.ok||!data.dossier)throw new Error(data.error ?? 'Le dossier ne peut pas être chargé.')
      if(data.dossier.id!==id)throw new Error('Le dossier retourné ne correspond pas au lien. Aucune action possible.')
      el('school').textContent=data.dossier.school
      el('context').textContent=`${data.dossier.code} · ${data.dossier.city} · Cohorte ${data.dossier.cohort}`
      el('status').textContent=data.dossier.status;el('recipient').textContent=data.dossier.recipient
      const canPrepare=admin&&data.canPrepare
      el<HTMLSelectElement>('kind').disabled=!canPrepare||!!preview
      el<HTMLButtonElement>('prepare').disabled=!canPrepare||!!preview
      el('availability').textContent=!admin?'Consultation seule : les décisions sont réservées aux responsables.':!data.writesEnabled?'Vous pouvez consulter les propositions. L’enregistrement est désactivé jusqu’à la vérification des accès concurrents.':!data.canPrepare?'Ce dossier a déjà une décision ou une opération à vérifier. Aucune nouvelle décision proposée.':'Préparez un aperçu, puis choisissez explicitement de prévenir ou non le référent.'
      const journal=el('journal');journal.replaceChildren()
      for(const decision of data.decisions ?? []){
        const li=document.createElement('li')
        li.textContent=decision.state==='saved'?`Décision enregistrée : ${decision.saved_status}. ${decision.with_email?'Email demandé ; voir son état ci-dessous.':'Sans email.'}`:
          decision.state==='review'||decision.state==='writing'?'Décision à vérifier. Aucun nouvel essai avant contrôle.':decision.state==='draft'?'Décision préparée, pas encore enregistrée.':'Préparation annulée.'
        if(decision.state==='draft'&&admin&&!preview){const button=document.createElement('button');button.className='iw-button';button.textContent='Annuler ce brouillon';button.onclick=async()=>{button.disabled=true;try{await call({action:'cancel-decision',id:decision.id});await load()}catch(e){feedback((e as Error).message)}};li.append(button)}
        journal.append(li)
      }
      for(const mail of data.mails ?? []){
        const li=document.createElement('li')
        li.textContent=`${names[mail.kind] ?? 'Email'} : ${mail.provider_state==='delivered'?'Livré — preuve Brevo':states[mail.state] ?? 'À vérifier'}${mail.message_id?` · Référence ${mail.message_id}`:''}`
        if(admin&&['sending','uncertain','accepted'].includes(mail.state)){
          const button=document.createElement('button');button.className='iw-button';button.textContent='Vérifier auprès de Brevo';button.onclick=async()=>{button.disabled=true;try{const result=await call({action:'reconcile',id:mail.id});feedback(result.evidence==='not_found'?'Aucune preuve supplémentaire retrouvée. Aucun renvoi effectué.':'Preuve fournisseur relue.');await load(true)}catch(e){feedback((e as Error).message)}};li.append(button)
        }
        journal.append(li)
      }
      if(!journal.childElementCount){const li=document.createElement('li');li.textContent='Aucune décision ou preuve email dans ce registre. Cela ne prouve pas l’absence d’un ancien envoi.';journal.append(li)}
      if(!keepFeedback)feedback('Dossier actualisé. Aucune modification effectuée.')
    }catch(error){feedback((error as Error).message);el<HTMLButtonElement>('prepare').disabled=true;el<HTMLSelectElement>('kind').disabled=true}
    finally{el<HTMLButtonElement>('refresh').disabled=false}
  }
  el('form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!admin)return
    const kind=el<HTMLSelectElement>('kind').value;if(!kind)return
    busy=true;el<HTMLButtonElement>('prepare').disabled=true
    try{
      preview=await call({action:'decision-preview',participationId:id,kind})
      attempted=false;el<HTMLInputElement>('consent').checked=false
      el('transition').textContent=`${preview.statusBefore} → ${preview.statusAfter}`
      el('preview-to').textContent=preview.payload.to;el('preview-subject').textContent=preview.payload.subject;el('preview-text').textContent=preview.payload.text
      el('template-note').textContent=!preview.approved?'Proposition de texte non validée. L’envoi est bloqué ; vous pouvez enregistrer uniquement la décision.':!preview.canSend?'Modèle validé, mais transport désactivé. Aucun envoi possible actuellement.':'Ce message sera envoyé seulement avec « Enregistrer et envoyer ».'
      el('preview').hidden=false;el('preview-title').focus();feedback('Vérifiez le dossier, le destinataire et le message avant de confirmer.')
      el<HTMLSelectElement>('kind').disabled=true
    }catch(error){feedback((error as Error).message);el<HTMLButtonElement>('prepare').disabled=false}
    finally{busy=false;updateButtons()}
  })
  el('consent').addEventListener('change',updateButtons)
  async function decide(withEmail:boolean){
    if(!preview||busy||attempted||!el<HTMLInputElement>('consent').checked)return
    busy=true;attempted=true;updateButtons();feedback('Enregistrement en cours. Ne répétez pas la demande.')
    try{
      const result=await call({action:'decide',id:preview.id,previewHash:preview.previewHash,confirm:true,withEmail})
      if(result.decision==='review')feedback(result.message ?? 'Décision à vérifier. Aucun email déclenché ; ne répétez pas la demande.')
      else if(result.decision==='saved'){
        const mail=result.mail
        feedback(result.emailRequested===false?`Décision enregistrée : ${result.status}. Aucun email envoyé.`:
          mail?.state==='accepted'?`Décision enregistrée : ${result.status}. Email accepté par Brevo ; livraison à vérifier.`:
          ['sending','uncertain'].includes(mail?.state)?`Décision enregistrée : ${result.status}. Résultat d’envoi incertain ; aucun renvoi automatique.`:
          `Décision enregistrée : ${result.status}. L’email reste à vérifier dans l’historique. Aucun nouvel envoi automatique.`)
      }else throw new Error('Résultat incomplet. Actualisez pour vérifier le statut et l’email avant toute nouvelle action.')
      el('preview').hidden=true;preview=null;await load(true)
    }catch(error){feedback(`${(error as Error).message} Actualisez pour vérifier le dossier et l’historique avant toute nouvelle tentative.`)}
    finally{busy=false;updateButtons()}
  }
  el('save-only').addEventListener('click',()=>decide(false));el('send').addEventListener('click',()=>decide(true))
  el('cancel').addEventListener('click',async()=>{
    if(!preview||busy||attempted)return;busy=true;updateButtons()
    try{await call({action:'cancel-decision',id:preview.id});preview=null;el('preview').hidden=true;await load()}
    catch(error){feedback((error as Error).message)}finally{busy=false;updateButtons()}
  })
  el('refresh').addEventListener('click',()=>{if(busy)return;preview=null;attempted=false;el('preview').hidden=true;load()})
  load()
}
export {}
