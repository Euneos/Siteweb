/**
 * Acces a la base NocoDB d'EUNEOS.
 *
 * Le jeton n'est JAMAIS dans le code : il vient de la variable d'environnement
 * NOCODB_TOKEN, posee en secret Cloudflare. Sans elle, les endpoints refusent
 * d'ecrire plutot que de perdre une candidature en silence.
 */
const API = 'https://app.nocodb.com/api/v2'

export const NC = {
  tables: {
    etablissements: 'mg12klh5zv7b5n5',
    participations: 'mbunbu0f1zztce4',
    formateurs: 'mblganql53o34gm',
    engagements: 'mom9m2q83nainyz',
    cohortes: 'm5ayop8ul8s040l',
  },
  liens: {
    'participations.etablissement': 'ccebhm45i4hj9cv',
    'participations.cohorte': 'c3f6f3ynqtpy0t4',
    'engagements.formateur': 'cp9sf3hhaohs8zs',
    'engagements.cohorte': 'cavbu9tgan5r1ad',
  },
} as const

type Env = Record<string, string> | undefined

export function jeton(locals: unknown): string | null {
  const env = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env
  return env?.NOCODB_TOKEN ?? null
}

async function appel(token: string, chemin: string, corps?: unknown) {
  const r = await fetch(API + chemin, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: { 'xc-token': token, 'Content-Type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  })
  if (!r.ok) throw new Error(`NocoDB ${r.status} ${chemin} : ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

/** Cree un enregistrement et renvoie son Id. */
export async function creer(token: string, table: keyof typeof NC.tables, champs: Record<string, unknown>) {
  const r = (await appel(token, `/tables/${NC.tables[table]}/records`, [champs])) as { Id: number }[] | { Id: number }
  return Array.isArray(r) ? r[0].Id : r.Id
}

/** Relie un enregistrement a son parent. */
export async function relier(token: string, lien: keyof typeof NC.liens, table: keyof typeof NC.tables, id: number, cible: number) {
  await appel(token, `/tables/${NC.tables[table]}/links/${NC.liens[lien]}/records/${id}`, [{ Id: cible }])
}

/** Id de la cohorte marquee active — evite de figer l'annee dans le code. */
export async function cohorteActive(token: string): Promise<number | null> {
  const r = (await appel(token, `/tables/${NC.tables.cohortes}/records?limit=50&fields=Id,active`)) as {
    list: { Id: number; active?: boolean | number }[]
  }
  return r.list.find((c) => c.active)?.Id ?? null
}

/** Recherche un enregistrement par email (evite les doublons a la source). */
export async function parEmail(token: string, table: 'formateurs', email: string): Promise<number | null> {
  const w = encodeURIComponent(`(email,eq,${email})`)
  const r = (await appel(token, `/tables/${NC.tables[table]}/records?limit=1&where=${w}&fields=Id`)) as {
    list: { Id: number }[]
  }
  return r.list[0]?.Id ?? null
}
