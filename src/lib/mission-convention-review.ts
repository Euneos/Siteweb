import type { MissionPayload } from './mission-convention'
import { WorkspaceError } from './internal-workspace'

export function conventionBudget(payload: MissionPayload, complement = 0, fees = 0, year2Euros?: number | null) {
  const trainings = payload.missions.filter(m => m.financement !== 'externe' && m.volume !== 8).length
  const workshops = payload.missions.filter(m => m.cas1 === 'oui').length
  const hasYear2 = payload.missions.some(m => m.volume === 8 && m.financement !== 'externe')
  const hasComplement = payload.missions.some(m => m.cas2 !== 'non') || (hasYear2 && year2Euros == null)
  const trainingEuros = trainings * 1000, workshopEuros = workshops * 200
  const services = trainingEuros+workshopEuros+complement+(year2Euros ?? 0)
  return {trainings,workshops,hasComplement,hasYear2,trainingEuros,workshopEuros,services,total:Math.round((services+fees)*100)/100}
}

/** Only a single explicit euro amount is proposed; the reviewer still decides. */
export function proposedFeesAmount(text: string): number | null {
  if (/-\s*\d/.test(text)) return null
  const matches = [...text.matchAll(/(?<![\d.,])(?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:€|euros?\b)/gi)]
  if (matches.length !== 1) return null
  const amount = Number(matches[0][0].replace(/\s*(?:€|euros?\b)/i,'').replace(/[ \u00a0]/g,'').replace(',','.'))
  return Number.isFinite(amount) && amount >= 0 && amount <= 100000 ? amount : null
}

const money = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000 || Math.abs(value*100-Math.round(value*100)) > 0.000001)
    throw new WorkspaceError(400, `Montant ${label} invalide (deux décimales maximum).`)
  return value
}
export function parseConventionReview(body: Record<string,unknown>, payload: MissionPayload, complete: boolean) {
  const name = typeof body.representativeName === 'string' ? body.representativeName.trim() : ''
  const role = typeof body.representativeRole === 'string' ? body.representativeRole.trim() : ''
  if (!name || !role || name.length > 90 || role.length > 90) throw new WorkspaceError(400, 'Indiquez séparément le nom et la fonction du représentant EUNEOS.')
  const case2Euros = money(body.case2Euros, 'complémentaire')
  const year2Euros = body.year2Euros == null ? null : money(body.year2Euros, 'formation ateliers année 2')
  const budget = conventionBudget(payload,0,0,year2Euros)
  if (!budget.hasYear2 && year2Euros) throw new WorkspaceError(400, 'Aucune formation de 8 h en année 2 dans cette convention.')
  if (!budget.hasComplement && case2Euros !== 0) throw new WorkspaceError(400, 'Aucun complément à chiffrer pour cette convention.')
  if (!['', 'aucun', 'accord'].includes(String(body.feesDecision)) || (complete && body.feesDecision === ''))
    throw new WorkspaceError(400, 'Choisissez la décision sur les frais.')
  const feesDecision = String(body.feesDecision)
  const feesDetails = typeof body.feesDetails === 'string' ? body.feesDetails.trim() : ''
  if (feesDetails.length > 2000 || (complete && feesDecision === 'accord' && !feesDetails)) throw new WorkspaceError(400, 'Précisez les frais autorisés et leur montant ou plafond.')
  const feesEuros = body.feesEuros === null || body.feesEuros === undefined ? null : money(body.feesEuros,'des frais')
  if (complete && feesDecision === 'accord' && feesEuros === null) throw new WorkspaceError(400, 'Confirmez le montant ou plafond des frais autorisés.')
  return {representative:`${name} — ${role}`,case2Euros,year2Euros,feesDecision,feesDetails,feesEuros:feesDecision === 'aucun' ? 0 : feesEuros}
}
