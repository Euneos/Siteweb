import type { ReseauFormateurs } from './reseau-formateurs'
type Member = ReseauFormateurs['members'][number]

/** Group neighbouring centres at the actual screen size, so no 44px touch target
 * masks another. A cluster is labelled as several places, never as one commune. */
export function networkMarkers(members: Member[], width: number, height: number) {
  function cluster(rows: Member[]) {
    const locations = [...new Map(rows.map(m => [m.location!.code, m.location!])).values()]
    return {
      key: locations.map(l => l.code).sort().join(':'),
      members: rows,
      locations,
      x: locations.reduce((sum, l) => sum + l.x, 0) / locations.length,
      y: locations.reduce((sum, l) => sum + l.y, 0) / locations.length,
    }
  }
  const groups = new Map<string, Member[]>()
  for (const member of members) {
    if (member.location) groups.set(member.location.code, [...(groups.get(member.location.code) ?? []), member])
  }
  const result = [...groups.values()].map(cluster)
  let merged = true
  while (merged) {
    merged = false
    outer: for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
      if (Math.abs(result[i].x - result[j].x) / 640 * width < 50 && Math.abs(result[i].y - result[j].y) / 600 * height < 50) {
        result[i] = cluster([...result[i].members, ...result[j].members])
        result.splice(j, 1)
        merged = true
        break outer
      }
    }
  }
  return result
}
