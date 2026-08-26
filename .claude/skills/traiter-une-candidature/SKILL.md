---
name: traiter-une-candidature
description: Consulter les candidatures d'établissements ou de formateurs et faire avancer un dossier. À utiliser dès que l'équipe parle de candidatures, de dossiers, de pipeline, du recrutement d'établissements, ou demande où en est la campagne.
---

# Traiter une candidature

## D'abord regarder, ensuite agir

```
bun scripts/base.mjs campagne          # vue d'ensemble : combien engagés sur l'objectif
bun scripts/base.mjs candidatures      # établissements à traiter
bun scripts/base.mjs formateurs        # formateurs à traiter
```

Avant toute modification, ouvrir la fiche pour vérifier qu'on parle du bon dossier :

```
bun scripts/base.mjs etablissement <id>
```

## Faire avancer un dossier

```
bun scripts/base.mjs statut <id> "Accuse reception"
```

Les statuts, dans l'ordre du parcours :
`Candidature recue` → `Accuse reception` → `Invite` → `En discussion` → `Retenu` → `Engage`
Deux sorties : `Refuse`, `Abandonne`.

## Règles

- **Ne jamais changer un statut sans avoir nommé l'établissement à voix haute** et obtenu un
  oui. Plusieurs écoles portent des noms proches (il y a deux `Collège Charles Péguy` dans
  l'historique).
- **Changer le statut n'envoie aucun e-mail.** C'est volontaire. Si l'équipe veut prévenir la
  personne, elle le fait depuis sa messagerie — dites-le explicitement pour qu'elle ne croie
  pas que c'est parti tout seul.
- **Après l'action, redonner la ligne** : quel établissement, ancien statut, nouveau statut.

## Quand quelque chose cloche

Un établissement introuvable est presque toujours sous un autre statut, ou saisi avec une
orthographe différente. Chercher dans la liste complète avant de conclure qu'il n'existe pas.
Ne jamais créer un doublon « au cas où » : c'est exactement ce que la base a été construite
pour empêcher.
