# Suivi interne des établissements

Route : `/etat-candidatures`. Lecture seule, cohorte 2026–2027, aucune écriture ni notification.
Le bandeau et la navigation restent ceux d’`InternalLayout`.

## Accès et confidentialité

La page refuse de lire NocoDB avant authentification. Sans configuration Access,
elle renvoie 503 ; sans jeton valide, elle renvoie 403, y compris sur `pages.dev`.
Configurer une application **Cloudflare Access** pour le domaine de production et
celui de l’aperçu, avec les membres autorisés nominativement. Dans chaque environnement :

- `INTERNAL_ACCESS_DOMAIN` : domaine d’équipe, sans protocole, par exemple `equipe.cloudflareaccess.com` ;
- `INTERNAL_ACCESS_AUD` : audience de cette application Access ;
- `NOCODB_TOKEN` : secret serveur existant.

Les réglages de preview et production sont indépendants. L’origine vérifie signature
RS256, émetteur, audience, expiration et identité. Un en-tête email seul ne donne aucun
accès. Aucun accès public supplémentaire ni mot de passe collectif n’est créé.
[Validation des JWT Cloudflare](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

Les noms, prénoms et fonctions des participants recensés sont réservés aux membres
autorisés. Les noms des formateurs proviennent des missions non annulées, jamais du
champ apporteur. Les emails et téléphones de ces personnes ne sont pas demandés.
Les notes de participation sont lues côté serveur uniquement pour extraire le bloc
structuré ci-dessous : les notes humaines brutes, les emails, les identifiants de
source et le jeton ne sont pas envoyés au navigateur. Toute chaîne affichée est
échappée par Astro. Réponse HTML privée, `no-store`, `noindex`.

## Vue opérationnelle

Chaque dossier montre systématiquement :

- début, fin et statut de formation, indépendamment du bilan des adultes formés ;
- réception de la fiche contact selon la case de suivi ;
- formateurs affectés via les missions, séparés des noms simplement déclarés dans une fiche ;
- **participants recensés** : nombre réel de lignes `adultes` rattachées au dossier et
  liste nominative dépliable, avec la fonction si disponible ;
- effectif ou liste déclaré(e) dans la source et identités encore incomplètes, présentées
  séparément. `importedCount` ne remplace jamais le comptage réel de la table `adultes`.

Une personne recensée n’est pas automatiquement formée ou validée. Une liste vide
signifie seulement qu’aucune personne n’est enregistrée sur ce dossier dans NocoDB.
Une mission annulée, abandonnée ou refusée ne prouve pas une affectation active.
Une relation vers un formateur dont le nom n’a pas été retrouvé reste visible avec
son identifiant et « nom non renseigné » ; elle n’est pas transformée en absence d’affectation.

Filtres GET : tous, commence dans les 30 jours, dates/provenance à vérifier, début
non renseigné. Tri par début croissant (dates absentes/invalides en dernier) ou nom.
Le filtre imminent couvre aujourd’hui jusqu’à J+30 inclus, en jours calendaires à
Paris, indépendamment des changements d’heure. Il exclut les candidatures abandonnées
ou refusées, les formations terminées/annulées/abandonnées et les dates ou provenances
contradictoires. C’est un indicateur fondé sur les dates renseignées, pas la validation
d’un planning. Un début absent ne prouve pas qu’aucune formation n’est imminente.
Le tableau historique des dix étapes conserve tous les dossiers de la cohorte,
indépendamment du filtre de la vue opérationnelle.

Les dates impossibles, une fin avant le début, les dates hors 2026–2027, les conflits
avec la source et les `issues` de provenance sont signalés. Aucune date n’est corrigée,
aucune mission créée, aucune fiche importée par cette page. « Base consultée le »
date la lecture de NocoDB, pas la réception d’un formulaire ni une synchronisation.

## Contrat de provenance V1

Les notes humaines sont préservées. Le producteur ajoute ou remplace **un seul** bloc :

```text
[EUNEOS_CONTACT_V1]
{"version":1,"source":{"spreadsheetId":"synthetic-sheet","rows":[2],"readAt":"2026-09-22T12:00:00Z"},"receivedAt":"2026-09-21","formation":{"start":"2026-10-01","end":"2027-03-01","kind":"previsionnelle","format":"Présentiel","planning":"Cinq rencontres","issues":[]},"declaredTrainers":[{"name":"Personne de démonstration"}],"participants":{"declared":"Trois personnes","unresolved":[],"importedCount":3}}
[/EUNEOS_CONTACT_V1]
```

`formation.start` et `formation.end` sont des dates ISO ou `null`. `receivedAt`
accepte une date ISO, un timestamp ISO avec fuseau, ou `null` ; le rendu garde la date
littérale (dix premiers caractères). `readAt` accepte les timestamps ISO avec fuseau
et de une à six décimales, notamment ceux de Python. Les extensions telles que
`sourceResponses`, `participants.identityNotes` et `formation.validationSource` sont
ignorées par la projection, sans invalider le bloc.
`kind` vaut `previsionnelle` ou `deploiement`. Un formateur déclaré peut avoir un
champ `email` dans la source ; celui-ci est exclu de la projection HTML. Les emails
éventuellement saisis dans les textes libres sont également masqués.

Le parseur vérifie structure/version, dates, compteurs, lignes source et unicité du
bloc. Un bloc illisible/dupliqué produit une alerte explicite et sort le dossier du
filtre imminent ; une note humaine sans bloc reste une note, sans preuve de réception.
Les dates de source différentes de celles du dossier sont affichées séparément pour
rapprochement. Elles ne remplacent jamais implicitement les dates NocoDB.

## Dix étapes, accessibles sous la vue opérationnelle

| Groupe      | Colonne                | Preuve affichée                                                                                         |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Candidature | Reçue                  | Date de candidature ; sinon non renseignée                                                              |
| Candidature | Accusé de réception    | Statut courant correspondant ; un statut ultérieur ne prouve pas l’envoi                                |
| Candidature | Analyse et décision    | Statut courant ; abandons/refus conservés                                                               |
| Sélection   | Sélectionné            | Date de validation ou statut d’acceptation ; date absente explicitée                                    |
| Sélection   | Lettre signée          | Case de suivi, sans prétendre avoir vérifié le PDF                                                      |
| Sélection   | Fiche contact          | Case reçue                                                                                              |
| Sélection   | Formateur désigné      | Personne reliée à une mission non annulée, pas l’apporteur                                              |
| Déploiement | Organisation           | Missions reliées, nombre et statut, sans présumer leur achèvement                                       |
| Déploiement | Formations et suivi    | Nombre déclaré d’adultes formés ou début renseigné ; dates toujours visibles dans la vue opérationnelle |
| Déploiement | Ateliers et évaluation | Non documentés ici ; pas de validation déduite d’un groupe créé                                         |

Sur téléphone, les trois colonnes opérationnelles s’empilent et chaque ligne des dix
étapes devient une fiche. Sur ordinateur, le tableau conserve ses groupes/colonnes.

## Intégrité et vérification

Toutes les tables sont paginées ; IDs répétés, arrêt prématuré et totaux serveur
incohérents provoquent une erreur explicite, jamais un faux zéro. La cohorte doit
être unique. Les archives sont exclues seulement après validation de leur cible,
de l’établissement et de la cohorte. Les lectures des enfants incluent ces archives :
un adulte ou une mission laissé sur une archive, ou renvoyé hors périmètre, bloque
le rendu pour éviter une disparition silencieuse. Les doublons courants restent
visibles et signalés ; le site ne les fusionne pas.

Recette locale reproductible, sans données ni identifiants réels :

```sh
bun run test
bun run build
CHECK_SCREENSHOTS=/tmp/euneos-operations-ui-qa bun scripts/check-internal-table.mjs
# Ajouter KEEP_PREVIEW=1 pour conserver un serveur local du rendu synthétique.
```

Le test compile/rend la vraie page avec des réponses NocoDB simulées et un JWT signé
par une clé locale. Il vérifie le refus d’accès avant lecture, la confidentialité,
les sources indisponibles, l’état vide, les filtres, les détails et le responsive.
Les fixtures sont fictives ; ne jamais copier une liste client dans le dépôt public.
Relire les captures. Avant publication, comparer le rendu autorisé aux dossiers réels
mis à jour par l’équipe : les tests ne valident pas le raccord Google ni les écritures métier.
