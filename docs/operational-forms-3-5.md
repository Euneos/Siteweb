# Formulaires 3, 4 et 5 : contrat et migrations

Ce lot prolonge les formulaires directs et reprend la composition du n°5 préparée
sur la PR #26. Il ne modifie pas le Worker de capture Google. Les relevés, réponses,
identifiants et preuves de comparaison restent dans les documents privés, hors Git.

## Contrat des réponses

Les routes sont `/suivi/fiche-contact`, `/suivi/deploiement` et
`/suivi/activites-jeunes`, avec POST JSON sur `/api/suivi/<type>`. Le lien personnel
identifie l’établissement et sa participation à la cohorte active. Ces identités
ne sont pas des champs éditables. Chaque réponse actuelle porte `version: 2`.
Les anciennes réponses sans version gardent leur normalisation et leur empreinte,
pour retrouver les reçus déjà créés lors d’un renvoi identique.

- **3 — contact** : académie/territoire, adresse, code postal, type d’établissement,
  nom et email du référent, email de la direction, regroupement Oui/Non et détail
  facultatif, format Présentiel/Hybride, intention d’évaluation Oui/Non/« Je ne sais
  pas, j’ai besoin de plus d’information », niveau de classe requis seulement si
  Oui, formateur(s) nom/email facultatifs et confirmation. Aucune date, liste
  d’adultes, planning, téléphone ou estimation d’effectif. L’identité de l’école
  est affichée depuis le dossier. Les anciennes valeurs ne sont pas effacées.
- **4 — organisation adultes** : référent, formateurs, dates facultatives par paire,
  modalité, sessions et planning, `preformation` valant exactement Oui, Non ou
  Je vais le faire, deux confirmations. Cette déclaration ne certifie ni le passage
  individuel du questionnaire ni une formation terminée.
- **5 — activités jeunes** : référent, `youth.totalClasses`, `totalStudents`,
  `levels`, choix `evaluation`. Si Oui : descriptions `activeClasses` et
  `controlClasses` requises ; effectifs `activeCount`/`controlCount` et dates
  `activeT1`, `activeT2`, `controlT1` facultatifs. Ateliers facultatifs :
  `workshopCount`, `workshopSchedule`. Deux confirmations. Les effectifs peuvent
  différer ; aucun ratio, égalité ou critère scientifique n’est inféré. La date
  T2 contrôle, absente du questionnaire vérifié, n’est pas ajoutée sans clarification.
  Aucun code anonyme, affectation automatique ou validation scientifique.

Les réponses normalisées complètes sont ajoutées à
`notes → EUNEOS_CONTACT_V1 → operationalSubmissions`, avec reçu, date, type,
champs et motifs de revue. Ni une ancienne réponse ni les notes humaines ne sont
remplacées. Une divergence avec un champ déclaré existant conserve la nouvelle
réponse dans l’historique et demande une revue, sans remplacer ce champ. Les dates
adultes conflictuelles suivent la même règle. La limite de capacité de notes est
contrôlée avant mutation ; elle provoque un refus explicite, jamais une troncature.
Les nouvelles inscriptions adultes restent `Inscrit`, sans promotion « formé ».

## Migration NocoDB — plan prêt, aucune exécution automatique

Le manifeste `migrations/nocodb/operational-forms-3-5.json` ajoute uniquement ces
colonnes à **participations**. Aucune colonne existante, relation, valeur de dossier,
ligne historique ou table d’impact n’est modifiée :

| Colonne | Type NocoDB | Sens |
| --- | --- | --- |
| intention_evaluation_scientifique | SingleLineText | Choix du n°3 |
| niveau_evaluation_envisage | SingleLineText | Niveau proposé si Oui |
| preformation_questionnaire | SingleLineText | Déclaration du n°4 |
| lien_activites_jeunes | URL | Lien individuel privé du n°5 |
| activites_jeunes_recues | Checkbox | Réception projetée sans conflit |
| activites_jeunes_date_reception | DateTime | Première réception projetée |
| activites_jeunes_classes | Number | Classes déclarées, pas impact validé |
| activites_jeunes_effectif | Number | Jeunes déclarés, pas impact validé |
| activites_jeunes_niveaux | SingleLineText | Niveaux déclarés |
| evaluation_jeunes_demandee | SingleLineText | Oui / Non du n°5 |
| evaluation_jeunes_statut | SingleLineText | À examiner / Non demandée initialement |

