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

## Modifier le site et les pages internes

Elle peut faire modifier le site public et les pages internes (calendriers, tableaux, formulaires) :
compétence `modifier-le-site`. Les règles :
- **Montrer le changement avant de publier** : le texte avant / après, ou ce qui change à l'écran.
- **Compiler et tester** (`bun run test`, `bun run build`) et **vérifier en petite largeur** (le site bascule à 860 px).
- **Publier sur `main` après son « oui »** ; vérifier ensuite que la mise en ligne a réellement abouti.
- **Structure des bases** : suivre la règle « Changer la structure des bases » de `CLAUDE.md`.
