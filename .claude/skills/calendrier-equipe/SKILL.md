---
name: calendrier-equipe
description: Lire et modifier les calendriers de l'espace interne (éditorial, équipe & heures) : voir un mois, créer une fiche, changer des heures, une présence, un statut, déplacer une publication. À utiliser dès que l'équipe parle de calendrier, de publication, d'heures, de congé, d'absence ou de présence.
---

# Calendrier de l'équipe

Les calendriers ne sont **pas dans NocoDB** : ils sont dans la base des pages internes. On y
accède uniquement par `bun scripts/calendrier.ts`, qui applique exactement les règles des pages.

## Commandes

```
bun scripts/calendrier.ts mois 2026-10 equipe          # fiches équipe & heures du mois
bun scripts/calendrier.ts mois 2026-10 editorial       # calendrier éditorial du mois
bun scripts/calendrier.ts heures 2026-10               # heures réalisées par personne
bun scripts/calendrier.ts fiche <id>                   # une fiche, avec sa version
bun scripts/calendrier.ts creer '<fiche JSON>'
bun scripts/calendrier.ts modifier <id> '<seulement les champs à changer>'
bun scripts/calendrier.ts deplacer <id> 2026-10-22     # publication éditoriale
```

Supprimer une fiche : **pas depuis l'agent**. Dire à la personne de le faire dans l'espace interne.

## Une fiche

| Champ | Valeurs |
|---|---|
| `kind` | `equipe` (équipe & heures) ou `editorial` |
| `title` | texte court |
| `starts_on`, `ends_on` | `AAAA-MM-JJ`. Des heures sur une fiche = un seul mois |
| `person` | équipe : l'adresse email de la personne. Éditorial : `Pauline`, `Candice` ou `Charlotte` |
| `status` | équipe : `brouillon`, `a_valider`, `valide`, `programme`, `annule`. Éditorial : `en_cours`, `a_creer`, `a_modifier`, `a_valider`, `programme`, `valide`, `publie` |
| `attendance` | équipe : `presence`, `absence`, `conge` (vide pour l'éditorial). **Des heures saisies = `presence`** |
| `hours` | nombre ou `null` (1,5 = 1 h 30) |
| `activity`, `channel`, `location`, `notes`, `content`, `link` | texte, `""` si vide. Canal éditorial : `LinkedIn`, `Newsletter` ou `Site` |

## Règles

1. **Lire avant d'écrire** : `mois` ou `fiche` d'abord, puis montrer à la personne ce qui va changer.
2. **Accord explicite** avant `creer`, `modifier` ou `deplacer`. La commande demande aussi une permission.
3. Après l'écriture, la commande **relit la fiche** et l'affiche : c'est elle qui fait foi, la répéter à la personne.
4. **Valider des heures** (`valide` sur une fiche équipe) est réservé aux responsables. Une fiche équipe ne se modifie que par son auteur ou un responsable. Si la commande refuse, **le dire tel quel**, ne pas contourner.
5. En cas d'erreur, **ne pas relancer à l'aveugle** : relire la fiche ou le mois.
6. Les disponibilités du mois (« Couvrir tout le mois ») se saisissent dans l'espace interne, pas par l'agent.