Colonnes facultatives, sans défaut métier demandé, sans unicité et sans réécriture des
anciens dossiers. Les deux nombres sont des entiers déclarés. Le statut scientifique
existant n’est jamais remplacé. Le statut « À examiner » indique seulement une
proposition, pas une validation.

À partir d’un export privé des métadonnées de la table (objet `title`, `columns`),
préparer le plan **hors ligne**, sans secret ni appel réseau :

```sh
bun scripts/plan-operational-schema.mjs /chemin/prive/metadonnees-participations.json
```

Le résultat contient `addColumns` et les colonnes déjà compatibles. Une collision
de nom, un mauvais type, un champ requis, une valeur par défaut ou une unicité
inattendue bloque le plan. Seule exception : NocoDB peut ajouter son défaut natif
faux à la nouvelle case `activites_jeunes_recues` ; `false`, `"false"`, `0` et
`"0"` sont compatibles à la relecture. La requête n’impose aucun défaut et aucune
case existante n’est modifiée. Un défaut vrai reste refusé. Le plan ne propose
jamais de modifier un champ incompatible.
L’opérateur résout la table dans sa configuration privée, applique seulement les
créations après revue et relit les métadonnées. Une seconde exécution sur cette
relecture doit produire `addColumns: []`. Ce script n’a pas de mode d’application.

## Migration D1 — FORM_SUBMISSIONS exclusivement

Ajouter `0006_operational_activities.sql` au registre existant de
**FORM_SUBMISSIONS**. `0005` appartient au raccord Google ; ne pas modifier ni
rejouer 0001–0005. Aucun changement de `TEAM_WORKSPACE` ni de son workflow.

La migration élargit les contraintes CHECK des trois tables de liens, slots et
soumissions. SQLite impose une copie/reconstruction des tables pour cette
extension : l’application doit être transactionnelle. Tous les anciens champs,
jetons hachés, empreintes, reçus, états et timestamps sont copiés tels quels ;
les tables de verrous et d’accusés sont laissées intactes. Le test de migration
vérifie leur conservation, y compris un reçu incertain avec verrou, l’unicité et
l’intégrité SQL. Le runner D1 reste responsable du registre et de la transaction.
Ne pas appliquer l’historique sur une base dont le registre n’est pas vérifié.

Si des tables historiques existent sans leurs entrées dans le registre, comparer
leur schéma complet aux migrations attendues et adopter seulement les entrées
manquantes après vérification, sans rejouer les créations. Conserver une preuve
de récupération et comparer les données avant/après. La configuration actuelle
utilise la même base FORM_SUBMISSIONS pour preview et production : une migration
sur ce binding n’est donc pas une recette isolée. Les essais de démonstration du
site restent sans accès à cette base.

## Activation et catalogue

Avant toute publication, faire relire les deux plans, appliquer et vérifier les
migrations sur les bases autorisées, puis vérifier les liens et parcours. Les
formulaires 3/4 actuels émettent les nouveaux champs dès publication : leur schéma
NocoDB doit donc être prêt avant le déploiement du site. Le n°5 est en plus fermé
par `OPERATIONAL_YOUTH_ENABLED=false` ; son ouverture explicite requiert `true` et
le circuit existant `OPERATIONAL_FORMS_ENABLED=true`.

Le catalogue interne n’est pas modifié par ce lot. L’API `/api/interne/formulaires`
renvoie `kinds` avec les types activés ; le script partagé construit le sélecteur
avec cette liste. Le type nouveau est `activites-jeunes`, sa colonne est
`lien_activites_jeunes`. L’aperçu utilisable est `/suivi/activites-jeunes?t=demo`
sur un domaine de preview uniquement. Les essais n’écrivent ni dans NocoDB ni
D1 et n’envoient aucun email. Les créations de liens n’envoient jamais d’email.
Le circuit d’accusé existant reste réservé aux réceptions de production confirmées,
une seule tentative par lien, aucun renvoi sur replay ou réception à vérifier.

Aucun merge, déploiement, écriture de schéma ou de données de production n’est
réalisé par la préparation de ce lot. Les migrations des formulaires ne sont pas
prises en charge par le workflow des calendriers internes.

## Recette locale du lot

748 tests, compilation Astro, parcours compilés des quatre types (40 contrôles
de pages/largeurs), mise en page, espacements et audit responsive (260 dispositions)
passent. Les captures mobile et ordinateur ont été relues. Les tests de migration
incluent les reçus incertains et leurs verrous ; ceux des parcours utilisent des
réponses fictives et des transports simulés. La CI et sa preview peuvent compléter
cette recette avant toute décision de publication en production.
