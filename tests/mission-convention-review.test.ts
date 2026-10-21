import {describe,expect,test} from 'bun:test'
import {conventionBudget,parseConventionReview,proposedFeesAmount} from '../src/lib/mission-convention-review'
import {parseMissionPayload} from '../src/lib/mission-convention'
import {contractText} from '../src/lib/mission-convention-pdf'

const p=()=>parseMissionPayload({nom:'Camille',structure:'Structure',identification:'Identification',adresse:'Adresse',email:'camille@example.test',telephone:'0102030405',frais:'demande',detailsFrais:'Impressions : 39,79 euros',missions:['Collège A','Collège B'].map(etablissement=>({etablissement,adresse:'Adresse',direction:'Direction',referent:'Référent',contact:'Contact',financement:'externe',financeur:'Organisme fictif',volume:18,format:'presentiel',sessions:Array.from({length:6},()=>({date:'2027-01-12',duree:3,modalite:'presentiel'})),cas1:'oui',classe:'5e',ateliers:'Dates à fixer',cas2:'non',periodeCas2:'',accordCas2:''}))})
describe('récapitulatif de vérification',()=>{
  test('les frais sont une proposition, sans décision implicite ni interprétation des barèmes',()=>{
    expect(proposedFeesAmount('Impressions : 39,79 euros')).toBe(39.79)
    expect(proposedFeesAmount('Plafond : 1 200,50 €')).toBe(1200.5)
    for(const text of ['déplacements à définir','train 30 € + copies 39,79 €','-39,79 €','39,799 euros']) expect(proposedFeesAmount(text)).toBeNull()
  })
  test('400 € de prestations, 39,79 € de frais, 439,79 € dans le PDF',()=>{
    const payload=p()
    expect(conventionBudget(payload,0,39.79)).toMatchObject({trainingEuros:0,workshopEuros:400,services:400,total:439.79,hasComplement:false})
    const text=contractText(payload,'Responsable — Direction',0,'Impressions',39.79).join('\n')
    expect(text).toContain('TOTAL PRÉVISIONNEL AVEC FRAIS : 439,79 €')
    expect(text).toContain('Montant / plafond des frais autorisés : 39,79 €')
  })
  test('autoriser les frais exige une décision et un montant explicites à la validation finale',()=>{
    const payload=p()
    const body={representativeName:'Responsable',representativeRole:'Direction',case2Euros:0,feesDecision:'accord',feesDetails:'Impressions',feesEuros:39.79}
    expect(parseConventionReview(body,payload,true).feesEuros).toBe(39.79)
    expect(()=>parseConventionReview({...body,feesEuros:null},payload,true)).toThrow()
    expect(()=>parseConventionReview({...body,feesDecision:''},payload,true)).toThrow()
    expect(parseConventionReview({...body,feesDecision:''},payload,false).feesDecision).toBe('')
    expect(()=>parseConventionReview({...body,case2Euros:400},payload,true)).toThrow()
    expect(()=>parseConventionReview({...body,feesEuros:39.799},payload,true)).toThrow()
  })
})
