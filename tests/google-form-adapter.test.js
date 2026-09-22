import { beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
let ctx, props, calls, responseCode, body, fail, values, config, sheet, triggers, installed;
const secret = 'fictional-test-secret-over-32-characters';
const headers = ['Horodatage','Établissement','Ville','CP','Début','Fin','Participants','Formateur','Email'];
const source = () => ({spreadsheetId:'fictional_sheet_id',sheetId:10,kind:'contact',cohortId:2,firstRow:2,
  headers:{timestamp:'Horodatage',name:'Établissement',city:'Ville',postcode:'CP',start:'Début',end:'Fin',participants:'Participants',trainer:'Formateur',referenceEmail:'Email'}});
beforeEach(() => {
  props=new Map(); calls=[]; responseCode=200; body={state:'complete',code:'saved',receipt:'a'.repeat(64)}; fail=false; installed=[];
  values=[[new Date('2026-09-10T10:00:00Z'),'Collège Fiction','Ville Fiction','01234','01/10/2026','02/01/2027','Initiales','Personne Fiction','fiction@example.invalid']];
  config={sources:[source()]};
  props.set('GOOGLE_FORMS_SYNC_CONFIG',JSON.stringify(config)); props.set('GOOGLE_FORMS_SYNC_SECRET',secret);
  triggers=[{getHandlerFunction:()=> 'onFicheContactEtab',getTriggerSourceId:()=> 'fictional_sheet_id'}];
  const parent={getId:()=> 'fictional_sheet_id',getSpreadsheetTimeZone:()=> 'Europe/Paris'};
  sheet={getSheetId:()=>10,getParent:()=>parent,getLastColumn:()=>headers.length,getLastRow:()=>values.length+1,
    getRange:(row)=>({getValues:()=>row===1?[headers]:[values[row-2]]})};
  ctx=vm.createContext({Date,JSON,Number,String,Math,Error,Array,Object,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()],formatDate:(d)=>d.toISOString().slice(0,10)},
    UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});if(fail)throw new Error('response lost');return{getResponseCode:()=>responseCode,getContentText:()=>JSON.stringify(body)}}},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    SpreadsheetApp:{openById:()=>({getSheetById:()=>sheet})},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:handler=>{
      let id='';const builder={forSpreadsheet:x=>{id=x;return builder},onFormSubmit:()=>builder,timeBased:()=>builder,everyMinutes:x=>{expect(x).toBe(15);return builder},create:()=>{installed.push(handler);triggers.push({getHandlerFunction:()=>handler,getTriggerSourceId:()=>id});}};return builder;
    }},
  });
  vm.runInContext(readFileSync(new URL('../scripts/google-forms/EuneosNocoSync.gs',import.meta.url),'utf8'),ctx);
});
const submit=()=>ctx.euneosNocoOnSubmit({range:{getSheet:()=>sheet,getRow:()=>2}});
const statuses=()=>[...props].filter(([k])=>k.startsWith('EUNEOS_SYNC_ROW_')).map(([,v])=>JSON.parse(v));
test('adapter only sends to fixed HTTPS endpoint, header secret, no URL secret, no redirects',()=>{
  submit();expect(calls).toHaveLength(1);expect(calls[0].url).toBe('https://euneos.fr/api/hook/google-forms');
  expect(calls[0].options.headers['x-google-forms-secret']).toBe(secret);expect(calls[0].options.followRedirects).toBe(false);
  const payload=JSON.parse(calls[0].options.payload);expect(payload.formation.start).toBe('2026-10-01');expect(payload.source.row).toBe(2);expect(payload.cohortId).toBe(2);
  expect(statuses()[0].state).toBe('complete'); expect(JSON.stringify(statuses())).not.toContain('fiction@example.invalid');
  submit();expect(calls).toHaveLength(1);
});
test('same-row correction is read fresh; unchanged success is not resent',()=>{
  submit();values[0][4]='12/10/2026';submit();expect(calls).toHaveLength(2);
  expect(JSON.parse(calls[1].options.payload).formation.start).toBe('2026-10-12');
});
test('failed transport backs off and stops after six attempts, current values always reread',()=>{
  fail=true;submit();expect(statuses()[0].state).toBe('retryable');submit();expect(calls).toHaveLength(1);
  for(let i=1;i<6;i++){
    for(const [k,v] of props)if(k.startsWith('EUNEOS_SYNC_ROW_'))props.set(k,JSON.stringify({...JSON.parse(v),nextAt:0}));
    submit();
  }
  expect(calls).toHaveLength(6);expect(statuses()[0].state).toBe('stopped');submit();expect(calls).toHaveLength(6);
});
test('review/uncertain server receipt stops automatic retries without bypassing the lock',()=>{
  body={state:'review',code:'write_uncertain',receipt:'b'.repeat(64)};submit();submit();
  expect(calls).toHaveLength(1);expect(statuses()[0].code).toBe('write_uncertain');
});
test('sweep continues after invalid historical timestamp, bounded to five changed rows',()=>{
  values[0][0]='10/09/26 ambiguous';
  for(let i=0;i<7;i++)values.push([new Date('2026-09-10T10:00:00Z'),'Collège '+i,'Ville','01234','01/10/2026','02/01/2027','','','fiction@example.invalid']);
  ctx.euneosNocoSweep();expect(calls).toHaveLength(5);expect(statuses().some(x=>x.code==='row_or_headers_invalid')).toBe(true);
  ctx.euneosNocoSweep();expect(calls).toHaveLength(7);
});
test('configured duplicate or missing header is flagged before any fetch',()=>{
  headers.push('Établissement');submit();expect(calls).toHaveLength(0);expect(statuses()[0].state).toBe('review');headers.pop();
  const c=source();c.headers.name='Missing';props.set('GOOGLE_FORMS_SYNC_CONFIG',JSON.stringify({sources:[c]}));
  submit();expect(calls).toHaveLength(0);
});
test('unknown source and wrong cohort rejected; firstRow protects historical stock',()=>{
  sheet.getSheetId=()=>99;expect(submit).toThrow('sync_source_not_allowed');expect(calls).toHaveLength(0);sheet.getSheetId=()=>10;
  const c=source();c.cohortId=1;props.set('GOOGLE_FORMS_SYNC_CONFIG',JSON.stringify({sources:[c]}));expect(submit).toThrow('sync_source_configuration');
  c.cohortId=2;c.firstRow=3;props.set('GOOGLE_FORMS_SYNC_CONFIG',JSON.stringify({sources:[c]}));submit();expect(calls).toHaveLength(0);
});
test('explicit trigger installation requires ready API, preserves legacy and is idempotent',()=>{
  responseCode=503;expect(()=>ctx.euneosNocoInstallTriggers()).toThrow('sync_api_not_ready');expect(installed).toHaveLength(0);
  responseCode=200;body={ready:true,mode:'apply'};ctx.euneosNocoInstallTriggers();ctx.euneosNocoInstallTriggers();
  expect(installed).toEqual(['euneosNocoOnSubmit','euneosNocoSweep']);expect(triggers[0].getHandlerFunction()).toBe('onFicheContactEtab');
});

