# Questionnaires B et J+45 — site vers réception adulte

Les deux formulaires publics utilisent le journal de réponses et les primitives
de rapprochement de la préformation. Ils ne modifient pas le Worker Google et
n’envoient aucun e-mail.

## Formulaires reproduits

| Lien générique          | Source relue                                         | Questions | Obligatoires | Seule projection permise  |
| ----------------------- | ---------------------------------------------------- | --------: | -----------: | ------------------------- |
| `/suivi/post-formation` | WISE-UP — B. Questionnaire post formation stagiaires |        21 |           17 | `adultes.date_post_recu`  |
| `/suivi/suivi-j45`      | WISE-UP — C. Questionnaire suivi adultes formés J+45 |        21 |           15 | `adultes.date_suivi_recu` |

`postformation-definition.ts` reprend les textes, descriptions, sections, choix et
obligations de la lecture rendue du 1er octobre 2026. Les sources et preuves DOM
restent dans l’inventaire privé `definitions-six-20261001`. Aucun identifiant Google,
compte affiché ou réponse réelle n’est inclus. Les deux questions « Quel(s)
élément(s)… » restent des choix **uniques**, dont « Autre : » avec précision libre.
La question J45 sur les contenus de l’application reste à choix **multiples**.
Aucun embranchement non observé n’est inventé ; les questions obligatoires restent
visibles même si une réponse précédente dit « Non ».

Une saisie d’email valide et une année `AAAA-AAAA` consécutive sont demandées pour
rendre le rapprochement exploitable ; ce sont les contraintes explicites du site,
pas une affirmation sur des validations cachées de Google. Les libellés source ne
sont pas réécrits. Les réponses facultatives peuvent rester vides.

## Journal puis rapprochement

1. Validation stricte serveur (champs inconnus refusés, options exactes, tableaux
   contrôlés, texte libre borné) et contrôles existants d’origine/rate limit.
2. Empreinte stable des réponses canonisées, séparée par version/famille. La date
   de réception est figée au premier dépôt. Les choix multiples sont ordonnés
   selon leur définition : changer leur ordre ne crée pas une autre réponse.
3. Conservation du questionnaire complet dans le journal NocoDB privé, puis
   relecture exacte. Aucun changement adulte si cette preuve manque. Après une
   réponse réseau perdue, le navigateur renvoie le même corps ; le serveur relit
   le journal avant toute suite, sans répéter un POST incertain.
4. `planGooglePerson` vérifie nom + email exacts, unicité, cohorte déclarée et
   établissement via les correspondances privées, puis la relation réelle de
   l’adulte au dossier non fusionné. Aucune personne n’est créée.
5. Un plan local autorise uniquement la date de réception correspondant au
   questionnaire, calculée en Europe/Paris. Le champ doit exister dans la réponse
   NocoDB. Toute ancienne date différente est conservée et le cas reste à vérifier.
6. Plan et configuration figés, propriétaire avec jeton et état d’écriture durables
   dans D1. Un claim par adulte/champ sérialise les réponses du site. L’identité,
   les relations et la valeur sont relues avant PATCH, puis après PATCH. Une
   écriture incertaine n’est jamais rejouée ; seule une lecture peut la confirmer.

**Aucun statut « Formé », date de formation, réponse pédagogique ni autre champ
adulte n’est écrit.** Un questionnaire déposé ne prouve pas que la personne a suivi
la formation. Une nouvelle réponse corrigée est conservée séparément au journal,
sans écraser les réponses ni une ancienne date métier.

Une identité ambiguë donne un accusé public identique à un dépôt rapproché. Les
motifs, références et détails sont accessibles uniquement à l’équipe dans la liste
interne. `postformationPublicEntry` prend en charge les tableaux de choix et les
libellés enregistrés. Le raccordement à `listPublicForms` est limité à un import et
un retour anticipé, compatible avec pré-A. Aucun endpoint public de lecture des
réponses n’est ajouté. Aucun PATCH du journal : les notes humaines et annotations Google restent intactes.

## Activation

- Migration additive `migrations/0011_postformation_projection.sql` sur
  `FORM_SUBMISSIONS`, après la 0010 pré-A, selon le circuit de la base des formulaires. Aucun changement de schéma NocoDB (les deux champs Date existent
  dans les métadonnées privées relues localement).
- Configuration serveur privée dédiée `POST_FORMATION_PERSON_PROJECTION` et
  `SUIVI_J45_PERSON_PROJECTION`, ou famille unique correspondante dans `SOURCES`,
  `SOURCES_2`…`SOURCES_12` contigus. Structure `PersonProjectionConfig` PR38 auditée,
  famille `postformation_b` ou `suivi_j45`, tables/cohortes/établissements confirmés.
  Pas de création d’adultes ; pas de cohorte implicite. Les mappings Google servent
  à valider la configuration source, les sélecteurs du site sont ceux de sa version.
- Sans configuration valide, journal ou tables techniques : GET/POST indisponibles
  (503), pas de collecte brute prétendant avoir mis à jour un adulte.
- Le catalogue interne expose les deux liens génériques ci-dessus aux étapes B
  et C. Les réponses apparaissent dans la liste privée, avec celles des autres
  questionnaires.
- Les formulaires ne préremplissent aucun dossier depuis l’URL et ne publient pas
  d’annuaire. Aucun lien personnel, compte répondant ou e-mail automatique requis.

## Limites explicites

La confirmation d’identité est un rapprochement exact avec les relations connues,
pas une authentification de la personne ni une preuve de possession de l’email.
Les orthographes/années non configurées vont à l’équipe, jamais vers un rapprochement
approximatif. J+45 n’est pas une minuterie ni une relance : c’est le questionnaire
accessible par son lien, sans calcul de date de formation supposée.

Les claims de date sérialisent les deux routes **du site**. NocoDB ne fournit pas
ici de PATCH conditionnel atomique ; une modification humaine ou Google entre la
dernière lecture et le PATCH reste une limite, comme dans pré-A. Aucun verrou
universel partagé avec tous les clients NocoDB n’est revendiqué. Une date différente
observée est conservée. Les cas privés en attente nécessitent une vérification
équipe, sans reprise métier aveugle depuis une page publique.

Les validations locales utilisent uniquement SQLite en mémoire et NocoDB simulé,
pas les secrets ni les données de production. Les questionnaires exacts ont été
comparés à nouveau aux définitions privées après génération.

## Vérifications

```sh
bun test tests/postformation.test.ts
bun run test
bun run build
bun scripts/check-postformation.mjs
```

La recette compilée couvre sept largeurs par formulaire (320, 390, 768, 860, 861,
1024, 1440), obligations, Autre, choix multiples, dépôt, retour réseau perdu,
conservation du même envoi, réception adulte, cas ambigu, liste privée mixte
pré-A/B/J45, échappement HTML, accès non authentifié refusé et absence de configuration.
Les captures et le rapport restent hors dépôt ; `CHECK_SCREENSHOTS` choisit le dossier.
