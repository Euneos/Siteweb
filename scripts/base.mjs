#!/usr/bin/env bun
/**
 * Acces a la base EUNEOS depuis le terminal.
 *
 * Sert a l'equipe et a l'agent : consulter les candidatures, faire avancer un
 * dossier, voir l'etat de la campagne. Aucune donnee n'est modifiee sans une
 * commande explicite.
 *
 * Le jeton se met dans un fichier .env a la racine (jamais dans le code) :
 *   NOCODB_TOKEN=nc_pat_...
 */
import { reconcilierActifs } from '../src/lib/nocodb.ts'

const API = 'https://app.nocodb.com/api/v2'

const T = {
  etablissements: 'mg12klh5zv7b5n5',
  templates_emails: 'mzpstich70x80a1',
  blocs_template: 'movmgkxcx89hto4',
  participations: 'mbunbu0f1zztce4',
  formateurs: 'mblganql53o34gm',
  engagements: 'mom9m2q83nainyz',
  cohortes: 'm5ayop8ul8s040l',
  missions: 'merrsayuq3xb3uk',
  adultes: 'mzbpzuikti6h3pz',
  groupes_jeunes: 'm9rjb4oixy04ptt',
}

const STATUTS_ETAB = ['Candidature recue', 'Accuse reception', 'Invite', 'En discussion',
                      'En cours d’analyse', 'Candidature acceptée', 'Retenu', 'Engage', 'Refuse', 'Abandonne']
const STATUTS_FORM = ['Candidature recue', 'Accuse reception', 'Candidature validée',
                      "Liste d'attente", 'Refuse', 'En attente confirmation formation',
                      'En cours de formation', 'Formateur en cours de validation',
                      'Formateur validé', 'Abandonne']

