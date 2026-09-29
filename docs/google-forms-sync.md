# Raccord Google temporaire — récepteur et collecte brute

Le raccord conserve les réponses reçues via les liens Google encore distribués,
jusqu'à la date de fermeture choisie par l'équipe. Deux composants sont livrés :
un Worker de collecte brute et un récepteur métier limité à deux types de
formulaires. Leurs flags sont **désactivés par défaut**. Publier le site ou
déployer le Worker ne suffit pas à activer la collecte ou la projection.

## Périmètre livré

Le Worker livré dans `workers/google-transition/` reçoit les snapshots des sources
explicitement autorisées, envoyés par Apps Script avec les droits Google du projet.
Le transport CSV anonyme reste une alternative à accès non validé. Le catalogue opérationnel comprend **11 sources**, dont
la configuration reste privée : aucune liste de sources réelles n'est codée dans
le dépôt. La collecte générique conserve toutes les colonnes dans un journal brut
NocoDB, même sans mapping métier. Ces réponses portent le statut **À rapprocher**.
La capture D1 précède la livraison NocoDB et le reçu n'est acquitté qu'après
vérification de la ligne distante. Le transport authentifié est livré dans
`scripts/google-forms/EuneosRawCapture.gs` ; l'ajout du fichier ne l'active pas.

Le récepteur `GET/POST /api/hook/google-forms` accepte uniquement **contact** et
**déploiement**, cohorte **2**. Il reste à `410 legacy_retired` tant que son flag
est inactif. Le v1 historique reste lisible et rejouable avec ses reçus. Le v2
permet la projection future ciblée depuis le push authentifié, après recette et
activation distinctes. Les champs existants sont conservés ; seuls les champs
vides compatibles peuvent être complétés. Aucun service d'email n'est appelé, même au premier passage.
Aucun établissement, adulte, groupe ou mission n'est créé ; aucun lien distribué,
statut de candidature ou contact maître n'est modifié.

La collecte brute fonctionne indépendamment du récepteur. Le Worker ne lui envoie
des événements que si la projection est activée séparément et si la source possède
un mapping contact ou déploiement validé. Une absence de réponse CSV, un HTML de
connexion, une troncature ou un en-tête ambigu produit un incident visible ; ce
n'est jamais une demande d'effacement.

## Configuration du récepteur

| Variable / binding | Prérequis |
| --- | --- |
| `GOOGLE_FORMS_TRANSITION_ENABLED` | chaîne exacte `true` ; absent, faux ou autre valeur → 410, sans lecture des secrets/D1/NocoDB |
| `GOOGLE_FORMS_TRANSITION_MODE` | `plan` par défaut ; `capture` ou `apply` explicites ; autre valeur → 503 |
| `GOOGLE_FORMS_SYNC_SECRET` | secret partagé de 32 à 256 caractères ; header `x-google-forms-secret`, jamais URL, code ou logs |
| `GOOGLE_FORMS_SYNC_SOURCES` | JSON privé des sources autorisées, modèle ci-dessous |
| `FORM_SUBMISSIONS` | D1 existant ; migrations `0002`, `0004`, puis nouvelle `0005_google_form_transition_captures.sql` |
| `NOCODB_TOKEN` | nécessaire en `plan` / `apply`, inutile en `capture` |

Le flag du récepteur est **absent de `[vars]` en production** : absence = désactivé.
L'opérateur le gère explicitement dans l'environnement Cloudflare après recette
(par exemple binding `secret_text` initialisé à `false`), sans valeur de production
dans Git. La preview reste explicitement versionnée **false**. Les flags de
collecte/projection du Worker restent également versionnés **false**.
Les anciennes variables `GOOGLE_FORMS_SYNC_MODE=apply` ne réactivent rien.
La preview reste interdite même avec le flag actif, car son binding historique
pointe sur le registre de production. Recette uniquement locale avec données fictives.
Le workflow actuel des migrations internes ne migre pas `FORM_SUBMISSIONS` :
prévoir séparément la migration autorisée de cette base avant toute activation.

Exemple fictif de sources, jamais une configuration prête à installer :

```json
[{"spreadsheetId":"fictional_sheet_id","sheetId":0,"kind":"contact","cohortId":2,"firstRow":2}]
```

