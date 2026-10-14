---
name: rattacher-reponses
description: Rattacher à leur dossier les réponses des formulaires du site restées « À vérifier » ou « À rapprocher » (fiche contact, organisation de la formation…). À utiliser quand un établissement dit avoir rempli un formulaire mais que le suivi ne le montre pas.
---

# Rattacher les réponses du site

Le site ne rattache une réponse que si le nom **et** la ville de l'établissement sont écrits
exactement comme dans la base. Une faute de frappe (« Exernat », « Notre-Dmai ») suffit à la
laisser de côté : elle est enregistrée mais n'apparaît dans aucun dossier.

1. `bun scripts/rattacher-reponses.ts liste` : les réponses en attente et, pour chacune, les
   dossiers ouverts candidats, trouvés **par adresse** du référent (fiable) ou **par nom** et ville.
2. Montrer la liste à la personne. **Elle choisit** le dossier de chaque réponse. Ne jamais
   rattacher seul : une même école peut avoir plusieurs dossiers, un candidat « par nom » peut se tromper.
3. Pour chaque choix : d'abord `bun scripts/rattacher-reponses.ts rattacher <réponse> <dossier> --essai`
   (rien n'est écrit), puis sans `--essai` après son accord.
4. La commande relit la réponse : `Reportée dans le dossier` = c'est fait. `À vérifier` avec un
   détail = le report a buté (le dire tel quel, ne pas relancer à l'aveugle).
5. Sans aucun candidat : l'établissement n'a pas de dossier ouvert pour cette année. Demander
   s'il faut en créer un, ne pas deviner.

Signaler aussi une faute dans le nom d'un établissement de la base : la corriger (avec accord)
évite que les réponses suivantes restent de côté.
