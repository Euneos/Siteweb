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
const API = 'https://app.nocodb.com/api/v2'

const T = {
  etablissements: 'mg12klh5zv7b5n5',
  participations: 'mbunbu0f1zztce4',
  formateurs: 'mblganql53o34gm',
  engagements: 'mom9m2q83nainyz',
  cohortes: 'm5ayop8ul8s040l',
  missions: 'merrsayuq3xb3uk',
  adultes: 'mzbpzuikti6h3pz',
  groupes_jeunes: 'm9rjb4oixy04ptt',
}

const STATUTS_ETAB = ['Candidature recue', 'Accuse reception', 'Invite', 'En discussion',
                      'Retenu', 'Engage', 'Refuse', 'Abandonne']
const STATUTS_FORM = ['Candidature recue', 'Accuse reception', 'Invite reunion info',
                      'En attente confirmation', 'Confirme pour formation', 'En formation',
                      'Habilite', 'Refuse', 'Abandonne']

const token = process.env.NOCODB_TOKEN
if (!token) {
  console.error("Il manque le jeton d'acces a la base.\n" +
    "Cree un fichier .env a la racine du projet avec :\n  NOCODB_TOKEN=nc_pat_...")
  process.exit(1)
}

async function api(chemin, options = {}) {
  const r = await fetch(API + chemin, {
    ...options,
    headers: { 'xc-token': token, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!r.ok) throw new Error(`Base injoignable (${r.status}) : ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

const lire = (table, q = '') => api(`/tables/${T[table]}/records?limit=200${q}`).then((d) => d.list || [])

function tableau(lignes, colonnes) {
  if (!lignes.length) return console.log('  (aucun resultat)')
  const l = colonnes.map((c) => Math.max(c.length, ...lignes.map((x) => String(x[c] ?? '').length)))
  console.log('  ' + colonnes.map((c, i) => c.padEnd(l[i])).join('  '))
  console.log('  ' + l.map((n) => '-'.repeat(n)).join('  '))
  for (const x of lignes) console.log('  ' + colonnes.map((c, i) => String(x[c] ?? '').padEnd(l[i])).join('  '))
}

const commandes = {
  async candidatures() {
    const p = await lire('participations', '&where=' + encodeURIComponent('(statut,neq,Engage)') +
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
    const enCours = e.filter((x) => !['Habilite', 'Refuse', 'Abandonne'].includes(x.statut))
    console.log(`\nCandidatures formateurs en cours — ${enCours.length} (sur ${e.length})\n`)
    tableau(enCours.slice(0, 60).map((x) => ({
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
    const active = coh.find((c) => c.active)
    console.log(`\nCampagne — cohorte ${active?.nom ?? '?'}\n`)
    const pc = part.filter((x) => x.cohorte?.nom === active?.nom)
    const engages = pc.filter((x) => x.statut === 'Engage').length
    const objectif = active?.objectif_etablissements ?? 30
    console.log(`  Etablissements engages : ${engages} / ${objectif}   (il en manque ${Math.max(0, objectif - engages)})`)
    const parStatut = (l) => l.reduce((a, x) => ((a[x.statut || '?'] = (a[x.statut || '?'] || 0) + 1), a), {})
    console.log('\n  Pipeline etablissements :')
    for (const [s, n] of Object.entries(parStatut(pc)).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${s}`)
    }
    // Les formateurs ne sont pas rattaches a une cohorte : leur champ d'origine
    // contenait une SESSION ("Avril 2026", "Septembre 2026"), pas une cohorte.
    // On montre donc tout le vivier.
    console.log('\n  Pipeline formateurs (tout le vivier) :')
    for (const [s, n] of Object.entries(parStatut(eng)).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${s}`)
    }
    console.log()
  },

  async etablissement(id) {
    if (!id) return console.error('Usage : bun scripts/base.mjs etablissement <id>')
    const p = await api(`/tables/${T.participations}/records/${id}`)
    console.log('\n' + '─'.repeat(60))
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
    if (!id || !nouveau) return console.error('Usage : bun scripts/base.mjs statut <id> "<statut>"')
    if (!STATUTS_ETAB.includes(nouveau)) {
      return console.error(`Statut inconnu.\nStatuts possibles : ${STATUTS_ETAB.join(' · ')}`)
    }
    await api(`/tables/${T.participations}/records`, {
      method: 'PATCH', body: JSON.stringify([{ Id: Number(id), statut: nouveau }]),
    })
    const p = await api(`/tables/${T.participations}/records/${id}`)
    console.log(`\n  ${p.etablissement?.nom ?? id} → ${nouveau}\n`)
  },

  async chiffres() {
    const n = {}
    for (const t of Object.keys(T)) {
      const d = await api(`/tables/${T[t]}/records?limit=1`)
      n[t] = d.pageInfo?.totalRows ?? 0
    }
    console.log('\nContenu de la base\n')
    for (const [k, v] of Object.entries(n)) console.log(`  ${String(v).padStart(5)}  ${k}`)
    console.log()
  },
}

const [cmd, ...args] = process.argv.slice(2)
if (!cmd || !commandes[cmd]) {
  console.log(`
Base EUNEOS — commandes disponibles

  bun scripts/base.mjs campagne            ou en est la campagne de recrutement
  bun scripts/base.mjs candidatures        les candidatures etablissements a traiter
  bun scripts/base.mjs formateurs          les candidatures formateurs a traiter
  bun scripts/base.mjs etablissement <id>  la fiche complete d'un dossier
  bun scripts/base.mjs statut <id> "..."   faire avancer un dossier
  bun scripts/base.mjs chiffres            combien de lignes dans chaque table
`)
  process.exit(cmd ? 1 : 0)
}
commandes[cmd](...args).catch((e) => { console.error('\n  ' + e.message + '\n'); process.exit(1) })
