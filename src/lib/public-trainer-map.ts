import type { ReseauFormateurs, construireCartePubliqueFormateurs } from './reseau-formateurs'
/** Anonymous public network: one record per formed person or trainee, no names or contacts. */
export function publicTrainerMap(network: ReseauFormateurs | ReturnType<typeof construireCartePubliqueFormateurs>) {
  return network.members.map(member => ({
    name: member.etat === 'en_formation' ? 'En cours de formation' : 'Formateur',
    trainingState: member.etat,
    city: member.localisation,
    location: member.location ? { code: member.location.code, territory: member.location.territory, x: member.location.x, y: member.location.y } : null,
  }))
}
