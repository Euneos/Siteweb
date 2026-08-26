---
name: point-de-campagne
description: Faire le point sur le recrutement des établissements et des formateurs pour la cohorte en cours. À utiliser quand l'équipe demande où on en est, combien il manque d'établissements, un point hebdomadaire, ou l'état du pipeline.
---

# Point de campagne

L'objectif de l'année est explicite : **30 établissements engagés pour 2026-2027**. Tout le
reste s'y rapporte.

```
bun scripts/base.mjs campagne     # engagés / objectif, et les deux pipelines
bun scripts/base.mjs dormants     # ce qui bloque
```

## Ce qu'un bon point contient

1. **Le chiffre qui compte** : combien d'établissements engagés, combien il en manque.
2. **Où sont les dossiers** : la répartition par statut, et surtout ceux coincés en
   `Candidature recue` — c'est là que la campagne se gagne ou se perd.
3. **Ce qui dort** : les dossiers sans mouvement, du plus ancien au plus récent.
4. **Une seule action recommandée**, pas une liste. Celle qui débloque le plus.

## À savoir en lisant les chiffres

- Un **établissement** et une **participation** ne sont pas la même chose. Une école qui
  revient l'année suivante compte comme une nouvelle participation, pas comme un doublon.
- Les **formateurs ne sont rattachés à aucune cohorte** : leur champ d'origine contenait une
  session (`Avril 2026`, `Septembre 2026`), pas une cohorte. Le vivier est donc affiché en
  entier. C'est un défaut de données connu, à nettoyer.
- Les tables `conventions`, `factures`, `relances` et `codes_anonymes` sont **vides** — elles
  l'étaient déjà dans l'ancien système. Ne pas en tirer de conclusion.

## Ton

Direct, chiffré, sans enrobage. Si la campagne est en retard, le dire. Ces chiffres servent
à décider, pas à rassurer.