Chaque couple Sheet/onglet doit être unique. Limite : 32 sources, seulement deux
familles connues. Cet exemple décrit le contrat historique v1. Pour la nouvelle
projection push, chaque entrée doit utiliser le contrat v2 ci-dessous : `firstRow`
exclut le stock, et une coupure horodatée ainsi qu’une empreinte des en-têtes sont
obligatoires. Aucun changement automatique de cohorte. Un rapprochement validé peut
ajouter `identityMappings: [{submitted: {name,city,postcode,referenceEmail},
schoolId, expected: {name,city,postcode}}]` ; la fiche actuelle doit encore
correspondre exactement aux coordonnées attendues. Un email seul ne suffit pas.
Une ville fournie contradictoire interdit le rapprochement automatique.

## Configuration et activation du Worker

`workers/google-transition/wrangler.toml` conserve un cron toutes les 15 minutes,
**inerte avec `INPUT_MODE=push`**, valeur versionnée. En mode push, aucune exécution
planifiée ne lit Google ou D1. Avec `ENABLED=false`, l'ingestion est refusée ; le
contrôle authentifié `/check` reste disponible en lecture seule. L'activation du
Worker se fait séparément de la publication du site.

| Variable / binding | Prérequis |
| --- | --- |
| `ENABLED` | `true` active la collecte brute ; valeur versionnée `false` |
| `INPUT_MODE` | `push` versionné : snapshots authentifiés, aucun polling Google ; `poll` reste une alternative explicite |
| `PROJECTION_ENABLED` | `true` autorise la projection ciblée ; valeur versionnée `false`, indépendante de la collecte |
| `STATE` | tables dédiées de `workers/google-transition/schema.sql`, reçus et curseurs conservés |
| `SOURCES` | JSON privé du catalogue : libellé, Sheet, onglet et première ligne ; mapping facultatif pour les deux types métier |
| `JOURNAL_TABLE`, `NOCODB_TOKEN` | journal brut privé et accès NocoDB, fournis hors dépôt |
| `RUN_SECRET` | authentification des commandes opérateur `GET` (état) et `POST` (exécution), header `Authorization: Bearer …` |
| `INGEST_SECRET` | secret facultatif distinct pour `/check` et `/ingest` ; sinon `RUN_SECRET` est utilisé |
| `PROJECTION_START_AT` | date de coupure ISO explicite, obligatoire uniquement pour la projection |
| `GOOGLE_FORMS_SYNC_SECRET` | secret partagé avec le récepteur, obligatoire uniquement pour la projection |

Le mode push accepte la projection **v2 uniquement**, avec une configuration
explicitement validée pour chacune des deux familles. Chaque source métier exige
`eventVersion:2`, `cohortId:2`, `mapping`, `policy` et `projectionFirstRow`.
Seule une **nouvelle réponse de révision 1**, découverte pendant
cette activation, à partir de cette ligne et après la date de coupure est éligible.
Activer la projection ne reprend donc pas automatiquement les captures historiques
ni leurs corrections. Le mode `apply` du récepteur reste une décision distincte.

La mise en service exige un schéma D1 compatible, le journal NocoDB, les secrets
et l'accès aux exports validés. `CREATE TABLE IF NOT EXISTS` ne met pas à niveau
un ancien schéma prototype. Les preuves de ces opérations, le catalogue, les
exports, les mappings réels et les valeurs de secrets restent dans les documents
privés d'exploitation, hors Git. Ce document décrit le code livré et ses
prérequis ; il ne constitue pas une preuve d'activation distante.

### Accès Google à valider depuis le transport réel

La recette réelle a rencontré des réponses **401** depuis Cloudflare alors que
les mêmes exports étaient lisibles depuis un poste local. Cette observation
invalide l'activation du polling anonyme ; elle ne démontre pas la cause du refus.
La collecte doit rester désactivée jusqu'à validation d'un transport autorisé.
Un test local, le partage par lien ou le succès de la CI ne prouve pas les droits
effectifs de l'environnement qui exécutera la collecte. Les détails de recette
et les preuves source par source restent privés.

