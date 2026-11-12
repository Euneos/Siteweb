import type { CommunicationRow, CommunicationSheet } from './communication'
import { resolveChoice } from './communication-choices'
import type { ChoiceCatalog } from './communication-choices'
import { mediaPeople, mediaStatuses } from './media-summary'

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
const groups = ['Parrainage', 'Comité scientifique', 'Partenaires']
const canonicalGroup = (title: string) =>
  key(title) === key('Partenaires, pas parrains')
    ? 'Partenaires'
    : groups.find((g) => key(g) === key(title))
export function partnershipSummary(
  sheets: CommunicationSheet[],
  rows: CommunicationRow[],
  catalog: ChoiceCatalog,
) {
  // Only canonical tabs: TOP 10 is a synchronized selection, not additional people.
  const entries = rows.flatMap((row) => {
    const sheet = sheets.find((s) => !s.guide && s.id === row.sheet_id && !!canonicalGroup(s.title))
    if (!sheet) return []
    const cell = (name: string) =>
      (row.cells[sheet.columns.findIndex((c) => key(c) === key(name))] || '').trim()
    return [
      {
        group: canonicalGroup(sheet.title)!,
        name:
          cell('Nom') ||
          cell('Structure ou personne') ||
          cell('Association') ||
          cell('Nom de la structure') ||
          cell('Structure') ||
          cell('Nom et prénom') ||
          cell('Prénom et nom') ||
          row.cells[0]?.trim() ||
          'Sans nom',
        status: cell('Statut') || 'Non renseigné',
        priority: cell('Priorité'),
        pool: cell('Vivier'),
        relation: cell('Nature de la relation à viser') || 'Non renseignée',
        people: cell('Attribution')
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        vigilance: cell('Point de vigilance'),
        updated: row.updated_at,
      },
    ]
  })
  const byGroup = (g: string) => entries.filter((e) => e.group === g)
  const counters = groups.map((group, i) => ({
    label: ['Parrains engagés', 'Comité scientifique', 'Partenaires actifs'][i],
    count: byGroup(group).filter(
      (e) =>
        e.status === 'Partenariat' ||
        resolveChoice(catalog, 'partenariats', 'Statut', e.status)?.role === 'accepted',
    ).length,
    total: i < 2 ? 5 : byGroup(group).length,
  }))
  const statuses = [...new Set([...mediaStatuses, ...entries.map((e) => e.status)])]
  const priorities = groups.slice(0, 2).map((label) => {
    const selected = byGroup(label).filter((e) => e.priority === 'A')
    return {
      label,
      total: selected.length,
      statuses: statuses.map((label) => ({
        label,
        count: selected.filter((e) => e.status === label).length,
      })),
    }
  })
  const sponsors = byGroup('Parrainage'),
    active = sponsors.filter((e) => ['Partenariat', 'En discussion'].includes(e.status))
  const pools = [
    ...new Set([
      ...catalog.choices
        .filter((c) => c.scope === 'partenariats' && c.column_name === 'Vivier' && !c.deleted_at)
        .map((c) => c.value),
      ...sponsors.map((e) => e.pool).filter(Boolean),
    ]),
  ].map((label) => ({ label, count: active.filter((e) => e.pool === label).length }))
  const relations = [...new Set(byGroup('Partenaires').map((e) => e.relation))].map((label) => ({
    label,
    count: byGroup('Partenaires').filter((e) => e.relation === label).length,
  }))
  const people = [...mediaPeople, 'Non attribuées'].map((label) => ({
    label,
    count: entries.filter((e) =>
      label === 'Non attribuées' ? !e.people.length : e.people.includes(label),
    ).length,
  }))
  const latest = entries
    .map((e) =>
      Date.parse(e.updated.replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(e.updated) ? '' : 'Z')),
    )
    .filter(Number.isFinite)
  return {
    counters,
    priorities,
    pools,
    missingPool: active.filter((e) => !e.pool).length,
    relations,
    people,
    ongoing: entries.filter((e) => ['Contacté', 'En discussion'].includes(e.status)),
    updated: latest.length ? new Date(Math.max(...latest)).toISOString() : null,
  }
}
