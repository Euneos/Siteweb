import { test, expect } from 'bun:test'
import { readContact, writeContact } from '../src/lib/google-form-contact'
import { lireSourceContact } from '../src/lib/etat-candidatures'
const projection = () => ({version:1,source:{kind:'site',receipt:'b'.repeat(64),readAt:'2026-09-23T08:00:00.000Z'},receivedAt:'2026-09-23T08:00:00Z',formation:{start:'2026-10-01',end:'2027-01-01',kind:'previsionnelle',format:'Présentiel',planning:'Planning',issues:[]},declaredTrainers:[],participants:{declared:'',unresolved:[],importedCount:0},operationalSubmissions:[{data:{referrer:{email:'private@example.test'}}}]})
test('website provenance needs no invented Google sheet or row and preserves private fields server-side',()=>{
 const p=projection(),notes=writeContact('Note humaine',p)
 expect(readContact(notes)).toEqual(p)
 const rendered=lireSourceContact(notes)
 expect(rendered.invalide).toBe(false)
 expect(JSON.stringify(rendered)).not.toContain('private@example.test')
 expect(JSON.stringify(rendered)).not.toContain('operationalSubmissions')
})
test('forged website provenance and invalid time are rejected',()=>{
 for(const source of [{...projection().source,receipt:'bad'},{...projection().source,spreadsheetId:'invented'},{...projection().source,readAt:'2026-09-23T24:00:00Z'}]){
  const notes=writeContact('',{...projection(),source})
  expect(()=>readContact(notes)).toThrow()
  expect(lireSourceContact(notes).invalide).toBe(true)
 }
})
