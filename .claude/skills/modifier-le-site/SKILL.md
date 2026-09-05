---
name: modifier-le-site
description: Changer un texte, une photo ou une section du site euneos.fr, puis publier. À utiliser dès que l'équipe demande de modifier, corriger, remplacer ou ajouter quelque chose sur le site.
---

# Modifier le site

## Avant de toucher au code

Lire `AGENTS.md` — il contient les règles graphiques (couleurs, typographie, pliures,
silhouettes) et **six pièges déjà rencontrés**. S'en écarter casse la charte.

Les pages sont dans `src/pages/` :
`index.astro` (Bienvenue) · `programme.astro` · `qui-sommes-nous.astro` · `contact.astro` ·
`candidater/etablissement.astro` · `candidater/formateur.astro`

## Vérifier avant de publier

```
bun run test       # newsletter, sans email réel
bun run build      # doit finir sans erreur
bunx wrangler pages dev dist --port 4321  # site compilé
# Dans un autre terminal :
CHECK_SCREENSHOTS=/tmp/euneos-layout bun run test:layout
```

**Suivre les règles « Corrections Pauline — 5 septembre 2026 » de `AGENTS.md`.**
Les images et graphismes déjà présents sont intégrés par l’agent, sans demander à Pauline
un hébergement externe. Examiner les captures générées, en plus des assertions.

**Toujours vérifier en petite largeur.** Le site a un seul point de bascule, à 860 px : une
modification qui rend bien sur ordinateur peut se casser sur téléphone.

## Publier

Un commit et un push suffisent : la mise en ligne se fait toute seule en deux à trois
minutes.

```
git add -A && git commit -m "…" && git push
```

Puis **vérifier sur `euneos.fr`**, pas seulement en local. Annoncer le résultat à l'équipe
avec l'adresse exacte de la page modifiée.

## Vérifier que la publication a RÉELLEMENT abouti

**Ne jamais annoncer « c'est en ligne » après un simple `git push`.**
Le 27/08, un push a échoué côté GitHub (téléchargement de bun cassé, `ECONNRESET`)
et la modification a été présentée comme publiée alors que le site n'avait pas bougé.
La panne a été découverte par hasard, le lendemain.

Après le push, attendre et confirmer le run :

```
gh run list --limit 1 --json status,conclusion --jq '.[0]'
```

Puis vérifier la page réelle, pas seulement le workflow :

```
curl -s https://euneos.fr/<page> | grep "<un mot du nouveau texte>"
```

Tant que les deux ne sont pas verts, la réponse à donner est **« en cours »**, jamais
« en ligne ». Si le workflow a échoué :

```
gh run rerun <id> --failed
```

Et si l'échec vient du code et non du réseau, le dire franchement et corriger.

## Règles

- **Ne jamais inventer un texte destiné au public.** Les contenus viennent de Pauline ou de
  Candice. S'il manque une phrase, la demander plutôt que de la rédiger.
- **Une photo d'élève ou d'enseignant ne se publie pas sans autorisation de droit à l'image**
  — il s'agit souvent de mineurs. Le signaler à chaque fois qu'une photo est ajoutée.
- Ne pas modifier `/style-guide` pour changer l'apparence d'une page : cette page **reflète**
  le code, elle ne le commande pas.