Pour chaque source, vérifier l'identité Google qui lit, ses droits réels sur le
document et l'onglet, puis une lecture complète depuis le transport retenu. Une
réponse 401/403 est un refus à traiter, jamais une feuille vide ni un motif de
suppression des reçus. Ne pas changer le User-Agent ou utiliser un proxy pour
contourner ce refus ; ne pas transférer de cookie, jeton OAuth utilisateur ou
refresh token Google dans Cloudflare. Ne pas publier les réponses personnelles
sur le web pour rendre le CSV accessible.

Deux transports authentifiés peuvent être préparés séparément :

- **Push Apps Script depuis le projet Google existant** : lecture sous un compte
  ayant accès aux sources, autorisations accordées dans l'interface Google, puis
  envoi HTTPS authentifié avec le secret du pont. Les déclencheurs installables
  s'exécutent sous le compte de leur créateur ; les droits Google restent dans
  Google. Voir les [autorisations Apps Script](https://developers.google.com/apps-script/guides/services/authorization)
  et les [déclencheurs installables](https://developers.google.com/apps-script/guides/triggers/installable).
- **API Google avec identité de service dédiée** : droits de lecture explicitement
  accordés aux documents concernés et authentification serveur adaptée. Le rôle
  Google Cloud du compte de service ne remplace pas les permissions Drive sur les
  fichiers. Voir les [rôles Drive](https://developers.google.com/workspace/drive/api/guides/ref-roles)
  et l'[authentification serveur](https://developers.google.com/identity/protocols/oauth2/service-account).

Le push générique décrit ci-dessous est implémenté. L'alternative API avec compte
de service ne l'est pas et n'est pas nécessaire à cette installation. Le récepteur
métier (v1 historique, v2 futur) reste distinct du journal générique. En mode push, le `POST /` opérateur
est refusé : l'ingestion passe uniquement par `POST /ingest`. Une preview du site
réussie ne valide pas à elle seule les droits Google ni le transport en exploitation.

### Push générique et recette Apps Script

Un appel envoie **une seule source complète**, sans identifiant de ligne choisi
par l'appelant : `headers` correspond à la ligne 1 et `rows[0]` à la ligne 2.
Le serveur applique son propre catalogue privé et `firstRow`. Toutes les cellules
doivent être des chaînes ; aucune date, colonne, valeur vide ou question dupliquée
n'est reformattée. Limites : 1 000 000 octets UTF-8 réellement lus, 256 colonnes,
2 000 lignes de réponses. Exemple entièrement fictif :

```json
{
  "version": 1,
  "source": {"spreadsheetId":"fictional_sheet_id_00001","sheetId":0},
  "headers": ["Horodateur", "Question", "Question"],
  "rows": [["29/09/2026 10:00:00", "Réponse", ""]]
}
```

`POST /check` et `POST /ingest` exigent `Authorization: Bearer …` et
`Content-Type: application/json`. Source inconnue : 403 ; corps invalide : 400 ;
trop grand : 413 ; transport incompatible : 409 ; configuration de projection incomplète : 503. `/ingest` refuse
`ENABLED=false` avec 503. Il réutilise les reçus, curseurs, empreintes, révisions,
reprises et verrou global existants. Aucune migration ni remise à zéro du bootstrap.
Son budget temporel est de 45 secondes avant admission de nouveaux appels réseau,
chaque appel ayant un timeout de 20 secondes ; la suite reprend aux prochains envois.

`POST /check` ne fait que deux lectures D1 et compare chaque empreinte aux reçus
existants. Il retourne les compteurs `matched`, `fresh`, `changed`, `pending`,
`missing`, et au plus 100 numéros de lignes différentes, sans les réponses.
Aucune écriture de reçu, curseur ou verrou, aucun appel NocoDB ni Google. Un verrou
actif donne `busy`. C'est le contrôle de compatibilité entre les anciens CSV et les
chaînes de `SpreadsheetApp.getDisplayValues()` ; tout écart historique doit être
examiné **avant** ingestion, jamais corrigé par une normalisation silencieuse.

Le script GAS utilise quatre propriétés privées de configuration : `EUNEOS_RAW_ENDPOINT` (origine
HTTPS du Worker, sans chemin), `EUNEOS_RAW_SECRET` (secret du pont),
`EUNEOS_RAW_SOURCES` (tableau du
catalogue autorisé), `EUNEOS_RAW_ENABLED` (chaîne `true` pour l'envoi). Aucun jeton NocoDB ou
Google utilisateur ne lui est transmis ou exporté. Fonctions à utiliser :

1. `euneosRawCheckDry()` : autorisation Google puis lecture des sources et comparaison
   `/check`. Fonction sans mutation, utilisable avec les deux collectes désactivées.
   Elle affiche seulement des compteurs et numéros de lignes. Examiner tous les
   écarts avec le bootstrap avant la suite.
2. `euneosRawSweep()` : exécution manuelle de recette une fois l'ingestion autorisée
   avec `ENABLED=true` côté Worker et `EUNEOS_RAW_ENABLED=true` côté GAS. Maximum trois sources par passage, rotation durable
   dans `EUNEOS_RAW_NEXT_SOURCE`, budget d'admission de 150 secondes. Une source en
   erreur n'empêche pas le passage aux suivantes. Le journal reste « À rapprocher ».
   Le verrou GAS est limité à la réservation du curseur ; aucune lecture Google
   ni requête réseau ne le conserve pendant que les anciens handlers peuvent en avoir besoin.
3. `euneosRawInstallTrigger()` : action opérateur explicite après recette. Refuse
   les flags inactifs, une projection active et les écarts historiques/restes à
   reprendre du contrôle à blanc. Crée seulement son déclencheur `euneosRawSweep`
   toutes les 15 minutes, ou constate qu'il existe déjà. Aucun ancien déclencheur
   n'est supprimé, remplacé ou rappelé ; aucun ancien mode `apply` n'est activé.

La lecture à blanc est bornée à trois minutes pour le catalogue complet. Un dépassement
ou un accès refusé arrête la recette sans installer de déclencheur. Les droits et
le fichier effectivement enregistrés dans Google restent à vérifier par l'opérateur.

## Projection future v2 : contrat et recette préalable

Ce lot ne fournit aucune configuration réelle prête à activer. Un catalogue de
capture sans `kind`, `mapping` et `projectionFirstRow` continue de collecter le
brut ; il ne suffit pas à projeter. Le Worker garde ses flags **false dans Git** ;
le récepteur de production reste **absent = désactivé**, et la preview **false**. Aucune
migration supplémentaire n'est introduite : conserver les reçus et verrous
existants, sans réinitialiser les tables. Le registre métier demeure limité à la
cohorte 2, qui doit être l'unique cohorte active.

Pour chaque source contact/déploiement, configurer et faire relire séparément :

| Worker `SOURCES` | Récepteur `GOOGLE_FORMS_SYNC_SOURCES` |
| --- | --- |
| Sheet/onglet exact, `kind`, `eventVersion:2`, `cohortId:2` | mêmes identité, famille, version et cohorte |
| `firstRow` : début de la capture brute, inchangé | `firstRow` : première **nouvelle** ligne autorisée |
| `projectionFirstRow` : première nouvelle ligne auditée | même valeur dans `firstRow` |
| variable `PROJECTION_START_AT` : instant ISO explicite | `projectionStartAt` : même instant |
| `policy.headerDigest` | `headerDigest` : même empreinte |
| `mapping`, `policy` : inventaire privé des questions | éventuels `identityMappings` privés et revus |

L'empreinte est `SHA256(JSON.stringify(headers))`, en UTF-8, sur les libellés
**exacts et ordonnés**, espaces et retours à la ligne inclus. Aucun tri ni
normalisation pour cette empreinte. Le mapper `mapGoogleSheetRowVerified` la
contrôle avant interprétation, puis le récepteur la vérifie indépendamment.
Tout ajout, déplacement ou changement de libellé bloque la projection ; le
journal brut continue de conserver les nouvelles colonnes.

Un sélecteur de doublon exige libellé, occurrence **et position absolue** à partir
de 1, par exemple `{label:"Confirmation",occurrence:2,column:16}` sur une fixture
fictive. Aucune sélection implicite du premier/dernier doublon. Une position
incohérente est refusée. Même avec un sélecteur explicite, des confirmations
dupliquées contradictoires restent en revue.

`policy` contient trois listes auditées, sans chevauchement :

- `confirmations: [{header,answer}]` : une pour contact, deux pour déploiement ;
  réponse publiée exacte, non vide. Une chaîne arbitrairement remplie ne vaut pas
  confirmation.
- `captureOnly: [header]` : questions connues conservées comme déclarations
  brutes, sans affectation de personnes. Les colonnes remplies sont annoncées par
  `sheetSnapshot.deferredColumns`, jamais considérées comme intégralement traitées.
- `emptyOnly: [header]` : questions retirées. Une ancienne colonne vide est
  compatible ; si elle contient une réponse, elle devient non mappée et bloque
  toute projection métier. Les anciennes lignes restent hors coupure.

Tout en-tête restant non mappé (même vide), absent ou ambigu bloque la promotion.
Ne pas classer mécaniquement tous les champs inconnus en `captureOnly` pour faire
passer le contrôle : chaque classement exige une revue métier. L'intégralité des
cellules demeure dans le journal, y compris les participants et doublons.

Le corps v2 conserve les champs du v1 et ajoute seulement `declaration` :

```json
{"version":2,"declaration":{"evaluationInterest":{"answer":"Non","level":""}}}
```

Cet extrait n'est pas un événement complet. Pour déploiement, utiliser
`declaration: {preformation: "Oui" | "Non" | "Je vais le faire"}`. Le contact
accepte l'intention Oui/Non/Besoin d'information selon le libellé complet du site,
et demande le niveau uniquement sur Oui. La variante Google exacte avec
apostrophes ASCII (`Je ne sais pas, j'ai besoin de plus d'information`) est
convertie vers la valeur du site ; la cellule brute reste inchangée. Aucune
normalisation approximative des choix. Un niveau fourni par Google sur Non
reste une déclaration à revoir, sans projection de niveau. Les anciens champs de
dates/participants du contact sont absents du mapping v2 ; aucune ancienne valeur
NocoDB n'est effacée. Les dates du déploiement sont facultatives ensemble ; une
paire incomplète, invalide ou hors années de cohorte reste en revue. Les modalités
acceptées sont Présentiel/Hybride. Une combinaison de cases de préformation
(par exemple « Oui, Non ») est refusée, sans choisir une réponse à la place du
répondant. Les colonnes de participants retirées doivent être classées
`emptyOnly`, même si leur ancien libellé décrit par erreur des sessions.

Le rapprochement exige toujours un établissement et un dossier uniques, des
coordonnées indépendantes du nom, une cohorte active et un dossier non clos/non
fusionné. Une ville ou un email contradictoire ne sont jamais corrigés par
supposition. La projection v2 peut compléter uniquement :

- contact : réception de fiche, intention scientifique, niveau sur Oui ;
- déploiement : préformation, paire de dates fournie et compatible ;
- les champs vides de provenance formation et une entrée `googleTransitions`
  dans les notes, en conservant les notes humaines et toutes les anciennes sources.

Aucun statut de candidature/formation, adulte, mission, affectation, lien personnel
ou contact maître n'est écrit. Les noms de formateurs et listes de participants
restent des déclarations. Une contradiction observée sur un champ fourni bloque
**tout** le patch ; aucun effacement ni remplacement par une valeur récente
présumée plus fiable. Une ancienne question absente ne vaut jamais réponse vide.

Le reçu d'une projection vérifiée est durable avant la mise à jour du journal.
`complete/saved_raw_remaining` signifie que des champs sûrs ont été ajoutés, mais
que des déclarations brutes restent à rapprocher : journal **À rapprocher**, pas
« Repris dans le dossier ». Le même statut s'applique aux conflits/incertitudes.
Seul `complete/saved` donne « Repris dans le dossier ». Le rejeu ne répète pas le
PATCH métier et n'envoie aucun email.

Une ligne déjà capturée avec éligibilité 0 reste inéligible après activation.
Les corrections (révisions > 1) restent brutes. Avant toute reprise en attente,
le Worker compare la ligne au **snapshot push courant**, même si son scan normal
n'a pas encore découvert la modification : édition, disparition, nouvelle
empreinte d'en-têtes ou recul hors coupure empêchent l'envoi au récepteur. Un
payload déjà envoyé reste figé pour ses reprises exactes ; une modification du
mapping qui changerait ce payload l'envoie en revue, sans nouvel envoi métier.
Une écriture incertaine
conserve le verrou partagé du dossier et nécessite une réconciliation humaine.

Avant activation, relire les snapshots réels, valider chaque mapping/doublon et
valeur de confirmation, contrôler la cohorte, faire les plans NocoDB en lecture
seule, puis relever de nouveau l'instant de coupure et les premières lignes.
Les bornes relevées plus tôt ne sont pas une autorisation de reprise du stock.
Déployer/configurer séparément le récepteur en `plan`, puis organiser la bascule
`apply` et du Worker seulement après accord opérateur. Ne pas utiliser un appel
Worker avec projection activée comme simulation : un retour `state:plan` n'est
pas une livraison et reste en attente. `/check` reste sans mutation et expose le
flag réel ; le préflight GAS existant exige la projection désactivée. Le sweep
GAS existant est compatible, sans nouvelle propriété ni modification de trigger.

Arrêt de la projection : `PROJECTION_ENABLED=false` et récepteur désactivé ; la
capture générique peut rester active. L'arrêt global de capture demeure distinct.
Ne pas réinitialiser les reçus pour faire reprendre des réponses pendant une
pause. Les preuves, mappings, bornes et plans réels restent hors Git.

## Protocole v1 historique du récepteur

`GET` authentifié renvoie `{version:1,ready:true,mode,cohortId:2,sources:n}` après
vérification des tables locales ; aucune requête NocoDB ni écriture. `POST` accepte
`application/json`, maximum **32 768 octets réellement lus**, UTF-8 valide.

```json
{
  "version": 1,
  "kind": "contact",
  "cohortId": 2,
  "source": {
    "spreadsheetId": "fictional_sheet_id", "sheetId": 0, "row": 2,
    "revision": 1, "submittedAt": "2026-09-25T10:00:00Z", "readAt": "2026-09-29T10:00:00Z"
  },
  "identity": {"name":"Collège Fictif","city":"Ville Fictive","postcode":"01234","referenceEmail":""},
  "contact": {"name":"Référente fictive","email":"ref@example.invalid","phone":""},
  "formation": {"start":"2026-10-01","end":"2027-02-01","format":"Présentiel","planning":""},
  "declaredTrainer":"", "participants":""
}
```

Les clés v1 sont requises ; utiliser une chaîne vide pour une valeur absente,
sans jamais en déduire une demande d'effacement. `submittedAt` et `readAt` sont
des timestamps ISO explicites, pas des dates locales ambiguës.

Extension facultative de preuve `sheetSnapshot` :

```json
{"headers":["Question","Question"],"values":["Ancienne réponse","Nouvelle réponse"],"unmappedColumns":[1,2],"missingFields":[]}
```

`headers` et `values` ont la même longueur, maximum 256 colonnes ; les cellules
sont des chaînes/nombres/booléens/null. Les numéros `unmappedColumns` commencent
à **1** et servent au diagnostic, jamais au mapping métier. Tout champ v1
supplémentaire est également conservé. Une colonne non mappée, un champ configuré
manquant ou une extension inconnue donne `review/unmapped_fields` sans promotion.
Même sans ces diagnostics, le récepteur ne réinterprète jamais les cellules brutes.
Une requête rejetée (400/403/413) n'est pas capturée : le poller doit conserver sa
source et signaler l'incident ; ne pas tronquer pour obtenir artificiellement 200.

`src/lib/google-form-sheet.ts` fournit un **mapper pur**, sans accès Google :
`mapGoogleSheetRow({source,mapping,headers,values,row,revision,submittedAt,readAt})`.
En v1 historique, un mapping choisit des libellés normalisés :
`{timestamp:'Horodateur', name:"Nom de l’établissement", start:'Début historique'}`.
Pour un doublon, `{label:'Confirmation',occurrence:2}` désigne explicitement la
seconde occurrence ; sans occurrence une ambiguïté est refusée. Les libellés
réels doivent être inventoriés et validés, sans deviner la signification d'une
colonne. Les dates `jj/mm/aaaa` de formation sont normalisées. Le Worker convertit
l'horodatage Google local avec le fuseau `Europe/Paris`, sans le remplacer par
l'heure de lecture ; les heures inexistantes ou ambiguës au changement d'heure
restent à vérifier et ne sont pas projetées. Le snapshot garde les
cellules originales, espaces, sauts de ligne, colonnes historiques et doublons.

## Révisions et traitement des retours du récepteur

Identité de réponse : `(spreadsheetId,sheetId,row)`. Le poller doit conserver un
compteur durable par réponse, réservé **avant** chaque envoi. Changement de contenu
complet, y compris les colonnes non mappées : nouvelle révision croissante.
A → B → A = 1 → 2 → 3. Un timeout rejoue le même contenu et la même révision ;
`readAt` peut changer. L'ordre des clés JSON ne change pas l'empreinte, les cellules
et leur ordre oui. Ne jamais réinitialiser les compteurs ou trier/déplacer les
lignes sources sans réconciliation. Un changement d'identité sur une ancienne
ligne passe en revue, mais cela ne remplace pas un identifiant de réponse stable.
Un poller peut manquer des éditions entre deux lectures : il journalise les
versions **observées**, pas un historique que Google ne lui fournit pas.

Le journal distingue chaque révision et chaque contenu conflictuel de cette
révision. Les reçus de l'ancien connecteur ne sont pas recyclés. Une révision
ancienne ne peut pas passer devant une nouvelle déjà observée. Un payload différent
avec le même numéro donne `review/revision_conflict` et conserve les deux preuves.

| Retour | Interprétation du sender |
| --- | --- |
| 200 `complete/saved` | promotion vérifiée et reçu durable ; pas de nouvel envoi |
| 200 `complete/saved_raw_remaining` | promotion partielle vérifiée ; déclarations brutes à rapprocher, pas de nouvel envoi |
| 200 `review/captured` | source durable en D1, **pas de promotion NocoDB** ; pas de retry automatique |
| 200 `review/*` | preuve à traiter, conserver le reçu et remonter l'anomalie |
| 202 `processing` | réessayer avec temporisation, même révision ; pas de reset |
| 503 `retryable/*` | lecture/verrou indisponible avant mutation ; retry borné |
| 410 / 401 / 403 / 400 / 413 | désactivé, authentification, source ou payload rejeté ; incident opérateur |
| 200 `state:plan` | simulation ; aucune source durable, ne pas acquitter une collecte |

Le header `x-google-forms-mode: plan` peut réduire le mode serveur à une simulation,
jamais l'élever. Un reçu `captured`, `identity_unresolved` ou `notes_invalid` peut
être repris **explicitement** après correction de configuration. Aucun rejeu
automatique d'une écriture incertaine. Arrêter le pont = flag false et, après
vérification, arrêt du poller à la date décidée par l'équipe ; aucun TTL inventé.

## Conservation et promotion par le récepteur

- `plan` : lectures NocoDB et plan avant/après, sans D1 ni mutation. La réponse
  peut contenir des données privées : consultation opérateur seulement.
- `capture` : stockage D1 du JSON intégral, même identité non résolue, aucun réseau
  NocoDB. `google_form_transition_captures` contient chaque contenu et son code ;
  `google_form_events` contient le reçu de la révision et le plan éventuel.
- `apply`, **v1 historique** : même capture préalable ; rapprochement d'un unique dossier non fusionné
  de cohorte 2, puis promotion seulement si **aucune projection contact existante,
  aucune date, aucun statut de formation et aucune réception contact acquise**.
  La paire de dates doit être complète, valide et dans 2026–2027. Les notes humaines
  sont conservées. Le contact déclaré et les participants restent des déclarations.

En v1, une projection site, une ancienne projection Google enrichie par le site,
une reprise manuelle ou toute valeur opérationnelle existante bloque la promotion
entière. Le comportement v2 est décrit séparément ci-dessus. Elle reste byte-for-byte intacte. Une édition Google n'efface rien et ne
remplace pas une donnée même plus ancienne : elle demande une revue humaine.
Le statut HTTP 200 ne prouve donc jamais à lui seul l'intégration dans NocoDB.

Google, les formulaires du site et le renouvellement des liens partagent
`operational_submission_locks`. Les anciens `google_form_locks` sont également
respectés. Toute écriture potentiellement partie conserve son verrou sans TTL
jusqu'à réconciliation ; la relecture du résultat précède le reçu complet.
La comparaison avant PATCH détecte les éditions observables, mais NocoDB n'offre
pas ici de PATCH conditionnel atomique : avant `apply`, prévoir un créneau sans
édition manuelle concurrente des dossiers concernés. La capture reste utilisable
pendant l'activité normale de l'équipe.

## Journal brut générique et reprise du Worker

La collecte de toutes les sources autorisées et leur livraison au journal NocoDB
sont **livrées dans ce lot**. Le journal utilise dix champs : `cle_reponse`,
`formulaire`, `horodatage_source`, `ligne_source`, `revision`, `reponses`,
`source_url`, `statut_reprise`, `date_reprise` et `detail_reprise`. `reponses`
conserve chaque colonne sous la forme `{column, question, answer}`, dans son ordre
d'origine, y compris les libellés dupliqués et les réponses vides. Le Sheet complet
fait foi pour cette capture, même si les questions du Form ont changé.

Le contrat de clé est stable, notamment pour une initialisation du registre :

```text
sourceKey = spreadsheetId + ':' + sheetId
fingerprint = SHA256(JSON.stringify(answerFields(headers, cells)))
response_key = SHA256(JSON.stringify([sourceKey, row, revision, fingerprint]))
```

La révision augmente à chaque changement observé, y compris A → B → A. Le contenu
brut est réservé en D1 avant livraison. Les écritures NocoDB perdues sont
rapprochées par leur clé, puis vérifiées ; une écriture au résultat incertain n'est
jamais recréée automatiquement sur la seule base d'une recherche vide. Les réponses
429 sont temporisées, les reprises sont séquentielles et le résultat de projection
est conservé avant la mise à jour du statut du journal.

Chaque invocation est bornée à **48 requêtes HTTP externes**, redirections et
reprises comprises, et **48 requêtes D1**, erreurs comprises. Une requête D1 reste
réservée au statut final et à la libération du verrou. Maximum : 10 lignes
traitées, 100 inspectées et 5 sources. La lecture groupée des reçus, les curseurs
durables et la rotation des sources permettent de parcourir les captures déjà
initialisées sans empêcher la détection des nouvelles réponses. Le statut
authentifié expose ces compteurs et les incidents ; un dépassement du budget
reprend à l'exécution suivante.

Une livraison au journal brut ne signifie pas qu'un dossier métier a été modifié.
Les sources sans mapping restent **À rapprocher** ; une projection qui demande
une revue porte également le statut **À rapprocher**. Le récepteur métier conserve son refus
explicite des types autres que contact et déploiement. Les preuves nominatives et
les décisions de rapprochement restent privées, hors dépôt. Les journaux doivent
rester à accès privé, sans export public ni log de contenu.

## Validation locale

`bun test tests/google-form-sync.test.js tests/google-form-sheet.test.js`
utilise les migrations SQL réelles dans SQLite et un faux serveur NocoDB. Les
appels réseau inattendus, emails, créations et liens font échouer les tests.
La suite vérifie aussi concurrence/rejeu, corrections, pertes de réponse,
conflits, conservation des projections existantes, colonnes déplacées/dupliquées,
champs supprimés, capture intégrale et flags/authentification/modes.

`bun test tests/google-transition-worker.test.ts` couvre aussi les budgets HTTP et
D1 réels par invocation, les SQL échouées, les 429, les reprises, les verrous,
les horodatages et un bootstrap fictif de 273 réponses réparties sur 11 sources.
Le script GAS est aussi exécuté dans un bac à sable de test avec des services
Google simulés : chaînes CSV identiques, absence de mutation au contrôle à blanc,
rotation bornée, installation explicite et conservation des anciens déclencheurs.
Les suites `google-form-future-sheet.test.ts` et `google-future-pipeline.test.ts`
ajoutent la recette v2, les en-têtes figés et le parcours complet push → récepteur
réel → faux NocoDB, avec les migrations SQL réelles dans SQLite. Exécuter
`bun run test`, `bun run build`, le contrôle TypeScript du Worker et le dry-run
Wrangler avant livraison.
Ces validations utilisent des données fictives et ne font aucun appel réel à
Google, NocoDB ou Brevo.
