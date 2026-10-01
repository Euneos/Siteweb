# Évaluation finale et bilan établissement : réception métier vérifiée

Deux parcours indépendants : `/suivi/evaluation-formation` (20 questions exactes,
17 obligatoires) et `/suivi/bilan-etablissement` (15 questions exactes, 11
obligatoires). Chacun ajoute une année scolaire obligatoire, autorisée pour les
nouvelles réponses uniquement. Aucun rattachement historique n’en est déduit.

Les types et libellés de la source sont conservés : six questions multiples et
trois listes déroulantes pour l’évaluation ; « Si non, pourquoi ? » obligatoire
sans condition pour le bilan ; échelle 0–10 avec zéro valide. L’option littérale
« Autre : » n’ajoute aucun champ libre non prouvé par le relevé éditeur. La parité
est testée par empreintes du contenu public, sans ID source ni donnée de compte.

## Prérequis d’activation

- Journal et configuration existants : `PUBLIC_FORMS_TABLE`, `NOCODB_TOKEN`,
  `OPERATIONAL_FORMS_ENABLED`, `FORM_SUBMISSIONS`.
- Migration additive `0014_final_questionnaires.sql` dans FORM_SUBMISSIONS :
  plans, dates, résultats et claims durables. Aucune modification des registres
  Google, de leurs clés ni des migrations des autres formulaires.
- Deux colonnes NocoDB **nouvelles**, absentes lors de la lecture de métadonnées
  du 1er octobre : `adultes.date_evaluation_recu` (Date) et
  `participations.date_bilan_etablissement_recu` (Date). Le manifeste préparé
  `migrations/nocodb/questionnaires-fin-receptions.json` décrit ces ajouts ;
  **il n’est pas appliqué automatiquement par la migration D1 et n’a pas été
  appliqué à distance par ce lot**. L’intégrateur doit préparer et vérifier ces
  colonnes avant activation. Aucun renommage ou détournement de date_post_recu.
- Secrets dédiés `EVALUATION_FORMATION_PROJECTION` et
  `BILAN_ETABLISSEMENT_PROJECTION` : tables et mappings confirmés, jamais exposés
  au navigateur. Leur format natif accepte `cohorts[].answers[]` **sans answer**,
  ou `answer` et des aliases additionnels. Les collisions entre cohortes sont
  refusées. Les aliases de noms d’établissement proviennent d’une preuve privée.

Exemple exclusivement fictif de configuration évaluation :

```json
{
  "version": 1,
  "family": "evaluation_formation",
  "tables": {
    "people": "fictionaladults0001",
    "records": "fictionaldossiers01",
    "schools": "fictionalschools001"
  },
  "cohorts": [
    {
      "id": 2,
      "answers": ["2026-2027", "2026 2027"],
      "establishments": [{ "answer": "École fictive", "participationId": 7, "schoolId": 9 }]
    }
  ],
  "receipt": { "field": "date_evaluation_recu", "type": "Date" }
}
```

Pour le bilan, `family` est `bilan_etablissement`, `people` désigne la même table
que `schools`, et receipt.field est `date_bilan_etablissement_recu`. Le seul
champ métier supplémentaire autorisé est `scoreNps: true`, qui demande
explicitement de reporter la recommandation 0–10 vers `participations.score_nps`
(Number). **Le défaut et les configurations privées préparées sont false** :
la présence de la colonne seule n’active jamais le report. Aucun nom de colonne
libre ni changement de statut n’est configurable.

GET et POST refusent avant capture si configuration, registre ou colonne manque,
ou si le type de réception/NPS diffère. La vérification se fait dans les vraies
métadonnées NocoDB, pas seulement sur une déclaration de secret. Hors euneos.fr,
la préversion simule uniquement, même avec secrets présents ; zéro stockage.

## Résolution explicite et écritures limitées

