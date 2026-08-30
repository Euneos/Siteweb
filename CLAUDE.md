# EUNEOS — contexte de travail

Ce fichier est lu automatiquement par l'agent au démarrage. Il lui dit qui vous êtes,
où sont vos données, et ce qu'il a le droit de faire.

Vous pouvez le modifier : c'est votre mode d'emploi, pas le sien.

---

## Qui vous êtes

**EUNEOS** — association loi 1901 d'intérêt général, fondée en avril 2026, basée à Toulouse.
Mission : prévenir les difficultés de santé mentale des jeunes en milieu éducatif et les
accompagner dans leur rapport au numérique.

**Le Programme WISE-UP** est le programme phare : 16 h de formation pour les équipes
éducatives, puis 4 à 8 ateliers avec les élèves sur l'année scolaire, avec une évaluation
scientifique. Programme européen Erasmus+ 2025-2027, 100 % financé par le fonds de dotation
Nouveau Monde. Aucun frais pour l'établissement.

**L'objectif de l'année : 30 établissements engagés pour 2026-2027.**

### L'équipe

| | |
|---|---|
| **Candice Marro** | Fondatrice — direction, partenariats, représentation |
| **Charlotte Térouanne** | Coordination et développement — suivi des établissements |
| **Pauline Miqueu-Petit** | Communication — textes, réseaux, newsletter |

---

## Où sont les choses

| Quoi | Où |
|---|---|
| **La base de données** | NocoDB — `app.nocodb.com`, base *EUNEOS - WISE-UP* |
| **Le site** | `euneos.fr` — le code est dans ce dossier |
| **Le code en ligne** | `github.com/Euneos/Siteweb` |
| **Les mails** | Viaduc (inchangé) — `webmail.viaduc.fr` |

La base contient 18 tables : établissements, participations, formateurs, engagements,
missions, adultes formés, groupes d'élèves, sessions, présences, et les modèles d'e-mails.

**Deux notions à ne pas confondre**, parce que toute la base repose dessus :

- un **établissement** est une école, une fois pour toutes ;
- une **participation** est cette école **dans une cohorte donnée**.

Une école qui revient l'année suivante n'est pas un doublon : c'est une seconde
participation. Même logique côté formateurs : une **personne**, et ses **engagements**.

---

## Ce que l'agent peut faire aujourd'hui

### Consulter et faire avancer les dossiers

```
bun scripts/base.mjs campagne            où en est le recrutement
bun scripts/base.mjs candidatures        les candidatures établissements
bun scripts/base.mjs formateurs          les candidatures formateurs
bun scripts/base.mjs dormants [jours]    les dossiers qui n'avancent plus
bun scripts/base.mjs etablissement <id>  la fiche complète d'un dossier
bun scripts/base.mjs statut <id> "..."   faire avancer un dossier
bun scripts/base.mjs modeles             les 16 modèles d'e-mails
bun scripts/base.mjs modele <code>       lire un modèle en entier
```

### Cinq compétences installées

L'agent les déclenche tout seul selon ce que vous demandez :

| | |
|---|---|
| **point-de-campagne** | où en est le recrutement des 30 établissements |
| **traiter-une-candidature** | consulter un dossier, le faire avancer |
| **relancer-un-dossier** | trouver ce qui dort, préparer la relance |
| **preparer-un-email** | rédiger à partir des 16 modèles officiels |
| **modifier-le-site** | changer un texte, une photo, puis publier |

Elles sont dans `.claude/skills/`. Ce sont des fichiers texte : vous pouvez les lire, les
corriger, en ajouter.

Vous n'avez pas à retenir ces commandes : demandez à l'agent en français.
*« Où en est la campagne ? »*, *« Montre-moi les candidatures pas encore traitées »*,
*« Passe le collège Vauban en accusé de réception »*.

### Modifier le site

Décrivez le changement, l'agent s'occupe du reste : *« Sur la page Bienvenue, remplace la
photo du haut par celle qui est sur mon bureau »*, *« Change le texte du bloc Programme
par ceci : … »*.

Le site se met en ligne **tout seul** après chaque modification — comptez deux à trois
minutes. Vérifiez toujours le résultat sur `euneos.fr`, et sur votre téléphone : un site
ne rend jamais tout à fait pareil sur petit écran.

Les règles graphiques (couleurs, typographie, pliures, silhouettes) sont dans `AGENTS.md`
et sur la page `euneos.fr/style-guide`. Si vous voulez changer une règle, modifiez ces
documents : l'agent les suivra.

---

## Règles de conduite

**1. Seul l'accusé de réception est automatique.**
Une candidature enregistrée déclenche un accusé Brevo, conformément à la décision du 27/08.
L'étude du dossier et toutes les réponses qui font avancer son statut restent humaines.

**2. Les données personnelles ne sortent pas de la base.**
Les fiches contiennent des enseignants, des formateurs et des élèves. Elles ne se copient
pas dans un document partagé, un mail groupé ou un outil externe sans raison explicite.

**3. En cas de doute sur une suppression, demander.**
Rien ne se supprime dans la base sans validation d'une personne.

**4. Toujours dire ce qui a été fait.**
Après une action, l'agent doit lister ce qu'il a modifié — quel dossier, quel statut, quelle
page. Si ce n'est pas dit, c'est que ce n'est pas fait.

---

**6. Ne jamais presenter une deduction comme un fait.**
Le 27/08, l'agent a annonce que sept etablissements avaient recandidate « parce que
personne ne leur avait repondu ». Le fait etait verifie (meme etablissement, deux
candidatures, deux dates). **La cause etait inventee** — la base ne dit rien des
raisons. Candice l'a releve tout de suite : *« la, il theorise »*.

La regle : separer visiblement les deux.

- **Ce que la base dit** : « le college Vauban a deux candidatures, du 9 janvier et
  du 20 mai, rattachees a la meme fiche etablissement. »
- **Ce qu'on peut en supposer** : « une hypothese possible : ils n'ont pas eu de
  reponse. Je ne peux pas le verifier — l'agent n'a pas acces aux echanges. »

Quand une explication manque, **poser la question plutot que de la combler**.
Une equipe qui decouvre une invention une fois cesse de faire confiance au reste,
y compris a ce qui etait juste.

## Ce que l'agent NE peut PAS encore faire

À dire clairement plutôt que de laisser croire le contraire :

- **Envoyer un e-mail.** Les 16 modèles sont dans la base, mais rien ne les envoie encore.
  Les envois passent toujours par l'ancien système.
- **Relancer automatiquement.** La table existe, le déclencheur non.
- **Vous prévenir d'une nouvelle candidature.** Elle arrive en base sans notification.
- **Générer les codes anonymes des élèves** ni piloter les questionnaires avant/après.
- **Toucher aux cohortes en cours** (missions, formations, groupes) : ces données sont dans
  la base mais la mécanique qui les fait tourner vit encore dans l'ancien système Google.

---

## Si quelque chose ne va pas

- **Le site affiche une erreur** → dites-le à l'agent, il regarde le dernier déploiement.
- **La base est injoignable** → il manque probablement le fichier `.env` (voir
  `.env.example`). Le jeton est fourni par Charly.
- **Un dossier a disparu** → rien n'est supprimé automatiquement. Cherchez d'abord sous un
  autre statut : `bun scripts/base.mjs candidatures`.

Pour tout le reste : Charly.
