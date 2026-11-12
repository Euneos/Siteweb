import { lireToutes, type NC } from './nocodb'
import { construireReseauEtablissements } from './reseau-etablissements'
import { construireCartePubliqueFormateurs, lireLocalisationsConfirmees } from './reseau-formateurs'
import { buildMapData } from './map'
import { publicSchoolMap } from './public-school-map'
import { publicTrainerMap } from './public-trainer-map'

/** One read per table, sequentially: avoid NocoDB's burst rate limit. */
async function readNetwork(token: string, rawLocations?: unknown, rawResidences?: unknown) {
  async function read(table: keyof typeof NC.tables, fields: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await new Promise(resolve => setTimeout(resolve, 300))
        return await lireToutes(token, table, fields)
      }
      catch (error) {
        if (attempt >= 1 || !(error instanceof Error) || !error.message.startsWith('NocoDB 429 ')) throw error
        // Retry a read only; never retry form submissions or mutations.
        await new Promise(resolve => setTimeout(resolve, 30_000))
      }
    }
  }
  const cohorts = await read('cohortes', 'Id,nom,annee_debut,annee_fin,active')
  const participations = await read('participations', 'Id,code,statut,statut_origine,statut_formation,date_debut_formation,date_fin_formation,etablissements_id,cohortes_id,fusionne_vers')
  const schools = await read('etablissements', 'Id,nom,type_etab,ville,cp')
  const people = await read('formateurs', 'Id,nom,prenom,ville,cp')
  const paths = await read('engagements', 'Id,statut,formateurs_id,cohortes_id,fusionne_vers')
  return {
    ...publicSchoolMap(construireReseauEtablissements(cohorts, participations, schools), buildMapData(cohorts, participations, schools)),
    trainerLocations: publicTrainerMap(construireCartePubliqueFormateurs(people, paths, lireLocalisationsConfirmees(rawLocations), lireLocalisationsConfirmees(rawResidences))),
  }
}

// Share only an in-progress read. Settled results are never reused on later visits.
const pending = new Map<string, Promise<Awaited<ReturnType<typeof readNetwork>>>>()
export async function lireCartePublique(token: string, rawLocations?: unknown, rawResidences?: unknown) {
  const key = JSON.stringify([token, rawLocations, rawResidences])
  let read = pending.get(key)
  if (!read) {
    read = readNetwork(token, rawLocations, rawResidences).finally(() => pending.delete(key))
    pending.set(key, read)
  }
  return read
}
