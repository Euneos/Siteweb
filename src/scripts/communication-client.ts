import { communicationStatuses } from '../lib/communication'
import type { CommunicationRow, CommunicationSheet } from '../lib/communication'
const root = document.getElementById('communication-table')
if (root) {
  const get = <T extends HTMLElement>(id:string) => document.getElementById(id) as T
  const search = get<HTMLInputElement>('com-search')
  const activeFilters = new Map<string,string>()
  let activeSheetId=''
  const currentSheet=()=>sheets.find(s=>s.id===activeSheetId)
  function renderViews(){
    const tabs=get('com-views');tabs.replaceChildren();tabs.hidden=sheets.length<2
    sheets.forEach((sheet,index)=>{const tab=button(sheet.title,()=>{activeSheetId=sheet.id;activeFilters.clear();sort=-1;renderViews();changeSheet()});tab.id=`com-tab-${index}`;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(sheet.id===activeSheetId));tab.setAttribute('aria-controls','com-content');tab.tabIndex=sheet.id===activeSheetId?0:-1;tab.addEventListener('keydown',e=>{let next=index;if(e.key==='ArrowRight')next=(index+1)%sheets.length;else if(e.key==='ArrowLeft')next=(index+sheets.length-1)%sheets.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=sheets.length-1;else return;e.preventDefault();activeSheetId=sheets[next].id;activeFilters.clear();renderViews();changeSheet();get(`com-tab-${next}`).focus()});tabs.append(tab)})
    if(sheets.length>1){content.setAttribute('role','tabpanel');content.setAttribute('aria-labelledby',`com-tab-${sheets.findIndex(s=>s.id===activeSheetId)}`)}
  }
  const content = get('com-content'), feedback = get('com-feedback'), dialog = get<HTMLDialogElement>('com-editor'), form = get<HTMLFormElement>('com-form'), fields = get('com-fields'), save = get<HTMLButtonElement>('com-save'), saveFeedback = get('com-save-feedback'), add = get<HTMLButtonElement>('com-new')
  const endpoint = `/api/interne/communication/${root.dataset.table}`
  let sheets: CommunicationSheet[] = [], rows: CommunicationRow[] = [], sort = -1, ascending = true, editing: CommunicationRow | null = null, dirty = false, saving = false, loading = false
  const el = <K extends keyof HTMLElementTagNameMap>(tag:K,text = '') => { const n = document.createElement(tag); n.textContent = text; return n }
  const option = (label:string,v:string) => { const n = el('option',label);n.value=v;return n }
  const norm = (s:string) => s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('fr')
  const button = (label:string, action:()=>void) => { const b=el('button',label);b.type='button';b.className='iw-button';b.addEventListener('click',action);return b }
  async function request(init?:RequestInit) {
    const response = await fetch(endpoint,{...init,headers:{Accept:'application/json',...init?.headers}})
    let data: any
    try { data = await response.json() } catch { throw new Error('Le tableau est indisponible. Rechargez la page après reconnexion.') }
    if (!response.ok) throw new Error(data.error ?? 'Le tableau est indisponible.')
    return data
  }
  const allowedFilters:Record<string,string[]> = { suivimedias:['Type de média','Nom média','Public principal','Statut'],partenariats:['Priorité','Vivier','Statut'],veille:['Nom','Type','Tags'] }
  const categorical = ['Type de média','Type','Statut','Priorité','Tags','Vivier','Public principal']
  const split = (label:string,cell:string) => label==='Tags' ? cell.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean) : cell ? [cell] : []
  function choices(label:string) {
    if(label==='Statut')return [...communicationStatuses]
    const defaults:Record<string,string[]> = { 'Priorité':['A','B','C'],Statut:['À contacter','Contacté','En échange','Relance à prévoir','Accord obtenu','Sans suite'],Type:root!.dataset.table==='veille'?['Podcast','Article','Newsletter','Film']:[] }
    return [...new Set([...(defaults[label]??[]),...rows.flatMap(r=>{const sh=sheets.find(s=>s.id===r.sheet_id);return split(label,r.cells[sh?.columns.indexOf(label)??-1]??'')})])].sort((a,b)=>a.localeCompare(b,'fr'))
  }
  function changeSheet() {
    const container=get('com-filters');container.replaceChildren()
    for(const [index,label] of (allowedFilters[root!.dataset.table!]??[]).entries()) {
      if(!currentSheet()?.columns.includes(label))continue
      const wrapper=el('div');wrapper.className='iw-field';const caption=el('label',label),select=el('select');select.id=`com-filter-${index}`;caption.htmlFor=select.id;select.dataset.column=label;select.append(option('Toutes les valeurs',''))
      const values=[...new Set(rows.filter(r=>r.sheet_id===activeSheetId).flatMap(r=>{const i=currentSheet()?.columns.indexOf(label)??-1;return i<0?[]:split(label,r.cells[i]||'Non renseigné')}))].sort((a,b)=>a.localeCompare(b,'fr'))
      for(const v of values)select.append(option(v,v));const previous=activeFilters.get(label)??'';select.value=values.includes(previous)?previous:'';activeFilters.set(label,select.value)
      select.addEventListener('change',()=>{activeFilters.set(label,select.value);render()});wrapper.append(caption,select);container.append(wrapper)
    }
    render()
  }
  function render() {
    content.replaceChildren();add.disabled=!sheets.some(s=>!s.guide)
    let count=0,total=0
    for(const selected of sheets.filter(s=>s.id===activeSheetId)) {
      const all=rows.filter(r=>r.sheet_id===selected.id);if(!selected.guide)total+=all.length
      const visible=all.filter(r=>(!search.value || norm(r.cells.join(' ')).includes(norm(search.value))) && [...activeFilters].every(([label,v])=>!v || (selected.columns.includes(label) && split(label,r.cells[selected.columns.indexOf(label)]||'Non renseigné').includes(v))))
      if(!selected.guide)count+=visible.length
      if(!visible.length)continue
      const section=el('section');section.className='com-section';const heading=el('div');heading.className='com-section__heading';heading.append(el('h2',selected.title))
      if(!selected.guide)heading.append(button('＋ Nouvelle fiche',()=>open(null,selected)))

      if(selected.guide) {
        const guide=el('div');guide.className='com-guide'
        for(const row of visible){const article=el('article');article.append(el('h3',row.cells[0]));for(const cell of row.cells.slice(1))if(cell)article.append(el('p',cell));guide.append(article)}
        section.append(guide);content.append(section);continue
      }
      const scroll=el('div');scroll.className='com-scroll';scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',selected.title)
      const table=el('table');table.className='com-table';const caption=el('caption',selected.title);caption.className='iw-sr-only';table.append(caption)
      const head=el('thead'), tr=el('tr');tr.append(el('th','Fiche'))
      selected.columns.forEach((label,i)=>{const th=el('th');th.scope='col';const b=button(label,()=>{ascending=sort===i?!ascending:true;sort=i;rows.sort((a,b)=>(a.cells[i]??'').localeCompare(b.cells[i]??'','fr',{numeric:true})*(ascending?1:-1));render()});th.append(b);tr.append(th)})
      head.append(tr);table.append(head);const body=el('tbody')
      for(const row of visible) {
        const tr=el('tr'),action=el('td'),b=button('Ouvrir',()=>open(row,selected));b.setAttribute('aria-label',`Ouvrir la fiche ${row.cells.find(Boolean)??''}`);action.append(b);tr.append(action)
        const priority=row.cells[selected.columns.indexOf('Priorité')]?.trim().toUpperCase(),type=norm(row.cells[selected.columns.indexOf('Type')]??'')
        const status=row.cells[selected.columns.indexOf('Statut')]??''
        const statusColor=({'À contacter':'orange','En attente de réponse':'attente','À relancer':'rose','Annulé':'annule','Accepté':'vert'} as Record<string,string>)[status]
        const color=['suivimedias','partenariats'].includes(root!.dataset.table!)?statusColor:root!.dataset.table==='veille'?({podcast:'bleu',article:'vert',articles:'vert',newsletter:'orange',film:'jaune'} as Record<string,string>)[type]:''
        if(color)tr.className=`com-${color}`
        for(const [index,cell] of row.cells.entries()){const td=el('td');if(root!.dataset.table==='partenariats'){if(selected.columns[index]==='Priorité'){td.className='com-priority';td.dataset.priority=priority??''}} let url:URL|null=null;try{url=new URL(cell.startsWith('www.')?'https://'+cell:cell);if(!['http:','https:'].includes(url.protocol))url=null}catch{}
          if(url){const link=el('a',cell);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';td.append(link)}else td.append(el('p',cell||'—'));tr.append(td)}
        body.append(tr)
      }
      table.append(body);scroll.append(table);section.append(scroll);content.append(section)
    }
    get('com-count').textContent=`${count} / ${total} fiches`
    if(!content.childElementCount)content.append(el('p',sheets.length?'Aucun résultat pour cette recherche.':'Les données sources restent à importer.'))
  }
  async function load() {
    if(loading)return
    loading=true;content.setAttribute('aria-busy','true');get<HTMLButtonElement>('com-refresh').disabled=true;feedback.textContent='Chargement du tableau…'
    try {
      const result=await request();sheets=result.sheets.filter((s:CommunicationSheet)=>!s.guide).map((s:CommunicationSheet)=>({...s,title:/top\s*10/i.test(s.title)?'TOP 10':s.title}));rows=result.rows
      if(!sheets.some(s=>s.id===activeSheetId))activeSheetId=sheets[0]?.id??''
      renderViews()
      feedback.textContent=sheets.length?'Les modifications sont partagées avec l’équipe.':'Le tableau est prêt ; l’import des données sources reste à effectuer.';changeSheet()
    }catch(error){feedback.textContent=error instanceof Error?error.message:'Chargement impossible.';add.disabled=true}
    finally{loading=false;content.setAttribute('aria-busy','false');get<HTMLButtonElement>('com-refresh').disabled=false}
  }
  function open(row:CommunicationRow|null, selected = row ? sheets.find(s=>s.id===row.sheet_id) : currentSheet()) {if(!selected || selected.guide)return
    editing=row??{id:crypto.randomUUID(),sheet_id:selected.id,cells:selected.columns.map(()=>''),version:0,updated_by:'',updated_at:''}
    dirty=false;saveFeedback.textContent='';get('com-title').textContent=row?'Modifier la fiche':'Nouvelle fiche';fields.replaceChildren()
    selected.columns.forEach((label,i)=>{
      const wrapper=el('div');wrapper.className='iw-field iw-field--wide';const l=el('label',label);l.htmlFor=`com-field-${i}`
      const current=editing!.cells[i]??''
      const input=categorical.includes(label)?el('select'):el('textarea');input.id=l.htmlFor;input.name=String(i);input.dataset.cell=String(i)
      if(input instanceof HTMLSelectElement) {
        input.multiple=label==='Tags';if(!input.multiple && label!=='Statut')input.append(option('Non renseigné',''))
        for(const choice of label==='Statut'?choices(label):[...new Set([...choices(label),...split(label,current)])]){const o=option(choice,choice);o.selected=split(label,current).includes(choice);input.append(o)}
        wrapper.append(l,input)
        if(label==='Statut'){fields.append(wrapper);return}
        const group=el('div');group.className='com-add-choice';const custom=el('input');custom.type='text';custom.maxLength=160;custom.placeholder='Nouvelle valeur';custom.setAttribute('aria-label',`Nouvelle valeur pour ${label}`)
        const append=button('Ajouter une valeur',()=>{const v=custom.value.trim();if(!v)return;let o=[...input.options].find(o=>o.value===v);if(!o){o=option(v,v);input.append(o)}if(!input.multiple)input.value=v;else o.selected=true;custom.value='';dirty=true;saveFeedback.textContent='La nouvelle valeur sera disponible après enregistrement de la fiche.'});group.append(custom,append);wrapper.append(group)
        if(input.multiple)wrapper.append(el('small','Plusieurs tags possibles (Ctrl ou ⌘ + clic).'))
      }else {input.rows=label==='Notes'?4:2;input.maxLength=10000;input.value=current;wrapper.append(l,input)}
      fields.append(wrapper)
    })
    get('com-audit').textContent=row?`Dernière modification : ${new Date(row.updated_at).toLocaleString('fr-FR')} · ${row.updated_by}`:''
    dialog.showModal()
  }
  function close() {if(saving)return;if(dirty&&!confirm('Fermer sans enregistrer vos modifications ?'))return;dialog.close();dirty=false}
  get('com-close').addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close()});form.addEventListener('input',()=>{dirty=true});form.addEventListener('change',()=>{dirty=true})
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}})
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(saving||!editing)return
    const cells=[...fields.querySelectorAll<HTMLTextAreaElement|HTMLSelectElement>('[data-cell]')].map(t=>t instanceof HTMLSelectElement && t.multiple ? [...t.selectedOptions].map(o=>o.value).join(', ') : t.value.trim());if(!cells.some(Boolean)){saveFeedback.textContent='Renseignez au moins un champ.';return}
    saving=true;save.disabled=true;fields.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement>('textarea,select,input,button').forEach(t=>t.disabled=true);saveFeedback.textContent='Enregistrement…'
    try{await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...editing,cells})});dirty=false;dialog.close();await load();feedback.textContent='Fiche enregistrée.'}
    catch(error){saveFeedback.textContent=error instanceof Error?error.message:'Enregistrement non confirmé. Votre saisie est conservée.'}
    finally{saving=false;save.disabled=false;fields.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement>('textarea,select,input,button').forEach(t=>t.disabled=false)}
  })
  search.addEventListener('input',render);get('com-refresh').addEventListener('click',()=>void load());add.addEventListener('click',()=>open(null));setInterval(()=>{if(!dialog.open && document.visibilityState==='visible')void load()},60000);void load()
}