async function api(chemin, options = {}) {
  const token = process.env.NOCODB_TOKEN
  if (!token) throw new Error("Il manque le jeton d'acces a la base.\n" +
    "Cree un fichier .env a la racine du projet avec :\n  NOCODB_TOKEN=nc_pat_...")
  const r = await fetch(API + chemin, {
    ...options,
    headers: { 'xc-token': token, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!r.ok) throw new Error(`Base injoignable (${r.status}) : ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

const idValide = (id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0
const liensDossier = (table) => table === 'participations' ? ['etablissements_id', 'cohortes_id']
  : table === 'engagements' ? ['formateurs_id', 'cohortes_id'] : []
const actifs = (table, rows) => reconcilierActifs(rows, liensDossier(table), table === 'engagements' ? ['cohortes_id'] : [])

function projection(params, champs) {
  // No fields parameter means the caller requested full records.
  if (params.has('fields')) params.set('fields', [...new Set([
    ...params.get('fields').split(',').map((field) => field.trim()).filter(Boolean), ...champs,
  ])].join(','))
}

/** Only the status predicates used by dossier commands are supported locally.
 * Never send a dossier WHERE to NocoDB: it could hide the canonical target.
 * Refuse unsupported grammar rather than silently widening a requested filter. */
function filtreStatut(where) {
  if (!where) return () => true
  const conditions = where.split('~and').map((part) => /^\(statut,(eq|neq),([^()]*)\)$/.exec(part))
  if (conditions.some((condition) => !condition))
    throw new Error('Filtre de dossiers non pris en charge : seuls les statuts eq/neq reliés par ~and sont permis.')
  return (row) => conditions.every(([, operation, value]) => operation === 'eq' ? row.statut === value : row.statut !== value)
}

async function lirePages(table, params) {
  if (!T[table]) throw new Error('Table inconnue.')
  const rows = []
  const ids = new Set()
  // NocoDB Cloud can return fewer rows than requested without ending the list.
  for (;;) {
    params.set('limit', '100')
    params.set('offset', String(rows.length))
    const page = await api(`/tables/${T[table]}/records?${params}`)
    if (!Array.isArray(page?.list)) throw new Error('Lecture NocoDB incohérente : liste absente.')
    const batch = page.list
    for (const row of batch) {
      if (!row || !idValide(row.Id) || ids.has(row.Id)) throw new Error('Pagination NocoDB incohérente : Id invalide ou ambigu.')
      ids.add(row.Id)
    }
    rows.push(...batch)
    if (page.pageInfo?.isLastPage === true) return rows
    if (!batch.length) {
      if (page.pageInfo?.isLastPage === false) throw new Error('Pagination NocoDB incohérente : lecture interrompue.')
      return rows
    }
    if (rows.length >= 100000) throw new Error('Pagination anormale : lecture interrompue.')
  }
}

export async function lire(table, q = '') {
  const params = new URLSearchParams(q.replace(/^[?&]/, ''))
  const liens = liensDossier(table)
  if (!liens.length) return lirePages(table, params)
  const where = params.get('where')
  const filtre = filtreStatut(where)
  params.delete('where')
  projection(params, ['Id', 'fusionne_vers', ...liens, ...(where ? ['statut'] : [])])
  const rows = await lirePages(table, params)
  return actifs(table, rows).filter(filtre)
}

function dossierId(id) {
  const value = Number(id)
  if (!/^\d+$/.test(String(id)) || !idValide(value)) throw new Error('Identifiant de dossier invalide.')
  return value
}

function cibleArchive(row) {
  if (row.fusionne_vers == null) return null
  if (!idValide(row.fusionne_vers)) throw new Error(`Dossier #${row.Id} : fusionne_vers invalide, vérification nécessaire.`)
  return row.fusionne_vers
}

function refuserArchive(row) {
  const target = cibleArchive(row)
  if (target !== null) throw new Error(`Dossier #${row.Id} archivé vers le dossier canonique #${target}. Aucune modification effectuée ; consulter le dossier #${target}.`)
}

function tableau(lignes, colonnes) {
  if (!lignes.length) return console.log('  (aucun resultat)')
  const l = colonnes.map((c) => Math.max(c.length, ...lignes.map((x) => String(x[c] ?? '').length)))
  console.log('  ' + colonnes.map((c, i) => c.padEnd(l[i])).join('  '))
  console.log('  ' + l.map((n) => '-'.repeat(n)).join('  '))
  for (const x of lignes) console.log('  ' + colonnes.map((c, i) => String(x[c] ?? '').padEnd(l[i])).join('  '))
}

export const commandes = {
  async candidatures() {
    const p = await lire('participations', '&where=' + encodeURIComponent('(statut,neq,Engage)~and(statut,neq,Refuse)~and(statut,neq,Abandonne)') +
      '&fields=Id,code,statut,date_candidature,etablissement')
    console.log(`\nCandidatures etablissements en cours — ${p.length}\n`)
    tableau(p.map((x) => ({
      id: x.Id, etablissement: x.etablissement?.nom ?? '?',
      statut: x.statut ?? '', recue_le: x.date_candidature ?? '',
    })), ['id', 'etablissement', 'statut', 'recue_le'])
    console.log('\n  Pour faire avancer un dossier : bun scripts/base.mjs statut <id> "<statut>"')
    console.log('  Statuts possibles : ' + STATUTS_ETAB.join(' · ') + '\n')
  },

  async formateurs() {
    const e = await lire('engagements', '&fields=Id,code,statut,priorite,date_candidature,formateur')
    const enCours = e.filter((x) => !['Habilite', 'Formateur validé', 'Refuse', 'Abandonne'].includes(x.statut))
    console.log(`\nCandidatures formateurs en cours — ${enCours.length} (sur ${e.length})\n`)
    tableau(enCours.map((x) => ({
      id: x.Id, personne: [x.formateur?.prenom, x.formateur?.nom].filter(Boolean).join(' ') || '?',
      statut: x.statut ?? '', priorite: x.priorite ?? '',
    })), ['id', 'personne', 'statut', 'priorite'])
    console.log('\n  Statuts possibles : ' + STATUTS_FORM.join(' · ') + '\n')
  },

  async campagne() {
    const [part, eng, coh] = await Promise.all([
      lire('participations', '&fields=Id,statut,cohorte'),
      lire('engagements', '&fields=Id,statut,cohorte'),
      lire('cohortes', '&fields=Id,nom,active,objectif_etablissements'),
    ])
    const actives = coh.filter((c) => c.active === true || c.active === 1)
    if (actives.length !== 1) throw new Error('Cohorte active absente ou ambiguë.')
    const active = actives[0]
    console.log(`\nCampagne — cohorte ${active.nom ?? '?'}\n`)
    const pc = part.filter((x) => x.cohortes_id === active.Id)
    const sansCohorte = part.filter((x) => !coh.some((c) => c.Id === x.cohortes_id)).length
    const engages = pc.filter((x) => x.statut === 'Engage').length
    const objectif = active?.objectif_etablissements ?? 30
    console.log(`  Etablissements engages : ${engages} / ${objectif}   (il en manque ${Math.max(0, objectif - engages)})`)
    if (sansCohorte) console.log(`  Dossiers avec cohorte indéterminée, hors de ce total : ${sansCohorte}`)
    const parStatut = (l) => l.reduce((a, x) => ((a[x.statut || '?'] = (a[x.statut || '?'] || 0) + 1), a), {})
    console.log('\n  Pipeline etablissements :')
    for (const [s, n] of Object.entries(parStatut(pc)).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${s}`)
    }
    // Un parcours n'est pas une personne : une candidature et une formation
    // peuvent appartenir au meme formateur. Ne pas appeler ce total un vivier.
    console.log('\n  Parcours formateurs (candidatures et formations, toutes promotions) :')
    for (const [s, n] of Object.entries(parStatut(eng)).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${s}`)
    }
    console.log()
  },

  async etablissement(id) {
    if (!id) return console.error('Usage : bun scripts/base.mjs etablissement <id>')
    const recordId = dossierId(id)
    const p = await api(`/tables/${T.participations}/records/${recordId}`)
    if (p?.Id !== recordId) throw new Error('Lecture du dossier incohérente.')
    const target = cibleArchive(p)
    console.log('\n' + '─'.repeat(60))
    console.log(`  Dossier #${recordId}${target === null ? '' : ` — ARCHIVÉ vers le dossier canonique #${target} (historique conservé)`}`)
    console.log('  ' + (p.etablissement?.nom ?? '(sans nom)'))
    console.log('─'.repeat(60))
    for (const [k, v] of Object.entries(p)) {
      if (v === null || v === '' || k === 'Id') continue
      const val = typeof v === 'object' ? (v.nom ?? JSON.stringify(v)) : v
      console.log(`  ${k.padEnd(24)} ${val}`)
    }
    console.log()
  },

  async statut(id, nouveau) {
    if (!id || !nouveau) throw new Error('Usage : bun scripts/base.mjs statut <id> "<statut>"')
    const recordId = dossierId(id)
    if (!STATUTS_ETAB.includes(nouveau)) {
      throw new Error(`Statut inconnu.\nStatuts possibles : ${STATUTS_ETAB.join(' · ')}`)
    }
    // Keep the raw snapshot for the archive diagnostic; never retarget a write.
    const rows = await lirePages('participations', new URLSearchParams({
      fields: 'Id,fusionne_vers,etablissements_id,cohortes_id,statut',
    }))
    const selected = rows.find((row) => row.Id === recordId)
    if (!selected) throw new Error(`Dossier #${recordId} introuvable.`)
    refuserArchive(selected)
    const dossiers = actifs('participations', rows)
    if (!idValide(selected.etablissements_id) || !idValide(selected.cohortes_id))
      throw new Error(`Dossier #${recordId} : établissement ou cohorte indéterminé, vérification nécessaire avant modification.`)
    const matches = dossiers.filter((row) => row.etablissements_id === selected.etablissements_id &&
      (row.cohortes_id === selected.cohortes_id || !idValide(row.cohortes_id)))
    if (matches.length !== 1)
      throw new Error(`Dossier #${recordId} ambigu : plusieurs dossiers actifs pour cet établissement et cette cohorte, ou cohorte indéterminée. Aucune modification effectuée.`)
    // Recheck the selected row immediately before writing; grouping may have
    // changed during pagination. This is a guard, not a NocoDB transaction.
    const p = await api(`/tables/${T.participations}/records/${recordId}?fields=Id,fusionne_vers,etablissements_id,cohortes_id,statut,etablissement`)
    if (p?.Id !== recordId) throw new Error('Lecture du dossier incohérente.')
    refuserArchive(p)
    if (p.etablissements_id !== selected.etablissements_id || p.cohortes_id !== selected.cohortes_id || p.statut !== selected.statut)
      throw new Error(`Dossier #${recordId} modifié pendant la lecture. Relire le dossier avant de réessayer.`)
    await api(`/tables/${T.participations}/records`, {
      method: 'PATCH', body: JSON.stringify([{ Id: recordId, statut: nouveau }]),
    })
    console.log(`\n  ${p.etablissement?.nom ?? id} → ${nouveau}\n`)
  },

  /** Ce qui est arrive recemment — a defaut de notification par mail. */
  async nouveautes(jours = '7') {
    const seuil = new Date(Date.now() - Number(jours) * 86400000)
    const [p, e] = await Promise.all([
      lire('participations', '&fields=Id,statut,date_candidature,etablissement&sort=-Id'),
      lire('engagements', '&fields=Id,statut,date_candidature,formateur&sort=-Id'),
    ])
    const recent = (l) => l.filter((x) => x.date_candidature && new Date(x.date_candidature) >= seuil)
    const pe = recent(p), fe = recent(e)
    console.log(`\nArrive depuis ${jours} jours\n`)
    if (pe.length) {
      console.log('  Etablissements :')
      tableau(pe.map((x) => ({ id: x.Id, etablissement: x.etablissement?.nom ?? '?',
                               statut: x.statut ?? '', le: x.date_candidature })),
              ['id', 'etablissement', 'statut', 'le'])
    } else console.log('  Etablissements : aucun')
    console.log()
    if (fe.length) {
      console.log('  Formateurs :')
      tableau(fe.map((x) => ({ id: x.Id,
                               personne: [x.formateur?.prenom, x.formateur?.nom].filter(Boolean).join(' ') || '?',
                               statut: x.statut ?? '', le: x.date_candidature })),
              ['id', 'personne', 'statut', 'le'])
    } else console.log('  Formateurs : aucun')
    console.log("\n  Rappel : aucune notification par mail n'est encore branchee.")
    console.log('  Cette commande est le seul moyen de voir ce qui est arrive.\n')
  },

  /** Dossiers bloques sur le meme statut depuis longtemps. */
  async dormants(jours = '21') {
    const seuil = Number(jours)
    const p = await lire('participations', '&fields=Id,statut,date_candidature,etablissement')
    const aujourdhui = new Date()
    const bloques = p
      .filter((x) => !['Engage', 'Refuse', 'Abandonne'].includes(x.statut) && x.date_candidature)
      .map((x) => ({
        id: x.Id,
        etablissement: x.etablissement?.nom ?? '?',
        statut: x.statut ?? '',
        depuis_jours: Math.floor((aujourdhui - new Date(x.date_candidature)) / 86400000),
      }))
      .filter((x) => x.depuis_jours >= seuil)
      .sort((a, b) => b.depuis_jours - a.depuis_jours)
    console.log(`\nCandidatures âgées de ${seuil} jours ou plus (dernier échange à vérifier) — ${bloques.length}\n`)
    tableau(bloques, ['id', 'etablissement', 'statut', 'depuis_jours'])
    if (bloques.length) {
      console.log("\n  Aucun mail ne part tout seul : ces relances sont a envoyer a la main.")
      console.log('  Pour un modele : bun scripts/base.mjs modele <code>\n')
    } else console.log()
  },

  /** Les modeles d'e-mails que l'equipe edite dans la base. */
  async modeles() {
    const t = await lire('templates_emails', '&fields=Id,code,libelle,cible,sujet')
    console.log(`\nModeles d'e-mails — ${t.length}\n`)
    tableau(t.map((x) => ({ code: x.code, cible: x.cible ?? '', libelle: (x.libelle ?? '').slice(0, 46) })),
            ['code', 'cible', 'libelle'])
    console.log('\n  Pour en lire un : bun scripts/base.mjs modele <code>\n')
  },

  async modele(code) {
    if (!code) return console.error('Usage : bun scripts/base.mjs modele <code>')
    const t = await lire('templates_emails', '&where=' + encodeURIComponent(`(code,eq,${code})`))
    if (!t.length) return console.error(`Modele « ${code} » introuvable. Liste : bun scripts/base.mjs modeles`)
    const m = t[0]
    const blocs = (await lire('blocs_template', '&fields=Id,ordre,type,contenu,url,template'))
      .filter((b) => b.template?.Id === m.Id)
      .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))
    console.log('\n' + '─'.repeat(64))
    console.log('  ' + (m.libelle ?? m.code))
    console.log('  Objet : ' + (m.sujet ?? '(sans objet)'))
    console.log('─'.repeat(64))
    for (const b of blocs) {
      console.log(`\n  [${b.type}]${b.url ? '  → ' + b.url : ''}`)
      console.log('  ' + (b.contenu ?? '').replace(/\n/g, '\n  '))
    }
    console.log('\n  Variables : {{prenom}} {{nom}} {{etablissement}} {{cohorte}} {{date}} …')
    console.log('  Ce modele se modifie dans NocoDB, table templates_emails.\n')
  },

  async chiffres() {
    const n = {}
    for (const t of Object.keys(T)) {
      if (liensDossier(t).length) {
        n[t] = (await lire(t, '&fields=Id')).length
        continue
      }
      const d = await api(`/tables/${T[t]}/records?limit=1`)
      n[t] = d.pageInfo?.totalRows ?? 0
    }
    console.log('\nContenu de la base\n')
    for (const [k, v] of Object.entries(n)) console.log(`  ${String(v).padStart(5)}  ${k}${liensDossier(k).length ? ' (non archivés)' : ''}`)
    console.log()
  },
}

if (import.meta.main) {
const [cmd, ...args] = process.argv.slice(2)
if (!cmd || !commandes[cmd]) {
  console.log(`
Base EUNEOS — commandes disponibles

  bun scripts/base.mjs campagne            ou en est la campagne de recrutement
  bun scripts/base.mjs candidatures        les candidatures etablissements a traiter
  bun scripts/base.mjs formateurs          les candidatures formateurs a traiter
  bun scripts/base.mjs etablissement <id>  la fiche complete d'un dossier
  bun scripts/base.mjs statut <id> "..."   faire avancer un dossier
  bun scripts/base.mjs nouveautes [jours]  ce qui est arrive recemment (defaut 7 j)
  bun scripts/base.mjs dormants [jours]    les dossiers sans mouvement (defaut 21 j)
  bun scripts/base.mjs modeles             les modeles d'e-mails disponibles
  bun scripts/base.mjs modele <code>       lire un modele en entier
  bun scripts/base.mjs chiffres            combien de lignes dans chaque table
`)
  process.exit(cmd ? 1 : 0)
}
commandes[cmd](...args).catch((e) => { console.error('\n  ' + e.message + '\n'); process.exit(1) })

}
