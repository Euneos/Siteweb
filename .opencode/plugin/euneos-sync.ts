import type { Plugin } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join } from "node:path"

// EUNEOS : à chaque ouverture, récupérer la dernière version du dossier, puis remettre à jour le
// profil de la personne (equipe/<prénom>/AGENTS.md) dans ~/.config/opencode. Le profil pris en compte
// est celui de la conversation suivante. Rien n'est jamais poussé ici.
export const EuneosSync: Plugin = async ({ $, directory }) => {
  await $`git -C ${directory} pull --ff-only --quiet`.nothrow().quiet()
  const env = await Bun.file(join(directory, ".env")).text().catch(() => "")
  const email = env.match(/^EUNEOS_EMAIL=(.+)$/m)?.[1]?.trim().toLowerCase()
  const membres = await Bun.file(join(directory, "equipe/membres.json")).json().catch(() => ({}))
  const prenom = email ? (membres as Record<string, string>)[email] : undefined
  if (!prenom) return {}
  const source = Bun.file(join(directory, "equipe", prenom, "AGENTS.md"))
  const cible = join(homedir(), ".config/opencode/AGENTS.md")
  if (await source.exists()) {
    const nouveau = await source.text()
    const actuel = await Bun.file(cible).text().catch(() => "")
    if (nouveau !== actuel) await Bun.write(cible, nouveau)
  }
  return {}
}