**Évaluation.** Email exact unique parmi email/email_2 des adultes, dossier déclaré
par l’année et l’alias d’établissement privés, puis contrôle de la relation
adulte.participations_id, de la cohorte, de l’établissement et de l’absence de
fusion. L’établissement existe et le dossier de cette année est unique. La source
n’a pas de nom répondant : aucun nom n’est inventé ou injecté dans le planner PR38.
Les noms NocoDB servent uniquement de gardes de stabilité. Seule la date distincte
de réception est écrite sur l’adulte ; aucune création, identité, date B/J45,
réponse pédagogique ou statut « formé » n’est écrit sur cette fiche.

**Bilan établissement.** Email exact unique parmi referent_email, email_direction,
email_institutionnel, email_logistique ; établissement correspondant exactement
au mapping privé de l’alias déclaré ; un seul dossier pour cet établissement et
l’année configurée, non fusionné. Aucune relation à un formateur ou une mission
n’est déduite. Seule sa date de réception est écrite sur la participation.

Une date existante différente est conservée et devient un cas à vérifier. Si NPS
est explicitement activé, une valeur vide peut être remplie ; la même valeur est
conservée. Une valeur différente, y compris zéro, est préservée et affichée comme
report partiel : réception vérifiée, score existant inchangé, avis intégral au
journal. Les autres réponses restent exclusivement au journal.

## Durabilité et catalogue

Source exacte versionnée → réservation de reçu → date serveur figée dans D1 →
journal NocoDB créé et relu exactement → plan figé et claim sur table/ID/champ de
réception → contrôles avant écriture → marqueur writing durable → PATCH ciblé →
relecture et nouvelle vérification d’unicité → résultat D1.

Les états queued/planning/retryable/writing/complete/review reprennent le protocole
pré-A. Seules les lectures/préparations préalables peuvent être rejouées. Un PATCH
incertain n’est jamais réémis ; la reprise relit son plan. Date, configuration et
identité ne changent pas au rejeu. Un changement de mapping mène à une attente
explicite. Un claim incertain n’est ni effacé ni expiré automatiquement.

Le journal reste append-only après capture : pas de PATCH qui écraserait une
annotation Google/humaine. Le catalogue protégé lit les réponses et la preuve D1,
avec date/dossier vérifiés, résultat partiel ou motif d’attente. Le dispatcher
`finalQuestionnairePublicEntry` doit précéder le fallback OperationalInput, comme
ceux de pré-A/B/J45/accord/bilan formateur. Aucun accès public aux réponses. La
réponse publique est uniforme et ne divulgue aucune existence d’identité/dossier.

Les claims sérialisent les réponses de ces deux formulaires. Ils ne constituent
pas un compare-and-swap NocoDB face aux interventions humaines. Un futur Worker
écrivant les mêmes nouvelles dates devra partager ce protocole avant activation.
Les Workers Google actuels ne projettent pas ces nouveaux champs. Aucun email,
changement de statut de formation ou de config globale dans ce lot.

## Recette locale

```sh
bun run test
bun run build
bun scripts/check-final-questionnaires.mjs
bun run test:operational
```

Tests sur vrai SQLite et transports NocoDB simulés : identités/années/dossiers
ambigus, alias natifs de deux cohortes, colonne absente/type erroné, conflits de
dates/NPS, score zéro, source perdue, PATCH perdu, reprise avec date figée,
concurrence, configuration modifiée, annotation concurrente et changement
d’identité pendant l’écriture. Les tests de contenu source restent séparés.

La recette navigateur utilise les vraies pages, APIs et lecteur privé compilés :
14 largeurs, deux réceptions métier relues, reprise après réponse perdue sans
second PATCH, cas pending, score existant préservé, accès non authentifié refusé,
absence de schéma bloquée avant collecte. Données fictives exclusivement.

Le parent peut intégrer ce complément après le commit de préparation. Colonnes,
secrets, migration distante et publication restent des opérations séparées ;
aucune réussite locale n’est présentée comme une soumission réelle en production.