test('adapter reserves increasing revisions for A -> B -> A and retains revision on retries',()=>{
  submit();values[0][4]='12/10/2026';submit();values[0][4]='01/10/2026';submit();
  expect(calls.map(c=>JSON.parse(c.options.payload).source.revision)).toEqual([1,2,3]);
  fail=true;values[0][4]='15/10/2026';submit();
  for(const [k,v] of props)if(k.startsWith('EUNEOS_SYNC_ROW_'))props.set(k,JSON.stringify({...JSON.parse(v),nextAt:0}));
  submit();expect(calls.slice(-2).map(c=>JSON.parse(c.options.payload).source.revision)).toEqual([4,4]);
});
test('targeted retry rechecks an identity refusal after mapping fix, never uncertain writes',()=>{
  body={state:'review',code:'identity_unresolved',receipt:'b'.repeat(64)};submit();submit();expect(calls).toHaveLength(1);
  body={state:'complete',code:'saved',receipt:'b'.repeat(64)};ctx.euneosNocoRetryRow('fictional_sheet_id',10,2);
  expect(calls).toHaveLength(2);expect(calls.map(c=>JSON.parse(c.options.payload).source.revision)).toEqual([1,1]);
  values[0][4]='15/10/2026';body={state:'review',code:'write_uncertain',receipt:'c'.repeat(64)};submit();
  expect(()=>ctx.euneosNocoRetryRow('fictional_sheet_id',10,2)).toThrow('sync_review_not_retryable');expect(calls).toHaveLength(3);
});

test('duplicate optional questions unrelated to the mapping do not reject a valid response',()=>{
  headers.push('Question facultative hors mapping','Question facultative hors mapping');
  try { submit();expect(calls).toHaveLength(1);expect(statuses()[0].state).toBe('complete'); }
  finally { headers.splice(-2); }
});
