# Formulaire 5 — Organisation des activités avec les jeunes

## Statut de cette proposition

La page `/suivi/activites-jeunes-apercu` est une **maquette interactive réservée aux domaines d’aperçu**. Sur `euneos.fr`, elle répond 404. Elle ne crée aucun lien et ne reçoit aucune réponse. Ne la présenter ni comme un formulaire en service ni comme raccordée à NocoDB. La diffusion attend les changements décrits ci-dessous et leur vérification dans une seconde proposition.

## Placement et questions

Dans `/interne/formulaires`, placer « Organisation des activités avec les jeunes » après « Organisation de la formation » (formulaire 4). La réponse doit être rattachée par lien personnel à la participation annuelle, son établissement et sa cohorte. La maquette élimine les doublons présents dans le texte du Google Form et réutilise le nom d’établissement du dossier. Elle collecte les effectifs globaux et niveaux même si l’évaluation scientifique est refusée. Elle ne demande aucun identifiant d’élève.

Si l’établissement choisit l’évaluation, ses classes actives et témoins sont des **propositions**, avec classe, niveau, effectif, enseignant responsable et, pour les classes actives, format d’ateliers. Recueillir les effectifs totaux de chaque groupe et les dates T1 et T2 pour chaque groupe, quand elles sont connues. Collecter le planning et le nombre d’ateliers une seule fois, facultativement. Les confirmations de l’organisation et des modifications futures s’appliquent à tous les établissements.

## Raccordement à réaliser avant activation

1. Lire à nouveau les schémas NocoDB de `participations`, `groupes_jeunes`, `ateliers` et `codes_anonymes`. Définir avec l’administrateur les champs de réception (effectifs globaux, niveaux, participation à l’évaluation, groupes proposés, dates, ateliers et leur provenance) ainsi que le lien personnel privé. Les outils NocoDB disponibles pour cet agent ne permettent pas de créer des colonnes ; aucune évolution de schéma n’a été appliquée.
2. Étendre le circuit existant des liens personnels et des reçus techniques à un quatrième type, avec migration contrôlée des contraintes D1, avant d’ajouter ce type au sélecteur interne. L’émission du lien ne doit envoyer aucun message ; une réponse reçue ne doit jamais être associée à un autre dossier ou une autre cohorte.
3. Valider côté serveur l’option facultative, les bornes des effectifs, les classes distinctes entre groupe actif et témoin, la cohérence des sommes et la chronologie T1/T2. Les effectifs des groupes d’évaluation ne représentent pas forcément la totalité des jeunes sensibilisés. En cas de divergence, marquer une vérification humaine sans écraser les données existantes.
4. Enregistrer la déclaration brute et sa provenance sur la participation concernée. Ne créer ou modifier les groupes et dates opérationnels qu’après validation humaine de la répartition. Ne générer ni promettre de feuille de codes anonymes à partir de cette seule réception : vérifier et mettre en place séparément la génération sécurisée, la déduplication et la remise aux responsables autorisés.
5. Vérifier le parcours complet sur un dossier fictif dans un environnement isolé, avec envoi et écriture réels désactivés sur l’aperçu. Après confirmation de la réception en base et des contrôles de cohérence, activer le lien dans le parcours interne.

Source des questions : transcription du formulaire Google transmise par l’utilisatrice le 29 septembre 2026. Schéma vérifié via les outils NocoDB du Space EUNEOS et circuit actuel lu dans `docs/operational-forms.md` et le code du dépôt. Aucun dossier réel, contact ou code d’élève dans cette proposition.
