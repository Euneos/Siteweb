export function origineAutorisee(request: Request) {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

export function emailValide(email: string) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(email)
}

export function urlHttpValide(valeur: string) {
  try {
    return ['http:', 'https:'].includes(new URL(valeur).protocol)
  } catch {
    return false
  }
}

export function champsDansLesLimites(form: FormData, limites: Record<string, number>) {
  return Object.entries(limites).every(([nom, max]) =>
    form.getAll(nom).every((valeur) => typeof valeur !== 'string' || valeur.length <= max),
  )
}

export function aucunTexteTropLong(form: FormData, max = 5000) {
  return [...form.values()].every((valeur) => typeof valeur !== 'string' || valeur.length <= max)
}

export function donneesTexte(form: FormData) {
  return Object.fromEntries(
    [...form].map(([nom, valeur]) => [nom, typeof valeur === 'string' ? valeur : '']),
  ) as Record<string, string>
}

export function choixAutorises(form: FormData, choix: Record<string, readonly string[]>) {
  return Object.entries(choix).every(([nom, valeurs]) =>
    form.getAll(nom).every((valeur) => typeof valeur === 'string' && (valeur === '' || valeurs.includes(valeur))),
  )
}
