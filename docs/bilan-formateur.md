# Bilan formateur — questionnaire public et report prudent

## Livré

- `/suivi/bilan-formateur`, lien public commun dans le catalogue interne.
- `POST /api/questionnaires/bilan-formateur`, transport JSON/version, origine, limites, rate limit, capture durable et reprise.
- Les **28 questions** de la source Google rendue le 1 octobre 2026, dont **16 obligatoires**, avec libellés, descriptions et choix exacts. L’année était déjà une question de la source : aucune année, date ni réponse préremplie. La dernière question conserve son type cases à cocher et ses deux choix originaux. Une déclaration de contrat signé ne signe ni ne valide le contrat dans la base.
- Réponse intégrale au journal NocoDB et dans le registre D1. L’API catalogue équipe existante restitue les 28 réponses et le résultat du report via `bilanCatalogueEntry`, avant le parseur des formulaires opérationnels. Pas de lecture publique des réponses.
- Appariement exact d’un formateur (email et nom), d’une année configurée et d’un dossier établissement, puis **d’une seule mission** liée à ce dossier et ce formateur. Inventaires bornés et explicitement complets ; absence/ambiguïté/relation différente = réponse conservée, `review`, aucun report.
- Les dates sont celles saisies par le répondant, validées (format/date réelle, ordre et années calendaires comprises dans l’année scolaire déclarée). Elles ne viennent ni de la date de réception, ni d’un statut ni d’une année active inférée.

## Contrat privé de configuration

Migration additive `migrations/0013_bilan_formateur.sql` dans **FORM_SUBMISSIONS** (après 0009), indépendante de 0010/0011/0012. Pas dans TEAM_WORKSPACE. Préparer les secrets/colonnes et appliquer le circuit de la base des formulaires avant activation. GET et POST renvoient 503 si configuration ou registre absent.

Bindings existants : `FORM_SUBMISSIONS`, `NOCODB_TOKEN`, `PUBLIC_FORMS_TABLE`, `OPERATIONAL_FORMS_ENABLED=true`.

Nouvelle variable serveur `BILAN_FORMATEUR_PROJECTION`, objet JSON :

```json
{
  "version": 1,
  "family": "bilan_formateur",
  "tables": {
    "people": "fictiontrainerstable",
    "records": "fictiondossierstable",
    "missions": "fictionmissionstable"
  },
  "cohorts": [{
    "id": 1,
    "answer": "2026-2027",
    "establishments": [{
      "answer": "École fictive",
      "participationId": 31,
      "schoolId": 41
    }]
  }],
  "receipt": { "field": "bilan_recu", "type": "Checkbox", "value": true },
  "fields": [
    { "source": "start", "field": "date_debut", "type": "Date" },
    { "source": "end", "field": "date_fin_reelle", "type": "Date" },
    { "source": "adultCount", "field": "nb_adultes_formes", "type": "Number" },
    { "source": "datesRespected", "field": "dates_respectees", "type": "SingleLineText" },
    { "source": "difficulty", "field": "difficulte", "type": "SingleLineText" }
  ]
}
```

Toutes les valeurs d’identité ci-dessus sont **fictives**. Le parent reprend les tables et mappings année/établissement/dossier issus de l’audit privé ; ne pas publier ces mappings. `records` désigne ici les **participations établissements**, pas les parcours formateurs. Pour cette raison, le `personProjection` Google historique de famille `bilan_formateur` n’est pas utilisé implicitement : il permettait un lien vers un parcours formateur, pas une preuve de mission. Les mêmes mappings audités de cohortes/établissements peuvent être repris explicitement dans ce contrat.

Les cinq colonnes/types de `fields` ont été confrontés à la métadonnée missions privée du 1 octobre. Un sous-ensemble est possible ; `[]` limite le report au seul accusé métier `bilan_recu`. Le mapping `receipt` est obligatoire et n’autorise que la colonne Checkbox `bilan_recu` à la valeur true. Toute colonne inconnue, type erroné, doublon ou année ambiguë bloque la configuration. Étendre la liste nécessite nouvel audit et tests, jamais un nom de colonne libre donné par le répondant.

