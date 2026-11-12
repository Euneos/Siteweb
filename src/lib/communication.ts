import { WorkspaceError } from './internal-workspace'
export const communicationTables = {
  suivimedias: { title: 'Suivi médias', description: 'Les médias à contacter et le suivi des échanges.' },
  partenariats: { title: 'Partenariats', description: 'Parrainage, comité scientifique et relations partenaires.' },
  veille: { title: 'Veille', description: 'Les ressources et les actualités à garder en vue.' },
} as const
export type CommunicationTable = keyof typeof communicationTables
export const isCommunicationTable = (value: string): value is CommunicationTable => Object.hasOwn(communicationTables, value)
export interface CommunicationSheet { id: string; title: string; columns: string[]; guide: boolean }
export interface CommunicationRow { id: string; sheet_id: string; cells: string[]; version: number; updated_by: string; updated_at: string }
export function validateCommunicationRow(body: Record<string, unknown>, columns: string[]) {
  if (!Array.isArray(body.cells) || body.cells.length !== columns.length || body.cells.some(v => typeof v !== 'string' || v.length > 10000))
    throw new WorkspaceError(400, 'Vérifiez les champs de la fiche (10 000 caractères maximum par champ).')
  const cells = body.cells.map(v => (v as string).trim())
  if (!cells.some(Boolean)) throw new WorkspaceError(400, 'Renseignez au moins un champ.')
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0) throw new WorkspaceError(400, 'Version invalide.')
  return cells
}

export const communicationStatuses = ['À contacter','En attente de réponse','À relancer','Annulé','Accepté'] as const
export function effectiveCommunicationCells(cells:string[],columns:string[],since:string,now=Date.now()) {
  const result=[...cells],i=columns.indexOf('Statut'),start=Date.parse(since)
  if(i>=0 && result[i]==='En attente de réponse' && Number.isFinite(start) && now-start>=20*24*60*60*1000)result[i]='À relancer'
  return result
}
