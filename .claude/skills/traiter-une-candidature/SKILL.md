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
bun scripts/base.mjs statut <id> "Candidature acceptée"
```

Un seul champ `statut` porte la décision actuelle, avec cinq choix :
`Candidature reçue`, `Candidature acceptée`, `Établissement engagé`, `Abandon`, `Refus`.
Un accusé de réception ou une relance est un événement de communication, pas une décision.
`Établissement engagé` exige une fiche contact reçue et une lettre d’intérêt signée.
La présence des deux pièces ne change jamais automatiquement la décision.

`statut_origine` conserve le libellé avant l’harmonisation ; ne pas le modifier ni le
traiter comme un deuxième statut actuel. Un dossier sans décision actuelle dont l’ancien
état était ambigu reste « historique à qualifier ». Ne pas interpréter `Retenu` comme une
acceptation. Lire les choix du schéma avant une écriture ; ne pas recréer les anciens choix.

## Identité et dossiers regroupés

- Un établissement est identifié par son `Id`, son nom et sa ville. Deux collèges homonymes dans deux villes restent deux établissements.
- Une participation est un dossier d'un établissement pour une cohorte. Son `Id` et sa référence `DOS-…` identifient ce dossier ; ne pas confondre l'Id d'établissement avec l'Id de participation.
- `fusionne_vers` vide signifie dossier courant. Une valeur désigne l'Id du dossier courant qui remplace cette ancienne fiche. Les anciennes fiches restent dans « Historique des regroupements » ; elles ne comptent pas comme candidatures actives.
- Lire le schéma et l'ensemble des pages avant de compter ou rapprocher des dossiers. Vérifier que la cible du regroupement existe, n'est pas elle-même archivée et porte la même identité/cohorte. Arrêter en cas de cible absente, chaîne, cycle ou divergence.
- Les anciennes références `ETAB-C…` peuvent désigner plusieurs établissements. Elles sont conservées dans `historique_fusion` et les archives : ne jamais choisir une fiche ni importer des personnes sur ce code seul.
- Avant une écriture, vérifier de nouveau que le dossier choisi est courant. Si l'Id fourni est une archive, présenter le dossier de référence et refaire la vérification métier ; ne pas modifier l'archive et ne pas rediriger silencieusement une écriture.
- Avant une création, rechercher l'identité avec nom, ville et code postal, en tenant compte des anciens formats numériques. Vérifier la cohorte ; si plusieurs dossiers courants existent, qualifier le cas au lieu d'en créer un autre.
- Lors d'une reprise de données, conserver la source, sa date et l'historique. Ne pas relancer les anciens scripts d'import qui indexaient les établissements par nom ou par code seul.

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
