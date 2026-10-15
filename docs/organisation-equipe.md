# Organisation équipe

Page : `/interne/organisation-equipe`, réservée à l’équipe via Cloudflare Access.

## Lecture du tableau

Candice, Charlotte et Pauline sont en lignes. Les quatre colonnes sont « À faire aujourd’hui » (rose), « En cours » (orange), « En file d’attente » (jaune) et « Terminées » (vert clair).

Les cartes restent courtes : titre, rôle, participants, priorité, échéance et blocage. Les descriptions et raisons de blocage sont accessibles dans la fiche. La priorité est indépendante de l’étape ; au-delà de trois priorités actives par personne, un repère invite à arbitrer sans interdire l’enregistrement.

Les terminées des 14 derniers jours sont affichées par défaut. Le filtre donne accès à toutes les terminées non archivées ou aux archives. L’archivage se coche dans la fiche d’une tâche terminée. Décocher restaure la tâche terminée ; choisir une autre étape la rouvre. Aucun effacement ni archivage automatique.

## Une tâche, plusieurs participants

- `person` désigne l’unique responsable ; `contributors` contient les autres participantes.
- La tâche apparaît dans chaque ligne concernée avec le rôle « Responsable » ou « Contributeur ».
- Titre, description et statut sont communs : modifier une carte actualise toutes ses apparitions.
- Les indicateurs comptent les tâches uniques, pas leurs apparitions dans le tableau.
- Le formulaire reste utilisable au clavier et sur téléphone.

## Glisser-déposer

- Déplacer une carte Responsable vers une autre personne réattribue la responsabilité. Si la cible était contributrice, elle devient responsable ; l’ancienne responsable n’est pas ajoutée automatiquement aux contributeurs.
- Déplacer une carte Contributeur change la personne contributrice sans changer le responsable. Une cible déjà participante est refusée : les rôles se modifient alors dans la fiche.
- Changer d’étape change le statut partagé de la tâche, quel que soit le rôle de la carte déplacée.
- Dans la disposition actuelle, le mouvement horizontal change l’étape et le mouvement vertical change la personne.
- La version est contrôlée côté serveur. Après un conflit ou une réponse incertaine, actualiser avant une nouvelle modification ; pas de répétition automatique.

## Notifications

- Création : un e-mail au responsable.
- Changement de responsable : deux messages séparés, à l’ancien et au nouveau responsable. L’ancien est informé s’il reste contributeur.
- Modifier uniquement les contributeurs, le titre, la description ou le statut ne déclenche pas d’e-mail.
- Chaque destinataire a son reçu indépendant dans `team_task_notifications` ; un envoi incertain n’est pas retenté automatiquement. « Transmis » signifie accepté par le service d’envoi, pas livraison prouvée en boîte de réception.
- Les environnements d’essai et les hôtes autres que `https://euneos.fr` ne déclenchent aucun envoi.

La migration additive `0010_team_task_roles.sql` conserve les responsables, contenus, statuts et reçus existants. Les contributeurs sont initialement vides. Aucun e-mail rétroactif. Le circuit de publication est celui de `docs/internal-migrations.md`.

`0011_team_task_planning.sql` ajoute les métadonnées de planification sans reconstruire les tables. `completed_at` et `archived_at` portent la fin et l’archivage ; l’API expose alors le statut `terminee`. La colonne SQL historique `status` conserve la dernière étape active. Lors d’une réouverture, les deux dates de fin/archivage sont vidées. Les modifications sont protégées par la version de la tâche.
