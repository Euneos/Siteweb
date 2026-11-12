/** Approved spelling for public and internal school displays. */
export function schoolDisplayName(value: string): string {
  const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/\s+/g, ' ').trim()
  if (['college paul emile victor', 'clg paul emile victor'].includes(key)) return 'Collège Paul Emile Victor'
  if (['clg charloun rieu', 'college charloun rieu'].includes(key)) return 'Collège Charloun Rieu'
  return value
}
