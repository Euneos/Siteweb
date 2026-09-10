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

export function jeton(locals: unknown): string | null {
  const env = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env
  return env?.NOCODB_TOKEN ?? null
}

async function appel(token: string, chemin: string, corps?: unknown) {
  const r = await fetch(API + chemin, {
    method: corps === undefined ? 'GET' : 'POST',
    headers: { 'xc-token': token, 'Content-Type': 'application/json' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(12_000),
  })
  if (!r.ok) throw new Error(`NocoDB ${r.status} ${chemin} : ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

/** Supprime un enregistrement cree pendant une operation restee incomplete. */
export async function supprimer(token: string, table: keyof typeof NC.tables, id: number) {
  const r = await fetch(`${API}/tables/${NC.tables[table]}/records`, {
    method: 'DELETE',
    headers: { 'xc-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ Id: id }]),
    signal: AbortSignal.timeout(12_000),
  })
  if (!r.ok) throw new Error(`NocoDB ${r.status} suppression ${table}#${id} : ${(await r.text()).slice(0, 200)}`)
}

/** Cree un enregistrement et renvoie son Id. */
export async function creer(token: string, table: keyof typeof NC.tables, champs: Record<string, unknown>) {
  const r = (await appel(token, `/tables/${NC.tables[table]}/records`, [champs])) as { Id: number }[] | { Id: number }
  return Array.isArray(r) ? r[0].Id : r.Id
}

/** Read the written row before reporting a successful application. */
export async function lireEnregistrement(token: string, table: keyof typeof NC.tables, id: number): Promise<Record<string, unknown>> {
  return appel(token, `/tables/${NC.tables[table]}/records/${id}`)
}

/** Relie un enregistrement a son parent. */
export async function relier(token: string, lien: keyof typeof NC.liens, table: keyof typeof NC.tables, id: number, cible: number) {
  await appel(token, `/tables/${NC.tables[table]}/links/${NC.liens[lien]}/records/${id}`, [{ Id: cible }])
}

/** Read every page even when NocoDB clamps the requested limit. */
export async function lireToutes(token: string, table: keyof typeof NC.tables, fields: string): Promise<(Record<string, unknown> & { Id: number })[]> {
  const rows: (Record<string, unknown> & { Id: number })[] = []
  for (;;) {
    const result = await appel(token, `/tables/${NC.tables[table]}/records?limit=200&offset=${rows.length}&fields=${encodeURIComponent(fields)}`) as {
      list: (Record<string, unknown> & { Id: number })[]
      pageInfo?: { isLastPage?: boolean }
    }
    rows.push(...result.list)
    if (result.pageInfo?.isLastPage || !result.list.length) return rows
    if (rows.length >= 10000) throw new Error('NocoDB pagination safety limit reached')
  }
}

/** Never create an unscoped application or guess between two active years. */
export async function cohorteActive(token: string): Promise<number | null> {
  const rows = await lireToutes(token, 'cohortes', 'Id,active')
  const active = rows.filter(c => c.active === true || c.active === 1)
  return active.length === 1 ? active[0].Id : null
}

/** Recherche un enregistrement par email (evite les doublons a la source). */
export async function parEmail(token: string, table: 'formateurs', email: string): Promise<number | null> {
  const w = encodeURIComponent(`(email,eq,${email})`)
  const r = (await appel(token, `/tables/${NC.tables[table]}/records?limit=1&where=${w}&fields=Id`)) as {
    list: { Id: number }[]
  }
  return r.list[0]?.Id ?? null
}

/** Retrouve un etablissement existant sans confondre deux ecoles ayant le meme referent. */
export async function parEtablissement(token: string, email: string, nom: string): Promise<number | null> {
  const w = encodeURIComponent(`(referent_email,eq,${email})`)
  const r = (await appel(token, `/tables/${NC.tables.etablissements}/records?limit=50&where=${w}&fields=Id,nom`)) as {
    list: { Id: number; nom?: string }[]
  }
  const nomNormalise = nom.trim().toLocaleLowerCase('fr')
  return r.list.find((e) => e.nom?.trim().toLocaleLowerCase('fr') === nomNormalise)?.Id ?? null
}
