import { lireToutes, type NC } from './nocodb'
import { construireReseauEtablissements } from './reseau-etablissements'
import { construireCartePubliqueFormateurs, lireLocalisationsConfirmees } from './reseau-formateurs'
import { buildMapData } from './map'
import { publicSchoolMap } from './public-school-map'
import { publicTrainerMap } from './public-trainer-map'

/** One read per table, sequentially: avoid NocoDB's burst rate limit. */
async function readNetwork(token: string, rawLocations?: unknown, rawResidences?: unknown) {
  // Finish below Cloudflare's 30-second waitUntil limit, including D1 cleanup.
  const signal = AbortSignal.timeout(20_000)
  async function read(table: keyof typeof NC.tables, fields: string) {
    signal.throwIfAborted()
    return lireToutes(token, table, fields, signal)
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

/** The shared D1 lease owns concurrency; no cross-request I/O promises in global scope. */
export async function lireCartePublique(token: string, rawLocations?: unknown, rawResidences?: unknown) {
  return readNetwork(token, rawLocations, rawResidences)
}
