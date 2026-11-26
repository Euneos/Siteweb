// EUNEOS : garder le dossier à jour et remettre le profil de la personne à sa place.
//
// Au chargement du dossier, puis toutes les trente minutes tant qu'OpenCode tourne :
//   1. récupérer la dernière version du dépôt (avance rapide seulement, rien n'est jamais poussé ici) ;
//   2. recopier equipe/<prénom>/AGENTS.md dans ~/.config/opencode/AGENTS.md si le contenu a changé
//      (l'ancienne version reste à côté, en AGENTS.md.avant-synchro) ;
//   3. noter le résultat dans ~/.euneos/derniere-synchro.json, lu par scripts/diagnostic-poste.sh.
// Le profil pris en compte est celui de la conversation suivante.
//
// Format OpenCode 2.x : un export par défaut { id, setup }. L'ancien format
// (`export const X: Plugin = async (...)`) n'est plus chargé depuis la version 2 :
// du 14/10 au 26/11/2026 ce fichier a échoué en silence et aucun poste ne se mettait à jour.
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const INTERVALLE = 30 * 60 * 1000

const lire = (chemin: string) => readFile(chemin, "utf8").catch(() => "")

// Ne lève jamais : renvoie la sortie, ou null si git a échoué (hors ligne, verrou, divergence).
const git = (dossier: string, ...args: string[]) =>
  new Promise<string | null>((resolve) => {
    execFile(
      "git",
      ["-C", dossier, ...args],
      { timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (erreur, sortie) => resolve(erreur ? null : String(sortie).trim()),
    )
  })

async function synchroniser(dossier: string) {
  const maison = homedir()
  const tire = (await git(dossier, "pull", "--ff-only", "--quiet")) !== null

  const email = (await lire(join(dossier, ".env"))).match(/^EUNEOS_EMAIL=(.+)$/m)?.[1]?.trim().toLowerCase()
  const membres = JSON.parse((await lire(join(dossier, "equipe/membres.json"))) || "{}") as Record<string, string>
  const prenom = email ? membres[email] : undefined

  let profil = "aucun"
  if (prenom) {
    const nouveau = await lire(join(dossier, "equipe", prenom, "AGENTS.md"))
    const cible = join(maison, ".config/opencode/AGENTS.md")
    const actuel = await lire(cible)
    if (!nouveau) profil = "introuvable"
    else if (nouveau === actuel) profil = "identique"
    else {
      await mkdir(dirname(cible), { recursive: true })
      // Ce qui avait été écrit à la main sur le poste n'est pas perdu : une copie reste à côté.
      if (actuel) await writeFile(cible + ".avant-synchro", actuel)
      await writeFile(cible, nouveau)
      profil = "mis à jour"
    }
  }

  const trace = {
    quand: new Date().toISOString(),
    dossier,
    version: await git(dossier, "log", "-1", "--format=%h %cI"),
    recuperation: tire ? "ok" : "échec",
    prenom: prenom ?? null,
    profil,
  }
  await mkdir(join(maison, ".euneos"), { recursive: true })
  await writeFile(join(maison, ".euneos/derniere-synchro.json"), JSON.stringify(trace, null, 2) + "\n")
}

export default {
  id: "euneos-sync",
  setup: async (ctx: { location?: { directory?: string; project?: { directory?: string } } }) => {
    const candidats = [ctx.location?.project?.directory, ctx.location?.directory].filter(Boolean) as string[]
    let dossier: string | undefined
    for (const candidat of candidats) {
      if (await lire(join(candidat, "equipe/membres.json"))) {
        dossier = candidat
        break
      }
    }
    if (!dossier) return

    const racine = dossier
    const passer = () => synchroniser(racine).catch(() => {})
    await passer()
    const minuterie = setInterval(passer, INTERVALLE)
    return () => clearInterval(minuterie)
  },
}
