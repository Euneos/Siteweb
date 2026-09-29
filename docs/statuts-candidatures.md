# Statuts des candidatures établissements

Le champ `participations.statut` conserve une seule décision actuelle :

| Valeur | Signification |
|---|---|
| Candidature reçue | Candidature à étudier ou en cours d’étude. |
| Candidature acceptée | Décision favorable de l’équipe. |
| Établissement engagé | Engagement validé, avec fiche contact reçue et lettre d’intérêt signée. |
| Abandon | L’établissement ne poursuit pas sa candidature. |
| Refus | Décision défavorable de l’équipe. |

L’accusé de réception et la relance sont des événements de communication, pas
des décisions. Les états de formation, de présence et de paiement restent séparés.

`statut_origine` est une colonne texte d’historique. Elle conserve le libellé avant
harmonisation et ne doit plus être modifiée ensuite. Si la décision actuelle est
vide et l’ancienne valeur ambiguë, le site affiche « historique à qualifier ».
Il ne récupère jamais une ancienne acceptation dans une décision actuelle vide.

## Compatibilité et déploiement

Les codes des filtres existants restent compatibles ; les nouvelles écritures du
site et du script `base.mjs` utilisent les cinq libellés ci-dessus. Une commande de
statut est relue après écriture ; un résultat incertain ne doit pas être répété
automatiquement. Les formulaires de suivi refusent aussi les valeurs `Abandon` et
`Refus`.

L’harmonisation NocoDB est une opération séparée du déploiement du site :

1. Sauvegarder le schéma, les dossiers, les vues, les filtres et les déclencheurs.
2. Ajouter `statut_origine` et les cinq options sans retirer les anciens choix.
3. Publier et contrôler cette version compatible du site.
4. Conserver chaque ancien libellé, puis convertir les correspondances établies.
   `En cours d’analyse` devient `Candidature reçue`. Les états ambigus demandent une
   décision explicite ; ne pas convertir `Retenu` en acceptation par déduction.
5. Relire chaque dossier, préserver toutes les autres données et les archives,
   puis retirer les choix devenus inutilisés. Contrôler aussi les vues Kanban.

Un renommage d’un engagement historique ne vaut pas vérification de ses pièces.
Le rapprochement documentaire reste un contrôle distinct. Cette opération ne
doit déclencher aucun email : ne pas lui associer de notification sur changement
de libellé ou de date de modification. Les sauvegardes et reçus contenant les
dossiers réels restent dans le dossier privé de pilotage, hors de ce dépôt.
