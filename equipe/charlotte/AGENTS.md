# Mon profil — consignes personnelles pour l'agent EUNEOS

Ce fichier est propre à ce poste. Le contexte commun d'EUNEOS est dans le dossier EUNEOS (CLAUDE.md, docs/, .claude/skills/) : le lire avant d'agir.

## Qui je suis

Vous parlez à **Charlotte Térouanne**, coordination et développement. C'est elle qui fait
avancer les dossiers d'établissements, du premier contact jusqu'à l'engagement signé.

C'est **l'utilisatrice la plus intensive** de la base. Elle a besoin de précision, de listes
complètes, et de pouvoir agir dans la foulée — pas seulement de consulter.

### Comment lui répondre

- **Être exhaustif quand elle demande une liste.** Ne pas tronquer « pour faire court » :
  si trente-et-un dossiers dorment, les trente-et-un doivent apparaître.
- **Trier par ancienneté**, du plus vieux au plus récent. C'est l'ordre dans lequel on
  rattrape un retard.
- **Toujours donner l'identifiant du dossier** à côté du nom : c'est ce qui permet d'agir
  ensuite (`statut <id> "..."`).
- **Proposer l'action suivante.** Après avoir montré un dossier bloqué, proposer la relance.

## Règles communes — elles ne se négocient pas

- **Les statuts d'un dossier établissement sont exactement cinq** : Candidature reçue,
  Candidature acceptée, Établissement engagé, Abandon, Refus. Ne jamais en écrire un autre,
  même si un ancien document en cite d'autres (« Retenu », « Invité », « En discussion »…).
- **Accès à la base : les outils `nocodb_*`** (lire, chercher, créer, modifier des lignes).
  Après toute écriture, relire la ligne. Si le résultat est incertain, ne pas répéter : le dire.
- **Les doublons archivés** : une ligne dont `fusionne_vers` est renseigné est un ancien doublon,
  fusionné dans le dossier vers lequel elle pointe. Ne jamais la compter, ne jamais la modifier :
  travailler sur le dossier cible. Tout comptage ou toute liste ajoute le filtre `fusionne_vers`
  vide. Vérifié le 13/10 : 22 engagés sans ce filtre, 17 avec — le bon chiffre est 17.
- **Avant « Établissement engagé »** : vérifier que la fiche contact est reçue ET la lettre
  d'intérêt signée. Sinon, ne pas écrire et le dire.
- **Ne pas présumer.** Séparer ce que la base dit de ce qu'on en suppose (« là, il théorise »).
- **Ne jamais dire « c'est fait » sans l'avoir relu.**
- **Aucun e-mail n'est envoyé par l'agent.** Il prépare un brouillon, la personne envoie.
- **Les rapprochements incertains ne sont jamais décidés à la place de Charlotte.**

## Affecter un formateur à un dossier d’établissement

Sur ce profil de coordination, Charlotte décide de l’affectation. L’agent peut préparer
la proposition en lecture seule, puis l’enregistrer dans NocoDB après son accord explicite.
Une demande de préparation, une note ou un nom renseigné dans un formulaire ne déclenchent aucune écriture.

1. **Identifier.** Lire le schéma courant, puis vérifier le dossier de participation (référence,
   Id, cohorte, établissement et ville) et la fiche du formateur (nom et Id). Le numéro de
   l’établissement n’est pas celui de sa participation. Refuser un dossier archivé, abandonné
   ou refusé ; en cas d’homonymie, de données contradictoires ou de doute, demander une précision.
2. **Comparer.** Lire toutes les missions du dossier, y compris les inactives. Une mission
   annulée, abandonnée ou refusée ne se réactive pas. Si l’affectation demandée est déjà active,
   vérifier le résultat et ne rien réécrire. En cas de doublon, de mission terminée à modifier,
   d’autre formateur déjà affecté ou de plusieurs missions possibles, s’arrêter : présenter
   ce qui existe à Charlotte, sans remplacer ni délier personne.
3. **Faire valider.** Présenter l’avant/après : dossier, établissement, cohorte, formateur et
   mission à compléter (ou nouvelle mission à créer). Attendre que Charlotte confirme cette
   proposition précise. Maintenir la demande d’autorisation d’écriture de l’outil NocoDB.
4. **Enregistrer.** Relire la participation et les missions juste avant l’écriture. Si l’état a
   changé, reprendre la comparaison. Compléter uniquement le lien formateur de la mission
   active identifiée et vacante ; s’il n’en existe aucune, créer une seule mission reliée à la
   participation et au formateur, selon le schéma. Ne pas créer une mission vide en attendant
   de la relier. Si une valeur métier obligatoire manque, la demander sans l’inventer.
   Ne changer ni référent, ni notes, ni statut du dossier, ni dates, ni convention, ni groupes.
   N’utiliser que le connecteur NocoDB autorisé ; en cas de refus, ne pas contourner l’autorisation.
5. **Vérifier.** Relire la mission (Id, participation, formateur, statut), puis vérifier la
   colonne **Formateur** du [suivi des établissements](https://euneos.fr/etat-candidatures).
   Afficher à Charlotte le résultat pour ce dossier. Si la page n’est pas accessible ou si le nom
   n’y apparaît pas, distinguer « enregistré en base » de « affichage non vérifié ». En cas de
   réponse incertaine à l’écriture, relire avant toute autre action ; ne jamais réessayer à l’aveugle.

## Modifier le site et les pages internes

Elle peut faire modifier le site public et les pages internes (calendriers, tableaux, formulaires) :
compétence `modifier-le-site`. Les règles :
- **Montrer le changement avant de publier** : le texte avant / après, ou ce qui change à l'écran.
- **Compiler et tester** (`bun run test`, `bun run build`) et **vérifier en petite largeur** (le site bascule à 860 px).
- **Publier sur `main` après son « oui »** ; vérifier ensuite que la mise en ligne a réellement abouti.
- **Structure des bases** : suivre la règle « Changer la structure des bases » de `CLAUDE.md`.
