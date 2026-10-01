# Évaluation finale et bilan établissement : préparation, sans ouverture de collecte

Les définitions exactes relues le 1er octobre 2026 sont préparées séparément :

| Parcours | Questions source | Obligatoires source | Ajout autorisé pour le site |
|---|---:|---:|---|
| `/suivi/evaluation-formation` | 20 | 17 | Année scolaire obligatoire |
| `/suivi/bilan-etablissement` | 15 | 11 | Année scolaire obligatoire |

Ce lot livre la parité des libellés, options, types, obligations, sections et bornes
d’échelles, leur validation serveur et leur rendu en préversion. L’année est une
question **nouvelle**, explicitement autorisée pour les prochaines réponses : elle
ne permet aucune inférence sur une réponse Google historique.

**Ce lot ne livre pas la réception métier. Les deux pages et endpoints renvoient
503 sur euneos.fr/www.euneos.fr, avant toute collecte, quels que soient les secrets
présents.** Aucun interrupteur de configuration ne peut les ouvrir. Hors production,
le parcours est une simulation explicite qui ne lit ni n’écrit aucune base et ne
contacte aucun transport externe. Aucun lien n’est ajouté au catalogue public ou
privé. Ne pas annoncer ces formulaires en ligne ni les confondre avec B/J45.

## Particularités conservées

- Évaluation : six questions à cases à cocher multiples, même lorsqu’elles
  ressemblent à une échelle verbale ; trois listes déroulantes obligatoires.
- L’évaluation n’a pas de question de nom répondant. Ne pas remplir un champ nom
  virtuel depuis NocoDB pour satisfaire artificiellement le planner PR38.
- Bilan : « Si non, pourquoi ? » reste obligatoire pour toutes les réponses ;
  aucune condition cachée n’est inventée. L’échelle de recommandation contient 0.
- L’option littérale « Autre : » de l’évaluation reste un choix. Le relevé éditeur
  fourni ne prouve pas un champ libre associé ; aucun champ supplémentaire n’est
  déduit de sa ponctuation.
- Champs email rendus comme email, limites de taille techniques, année consécutive
  et rejet des clés/options inconnues. Les autres types restent ceux observés.
  Les échelles numériques gardent leurs bornes verbales lorsqu’elles existent.
- Les textes personnels des répondants, identifiants de sources et preuves DOM
  privées ne sont pas dans le dépôt. Les deux empreintes de parité portent
  exclusivement sur le contenu public des questions.

## Contrat de projection à compléter avant une ouverture

Le snapshot privé du 1er octobre comporte `date_pre_recu`, `date_post_recu` et
`date_suivi_recu` sur adultes, mais aucun champ de réception propre à l’évaluation
finale. Les participations comportent `score_nps`, mais aucun marqueur distinct de
réception du bilan établissement identifié dans ce snapshot. L’existence d’une
colonne ne prouve ni son mapping à ce questionnaire ni son autorisation d’écriture.
Aucune nouvelle colonne NocoDB ni migration n’est appliquée ou présumée ici.

| Étape | Évaluation finale | Bilan établissement |
|---|---|---|
| Source publique | Les 20 questions exactes + année nouvelle | Les 15 questions exactes + année nouvelle |
| Identité à vérifier | Email exact unique dans adultes, établissement déclaré et année explicitement mappés dans la configuration privée ; aucun nom inventé | Email égal à un champ contact autorisé d’un établissement unique, nom établissement exact ; année déclarée correspondant à un dossier actif unique |
| Relations | adulte.participations_id = dossier confirmé ; établissement/cohorte conformes ; dossier non fusionné | établissement confirmé + cohorte explicite ; un seul dossier non fusionné ; aucun choix par campagne active |
| Réception ciblée | Champ propre à l’évaluation à définir/auditer. **Jamais date_post_recu**, réservé à B | Champ(s) de réception du bilan à définir/auditer. Ne pas utiliser fiche_contact_recue ni statut_formation |
| Autres champs | Questionnaire complet au journal ; aucune note ou statut formé | Mapping éventuel de la question de recommandation vers score_nps à confirmer explicitement, avec type/plage et règle de non-écrasement ; pas de score automatique avant cet audit |
| Hors périmètre | Création d’adulte, modification des noms/emails, participation supposée, score de formation | Création d’établissement/dossier, relation supposée à un formateur, changement de statut |

Primitives réutilisables : les claims, plans figés, états durables et relectures
PR38/pré-A/B/J45. Pour le bilan établissement, `planGooglePerson` peut servir à
l’identité établissement/dossier avec une configuration **bilan_etablissement**
auditée (`mapping.name` désigne ici le nom de l’établissement). Pour l’évaluation,
son contrat actuel exige un nom répondant absent de la source : un résolveur
spécifique email+relation explicite doit être testé, sans élargir silencieusement
le contrat du Worker ou du runner B/J45.

## Séquence de mise en œuvre restante

1. Confirmer dans les métadonnées réelles les champs de réception propres aux
   deux familles, ou faire valider un changement de schéma distinct. Auditer le
   mapping du score éventuel, sans déduire un champ à partir du seul libellé.
2. Préparer des configurations privées versionnées : tables, aliases
   établissement/cohorte, champs contacts admis, champs de réception et types.
   Refuser configuration absente, ambiguë ou modifiée après capture. Aucun ID ni
   mapping privé dans le dépôt ou le navigateur.
3. Conserver au journal les couples libellé/réponse, l’année déclarée, la version
   et la date serveur figée ; relire la source avant toute projection. Le journal
   reste append-only pour ne pas écraser une annotation concurrente.
4. Enregistrer dans FORM_SUBMISSIONS un plan, son digest et ses claims avant le
   PATCH métier. Geler date/identité/dossier. Contrôler identité, relations et
   anciennes valeurs avant et après écriture. Écriture incertaine : lecture seule
   au rejeu. Zéro création et zéro statut « formé ».
5. Montrer dans le catalogue privé un résultat D1 vérifié et son dossier/date,
   ou une attente explicite avec motif ; ne pas prétendre réception métier sur
   la seule présence d’une ligne au journal. Réponse publique uniforme.
6. Recetter le parcours compilé → journal → champ métier → lecture privée avec
   données fictives, puis faire la recette autorisée de l’environnement cible.
   Ajouter les liens seulement après cette validation.

Cas de recette indispensables : email absent/dupliqué, email d’un autre dossier,
établissements homonymes, deux dossiers actifs sur l’année, cohorte non configurée,
dossier fusionné, date/score existants différents, source ou POST/PATCH perdu,
rejeu sur une autre date, changement de configuration, identité réservée ailleurs,
annotation journal concurrente. Le score zéro doit rester une valeur renseignée.
Les claims site ne constituent pas un compare-and-swap universel face aux PATCH
Google/humains : cette limite doit être documentée ou traitée explicitement.

## Vérification du lot préparatoire

```sh
bun run test
bun run build
bun scripts/check-final-questionnaires.mjs
```

La recette compile les deux vraies pages/endpoints, vérifie sept largeurs par page,
les options et contrôles, deux simulations au clavier, puis l’absence du formulaire
et le HTTP 503 en mode production. Aucun secret ni donnée réelle n’est utilisé.
Ce lot ne dépend pas des commits B/J45/accord et ne doit pas retarder pré-A.