## Préservation et preuve

Pour chaque champ autorisé :

- `null`, absence ou chaîne vide : valeur littérale de la réponse proposée ; nombre entier converti pour la colonne Number.
- Valeur déjà égale : relecture et preuve seulement, pas de réécriture.
- Toute autre valeur, **y compris false, 0 et une date plus récente** : conservée. `nonempty_conflict:<colonne>` reste dans le plan/audit et le catalogue ; les autres champs vides sûrs peuvent être complétés.

Après mission unique, source complète relue et plan contrôlé, `bilan_recu` passe de false/null à true et doit être relu pour prouver l’accusé métier. Une case déjà true est conservée sans réécriture. Tout état ambigu ou type de case inattendu reste à vérifier sans cocher. Ceci ne valide ni formation ni mission. Aucun changement de `statut`, `convention_signee`, identité, lien, année, facture ni autre colonne. Les liens de factures/présences/photos, montants, souhaits et récits sont conservés intégralement sans les attribuer à une colonne métier non auditée. Aucune fin/validation de mission ne se déduit du questionnaire.

Le protocole durable est celui du lot accord/pré-A : payload + date de réception figés, POST unique du journal avec relecture, plan sauvegardé, claim par mission, lease de préparation et propriétaire SQL vérifié avant PATCH, relecture des identités/relations/valeurs et de l’unicité. Après `writing`, seule une relecture peut réconcilier le résultat : jamais de répétition aveugle du PATCH. Un autre payload ne reprend pas le claim d’une opération incertaine. **Aucun PATCH du journal** : les annotations/imports concurrents restent intacts ; aucun enum de `statut_reprise` supposé.

La preuve `complete/mission_fields_verified` est limitée aux champs de `fields_json` relus à cet instant. Le catalogue dit toujours **« Bilan — report partiel vérifié »**, jamais « toutes les données intégrées ». Si aucun champ n’est reporté, il indique « mission identifiée, sans report ». Les conflits sont affichés. `participationId` est le dossier établissement réellement vérifié, distinct de `mission_id` et `trainer_id`.

Comme pour les autres runners, NocoDB ne fournit pas de CAS : une intervention manuelle entre prélecture et PATCH ne peut être verrouillée par D1. Les appels concurrents de ce formulaire sont sérialisés. Si un futur Worker projette lui aussi des bilans vers les missions, il devra reprendre le même claim/protocole avant activation ; le `linkOnly` historique n’écrit pas ces champs. Une correction manuelle d’un claim nécessite une vérification, jamais une purge automatique.

## Tests et livraison

- `bun test tests/bilan-formateur.test.ts` : source exacte, obligatoire/facultatif/cases multiples, identité/année/dossier/mission, conflits, types, dates, zéro/false, concurrence, replay, réponse perdue, catalogue, aperçu et auth d’origine.
- `bun run build` puis `bun scripts/check-bilan-formateur.mjs` : **site et API compilés**, SQLite mémoire, NocoDB/JWT fictifs ; aucune configuration ni secret réel chargé. Rendu 320/390/768/860/861/1024/1440 px, 28 libellés, aucune présélection, reprise d’un PATCH enregistré dont la relecture a échoué, une seule écriture, catalogue privé et indisponibilité sans configuration.
- Captures et preuve `/tmp/euneos-bilan-qa/result.json` par défaut. Tous les transports extérieurs sont simulés ; aucune donnée NocoDB réelle, aucun email, aucun déploiement.

Le parent conserve les dispatchers accord/pré-A/B/J45 lors de l’intégration des quelques lignes communes de `public-forms.ts` et des cartes de `FormCatalog.astro`.
