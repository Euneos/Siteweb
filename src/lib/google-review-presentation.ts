type ReviewState = 'pending' | 'unknown' | 'partial' | 'integrated'
export type ReviewFilter = 'pending' | 'partial' | 'integrated' | 'all'
export const reviewFilters: { value: ReviewFilter; label: string }[] = [
  { value: 'pending', label: 'À examiner' },
  { value: 'partial', label: 'Intégrations partielles' },
  { value: 'integrated', label: 'Intégrations attestées' },
  { value: 'all', label: 'Toutes les entrées' },
]
export function matchesReviewFilter(
  row: { state: ReviewState; operation?: { state: string } | null },
  filter: string,
) {
  if (filter === 'all') return true
  if (filter === 'pending')
    return row.state === 'pending' || row.state === 'unknown' || row.operation?.state === 'pending'
  return (filter === 'partial' || filter === 'integrated') && row.state === filter
}
