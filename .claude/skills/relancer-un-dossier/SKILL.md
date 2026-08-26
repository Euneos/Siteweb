---
name: relancer-un-dossier
description: Trouver les candidatures qui n'avancent plus et préparer les relances. À utiliser quand l'équipe parle de relances, de dossiers en attente, de gens qui ne répondent pas, ou demande qui il faut recontacter.
---

# Relancer un dossier

C'est la douleur n°1 exprimée par l'équipe : *« il faut relancer sans arrêt pour obtenir les
informations manquantes »*. L'objectif de cette compétence est de rendre visible ce qui dort.

## Voir ce qui dort

```
bun scripts/base.mjs dormants        # sans mouvement depuis 21 jours
bun scripts/base.mjs dormants 60     # ou depuis le nombre de jours voulu
```

La colonne `depuis_jours` compte à partir de la date de candidature. Un dossier à plus de
200 jours n'est probablement pas une relance : c'est un dossier à clore. Le proposer.

## Préparer la relance

1. Ouvrir la fiche : `bun scripts/base.mjs etablissement <id>` — vérifier le nom du référent
   et son adresse.
2. Choisir un modèle : `bun scripts/base.mjs modeles`, puis `modele <code>`.
3. **Rédiger le message et le donner à l'équipe** — prêt à copier dans leur messagerie.

## La règle qui compte

**Aucun e-mail ne part depuis cet outil.** C'est un choix d'EUNEOS, pas une limite technique
à contourner : les personnes qui candidatent reçoivent une réponse humaine.

Donc : préparer le texte, le présenter, et **dire explicitement que rien n'a été envoyé**.
Ne jamais laisser croire qu'une relance est partie.

## Après l'envoi

Quand l'équipe confirme avoir envoyé, faire avancer le statut :

```
bun scripts/base.mjs statut <id> "Accuse reception"
```

## Ce qu'il ne faut pas faire

- Relancer un dossier `Refuse` ou `Abandonne` sans demander : la décision a peut-être été
  prise en réunion, hors de la base.
- Traiter une liste entière d'un coup. Proposer, laisser choisir, avancer dossier par dossier.
