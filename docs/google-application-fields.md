# Projection métier Google : candidatures et suivi J45

Extension additive de `Source.personProjection`, sans changement de version des
sources ou des snapshots. Les anciennes configurations sans `businessFields`
restent `linkOnly` pour ces familles. Le parent peut préparer sa configuration V1
sans les activer, puis ajouter cette section une fois le code déployé et relu.

## Contrat privé pour Hubble / parent

```json
{
  "family": "candidature_formateur",
  "businessFields": {
    "version": 1,
    "fields": [
      { "field": "motivation", "type": "text", "header": "Intitulé exact audité" },
      {
        "field": "accord_principe",
        "type": "choice",
        "header": "Accord de principe",
        "options": [
          { "source": "Oui", "value": "Oui" },
          { "source": "Non", "value": "Non" }
        ]
      },
      {
        "field": "consentement",
        "type": "consent",
        "header": "Confirmation",
        "options": [{ "source": "Oui, je confirme", "value": true }]
      },
      {
        "field": "experience_animation",
        "type": "multiChoice",
        "header": "Expériences",
        "separator": ", ",
        "options": [
          { "source": "Oui, auprès d'adultes", "value": "Oui, auprès d'adultes" },
          { "source": "Oui, auprès d'élèves", "value": "Oui, auprès d'élèves" }
        ]
      }
    ]
  }
}
```

Ceci est un **fragment**, pas une configuration déployable : conserver les tables,
cohortes, selectors d’identité et `headerDigest` audités de la source. Les libellés
ci-dessus sont illustratifs ; ne pas les substituer aux vrais en-têtes privés.

Chaque `header` est un `SheetHeader` existant : chaîne exacte ou
`{ "label": "Question", "occurrence": 2, "column": 18 }`. Une question dupliquée
exige l’occurrence et la colonne absolue. Le digest couvre l’ordre et tous les
libellés. Retirer de `captureOnly` les colonnes désormais couvertes par
`businessFields` : une colonne consommée deux fois est refusée. Toutes les autres
questions doivent rester explicitement dans `mapping` ou `captureOnly`.

Les choix requièrent une correspondance `source` → `value` explicite. La cible doit
être une valeur canonique de l’API du site ; aucun autre choix n’est créé dans
NocoDB. Un libellé inconnu n’est pas converti par approximation. Pour plusieurs
choix, `separator` décrit le séparateur Google audité (`, `, `; `, `·` ou saut de
ligne). Le parseur reconnaît les libellés entiers, y compris leurs virgules : pas
de découpage aveugle. Une ambiguïté ou un doublon reste à vérifier. Le stockage
rejoint celui des APIs : `enjeux` avec `,`, `experience_animation` avec `·`.

J45, après vérification de l’adulte, de l’établissement et de la cohorte :

```json
{
  "family": "suivi_j45",
  "businessFields": {
    "version": 1,
    "fields": [{ "field": "date_suivi_recu", "type": "submissionDate" }]
  }
}
```

La date est celle du dépôt Google vérifié, en Europe/Paris. Elle ne provient pas
d’un champ libre, de l’heure du rattrapage ni d’une date choisie dans la fiche.
Pas de `header` supplémentaire : l’horodateur est déjà audité par `mapping.timestamp`.
Une date J45 existante différente reste inchangée et produit une revue.

## Allowlist exhaustive

Source canonique du contrat typé : `APPLICATION_FIELD_RULES` dans
`src/lib/google-form-application.ts`. Types fixes, non modifiables dans le JSON.

| Famille                   | Type           | Champs                                                                                                                                                                                                                       |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidature établissement | multiChoice    | enjeux                                                                                                                                                                                                                       |
| Candidature établissement | choice         | besoin_partage, nb_professionnels, faisabilite, point_vigilance, accord_direction, demarrage_souhaite                                                                                                                        |
| Candidature établissement | url            | document_lien                                                                                                                                                                                                                |
| Candidature établissement | text           | contrainte_calendrier, apporteur_nom                                                                                                                                                                                         |
| Candidature établissement | consent        | consentement                                                                                                                                                                                                                 |
| Candidature formateur     | multiChoice    | experience_animation                                                                                                                                                                                                         |
| Candidature formateur     | choice         | formation_instructeur, disponible_2026_27, etab_pressenti, etab_pressenti_type, accord_principe                                                                                                                              |
| Candidature formateur     | text           | pratique_personnelle, annees_experience, interventions_animees, motivation, etab_pressenti_nom, etab_pressenti_adresse, etab_pressenti_ville, etab_pressenti_cp, etab_pressenti_academie, direction_nom, contexte_complement |
| Candidature formateur     | consent        | consentement                                                                                                                                                                                                                 |
| Suivi J45                 | submissionDate | date_suivi_recu                                                                                                                                                                                                              |

Les champs de candidature sont uniquement ceux de l’objet `application` des APIs
publiques, moins `statut`, `date_candidature` et les emails. Aucun champ d’identité,
relation, code technique, indicateur d’envoi, statut, email ou date de candidature
n’est autorisé. Les autres familles conservent leur traitement existant : aucun
mapping de bilan ou d’évaluation n’est inventé.

## Préservation, conflits et reprise

- Seuls `null`, `undefined` et la chaîne vide sont des champs vides. `false`, `0`,
  un espace et toute autre valeur non vide restent inchangés.
- Une valeur identique est reconnue comme déjà satisfaite. Une valeur différente
  ne se remplace jamais. S’il existe d’autres champs valides vides, leur plan est
  partiel (`remaining: true`) ; sinon l’issue est `review`.
- Une valeur source invalide est conservée dans le journal brut ; aucun défaut,
  raccourcissement, conversion booléenne ou date inventée ne la remplace.
- Le consentement ne peut devenir vrai qu’avec le choix explicitement audité et
  un champ destination vide. Un `false` existant nécessite une décision humaine.
- `before`, `after`, `guard`, `remaining` et `linkOnly` gardent le contrat du Worker.
  Le plan cible une seule table/ligne et n’ajoute aucune écriture annexe. Les
  valeurs en conflit deviennent des gardes supplémentaires, pas des PATCH.
- Le registre durable, le gel du digest de configuration, le contrôle juste avant
  PATCH, la vérification après écriture et la gestion des réponses perdues sont
  inchangés. Modifier la configuration pendant une reprise figée déclenche
  `projection_configuration_changed` ; ne pas tenter de la forcer.
- Aucun message, email, nouvel accusé ni changement de statut métier n’est déclenché.

Le seuil de coupure et `projectionFirstRow` du collecteur restent applicables :
ajouter cette configuration ne rejoue pas automatiquement les anciennes réponses
ni celles déjà terminées. Le rattrapage historique reste le lot vérifié du parent.

## Vérification

`bun test tests/google-form-application.test.ts tests/google-transition-worker.test.ts`
vérifie champs autorisés, choix, dates, sources dupliquées, conflits, identités,
relecture d’un plan gelé et reprise réelle du Worker simulé après réponse perdue.
`bun run build` vérifie aussi le typage Astro. Aucun test n’utilise NocoDB réel.
