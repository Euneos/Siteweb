import { schoolDisplayName } from './school-display-name'
import { publicSchoolLocation } from './public-school-location'
import type { MapData } from './map'
import { valeurStatutCandidature } from './statut-candidature'
import type { ReseauEtablissements } from './reseau-etablissements'
export type PublicSchool = {
  name: string
  city: string
  location: { code: string; territory: string; x: number; y: number } | null
  formations: { year: string; state: 'terminee' | 'en_cours' | 'engage' }[]
}
/** Public display only: accepted candidacies join ongoing training; internal statuses stay intact. */
export function publicSchoolMap(network: ReseauEtablissements, applications?: MapData) {
  function places(cohort?: string): PublicSchool[] {
    const schools = new Map<string, PublicSchool>()
    for (const member of network.members) {
      if (cohort && member.annee !== cohort) continue
      if (applications) {
        const source = applications.groups.find(g => g.participations.some(p => p.id === member.id))
        const validated = source?.participations.some(p => ['Établissement engagé', 'Candidature acceptée'].includes(valeurStatutCandidature(p.status) ?? ''))
        if (!validated) continue
      }
      const formations = member.formations.filter(f => f.etat === 'terminee' || f.etat === 'en_cours')
      if (!formations.length) continue
      const key = `${member.nom}\n${member.location?.code ?? member.localisation}`
      const school = schools.get(key) ?? {
        name: schoolDisplayName(member.nom), city: member.localisation,
        location: member.location ? { code: member.location.code, territory: member.location.territory, x: member.location.x, y: member.location.y } : null,
        formations: [],
      }
      const year = network.cohorts.find(c => c.value === member.annee)?.label ?? ''
      for (const f of formations) {
        if ((f.etat === 'terminee' || f.etat === 'en_cours') && !school.formations.some(v => v.year === year && v.state === f.etat))
          school.formations.push({ year, state: f.etat })
      }
      schools.set(key, school)
    }
    for (const group of applications?.groups ?? []) {
      if (cohort && String(group.cohortId) !== cohort) continue
      const accepted = group.participations.some(p => valeurStatutCandidature(p.status) === 'Candidature acceptée')
      const engaged = group.participations.some(p => valeurStatutCandidature(p.status) === 'Établissement engagé')
      if (!accepted && !engaged) continue
      const key = `${group.name}\n${group.location?.code ?? group.city}`
      const school = schools.get(key) ?? {
        name: schoolDisplayName(group.name), city: group.city,
        location: group.location ? { code: group.location.code, territory: group.location.territory, x: group.location.x, y: group.location.y } : null,
        formations: [],
      }
      // A completed formation keeps its label, even when the candidacy status lags behind.
      const existing = school.formations.some(f => f.year === group.cohortLabel)
      if (!existing) school.formations.push({ year: group.cohortLabel, state: accepted ? 'en_cours' : 'engage' })
      schools.set(key, school)
    }
    return [...schools.values()].map(publicSchoolLocation).filter(s => s.location?.territory !== 'BE').sort((a,b) => a.name.localeCompare(b.name, 'fr'))
  }
  return {
    locations: places(),
    periods: network.cohorts.map(c => ({ key: c.value, cohort: c.label, locations: places(c.value) })),
    readAt: network.updatedAt,
  }
}
