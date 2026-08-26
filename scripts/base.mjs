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
    console.log(`\nDossiers sans mouvement depuis ${seuil} jours ou plus — ${bloques.length}\n`)
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
  bun scripts/base.mjs nouveautes [jours]  ce qui est arrive recemment (defaut 7 j)
  bun scripts/base.mjs dormants [jours]    les dossiers sans mouvement (defaut 21 j)
  bun scripts/base.mjs modeles             les modeles d'e-mails disponibles
  bun scripts/base.mjs modele <code>       lire un modele en entier
  bun scripts/base.mjs chiffres            combien de lignes dans chaque table
`)
  process.exit(cmd ? 1 : 0)
}
commandes[cmd](...args).catch((e) => { console.error('\n  ' + e.message + '\n'); process.exit(1) })
