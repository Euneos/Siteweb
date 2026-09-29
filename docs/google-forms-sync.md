# Raccord Google temporaire — préparation du 29 septembre 2026

Le retrait de la PR #16 reste le comportement par défaut (`410 legacy_retired`).
La décision du 29 septembre autorise la préparation d'un raccord temporaire pour
les liens Google encore distribués, jusqu'à la date choisie par l'équipe. Ce patch
ne déploie rien, ne configure aucun secret, n'installe aucun script ni déclencheur,
ne lit pas de secret local et ne modifie aucune donnée distante.

## Périmètre livré

Récepteur `GET/POST /api/hook/google-forms`, contact et déploiement, cohorte **2**.
Le v1 historique est repris avec une capture privée intégrale et une promotion
strictement additive. Aucun service d'email n'est appelé, même au premier passage.
Aucun établissement, adulte, groupe ou mission n'est créé ; aucun lien distribué,
statut de candidature ou contact maître n'est modifié.

Le transport est indépendant de Google : un Worker Cloudflare planifié peut lire
les deux exports CSV autorisés puis envoyer les événements en HTTPS. Apps Script
n'est pas requis. Le poller, ses permissions, sa planification et la vérification
continue de l'accessibilité des CSV restent hors de ce patch. Une absence de
réponse CSV, un HTML de connexion, une troncature ou un en-tête ambigu doivent
produire un incident visible et ne jamais être interprétés comme des effacements.

## Configuration future, non appliquée

| Variable / binding | Prérequis |
| --- | --- |
| `GOOGLE_FORMS_TRANSITION_ENABLED` | chaîne exacte `true` ; absent, faux ou autre valeur → 410, sans lecture des secrets/D1/NocoDB |
| `GOOGLE_FORMS_TRANSITION_MODE` | `plan` par défaut ; `capture` ou `apply` explicites ; autre valeur → 503 |
| `GOOGLE_FORMS_SYNC_SECRET` | secret partagé de 32 à 256 caractères ; header `x-google-forms-secret`, jamais URL, code ou logs |
| `GOOGLE_FORMS_SYNC_SOURCES` | JSON privé des sources autorisées, modèle ci-dessous |
| `FORM_SUBMISSIONS` | D1 existant ; migrations `0002`, `0004`, puis nouvelle `0005_google_form_transition_captures.sql` |
| `NOCODB_TOKEN` | nécessaire en `plan` / `apply`, inutile en `capture` |

Le flag est versionné **false** dans `wrangler.toml`, production et preview.
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
familles connues. `firstRow` définit explicitement le stock à reprendre, sans
inférence de cohorte active ni de date de coupure. Un rapprochement validé peut
ajouter `identityMappings: [{submitted: {name,city,postcode,referenceEmail},
schoolId, expected: {name,city,postcode}}]` ; la fiche actuelle doit encore
correspondre exactement aux coordonnées attendues. Un email seul ne suffit pas.
Une ville fournie contradictoire interdit le rapprochement automatique.

## Protocole v1

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
Un mapping choisit des libellés normalisés, jamais les positions de colonnes :
`{timestamp:'Horodateur', name:"Nom de l’établissement", start:'Début historique'}`.
Pour un doublon, `{label:'Confirmation',occurrence:2}` désigne explicitement la
seconde occurrence ; sans occurrence une ambiguïté est refusée. Les libellés
réels doivent être inventoriés et validés, sans deviner la signification d'une
colonne. Les dates `jj/mm/aaaa` de formation sont normalisées ; l'horodatage CSV
exige une conversion indépendante avec fuseau vérifié. Le snapshot garde les
cellules originales, espaces, sauts de ligne, colonnes historiques et doublons.

## Révisions et traitement des retours

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

## Conservation et promotion

- `plan` : lectures NocoDB et plan avant/après, sans D1 ni mutation. La réponse
  peut contenir des données privées : consultation opérateur seulement.
- `capture` : stockage D1 du JSON intégral, même identité non résolue, aucun réseau
  NocoDB. `google_form_transition_captures` contient chaque contenu et son code ;
  `google_form_events` contient le reçu de la révision et le plan éventuel.
- `apply` : même capture préalable ; rapprochement d'un unique dossier non fusionné
  de cohorte 2, puis promotion seulement si **aucune projection contact existante,
  aucune date, aucun statut de formation et aucune réception contact acquise**.
  La paire de dates doit être complète, valide et dans 2026–2027. Les notes humaines
  sont conservées. Le contact déclaré et les participants restent des déclarations.

Une projection site, une ancienne projection Google enrichie par le site, une
reprise manuelle ou toute valeur opérationnelle existante bloque la promotion
entière. Elle reste byte-for-byte intacte. Une édition Google n'efface rien et ne
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

## Audit du parent et périmètre encore ouvert

L'audit du 29 septembre signale une définition du contact modifiée alors que le
Sheet garde les anciennes dates/participants. Le mapper lit le **Sheet complet**,
sans prendre les questions actuelles du Form comme schéma de la réponse passée.
L'export déploiement actuel comporte 45 colonnes, dont des confirmations dupliquées
et des colonnes nouvelles en fin de feuille. Leurs valeurs restent séparées et
non interprétées avant validation du mapping. Les cas nominatifs, leurs preuves
et les arbitrages restent dans le dossier privé du parent, hors dépôt de code.

**Tous les formulaires / journal brut NocoDB : non livré dans ce lot.** Les autres
familles reçoivent un refus explicite, jamais un succès silencieux. Ce lot ne crée
pas de protocole universel ni de nouvelle table métier NocoDB. Pour atteindre la
cible « toutes les sources présentes dans NocoDB même non projetées », convenir
ensuite d'une table privée de réponses sources : clé stable de réponse + révision
+ empreinte, source, contenu intégral, statut de projection, reçu de livraison.
Prévoir un relais D1 → NocoDB avec déduplication vérifiée et reprise après réponse
perdue, une file de revue visible et un schéma validé avant toute création. La clé
unique NocoDB et la stratégie de création après timeout doivent être démontrées,
pas supposées. D1 est actuellement la capture durable, **pas** la preuve d'une
livraison NocoDB. Les journaux contiennent des données personnelles : accès privé,
aucun export public/log de contenu ; rétention à décider avant activation.

## Validation locale

`bun test tests/google-form-sync.test.js tests/google-form-sheet.test.js`
utilise les migrations SQL réelles dans SQLite et un faux serveur NocoDB. Les
appels réseau inattendus, emails, créations et liens font échouer les tests.
La suite vérifie aussi concurrence/rejeu, corrections, pertes de réponse,
conflits, conservation des projections existantes, colonnes déplacées/dupliquées,
champs supprimés, capture intégrale et flags/authentification/modes. Validation locale effectuée : **643 tests réussis, 0 échec** (`bun test tests`)
et `bun run build` réussi. Aucun appel réel à Google, NocoDB ou Brevo.
