# Raccord Google Forms → NocoDB (campagne 2026–2027)

**Code préparé, activation non faite.** Ajouter ce code au site ne synchronise
aucune réponse : migration, configuration serveur et installation Google restent
nécessaires. Pas de nouvelle base ou infrastructure ; le registre D1 existant
`FORM_SUBMISSIONS` est réutilisé. Ne pas fusionner/publier ce lot sans sa revue.

## Ce qui est écrit

`POST /api/hook/google-forms` accepte une seule réponse par requête, authentifiée
par `x-google-forms-secret`. Chaque source est autorisée explicitement par
`spreadsheetId + sheetId + kind`, **cohorte 2** fixe et borne `firstRow` contrôlée
aussi côté serveur. Une ligne historique sous cette borne est refusée, même
avec le bon secret et la cohorte 2. Les dates ne choisissent jamais
la cohorte. Tous les domaines d’aperçu sont refusés, même avec un secret valide.

Le rapprochement demande nom exact normalisé et ville/code postal, ou nom et email
du référent. Si plusieurs signaux sont fournis, ils doivent tous concorder.
Les archives sont réconciliées puis exclues. Un unique établissement ET un unique
dossier courant de cohorte 2 sont requis. Aucun dossier, établissement, mission,
adulte, lien relationnel ou email n’est créé. Le statut de candidature est préservé.

Une fiche contact identifiable peut mettre `fiche_contact_recue=true` même quand
ses dates sont invalides. Une paire de dates valide, dans les années 2026 ou 2027, complète le dossier avec le
statut `Prévisionnelle` ; un déploiement passe à `Programmée`. Les statuts déjà
avancés restent préservés et leurs dates ne sont pas remplacées par une autre paire.
La réception d’un déploiement ne prouve pas la réception d’une fiche contact.

Une réponse contradictoire n’efface pas les dates existantes. Le bloc de notes
conserve les dates déclarées et les anomalies ; le statut devient `À préciser`
lorsque cela ne rétrograde pas une formation déjà avancée. Les anomalies d’un lot
parent/multi-réponses sont persistantes : un rejeu d’une seule ligne ne les résout
jamais. Une correction de prévision d’une source unique peut modifier les dates et
recalculer les seules erreurs techniques attribuées à sa révision précédente.
Les erreurs parent/humaines ou multi-sources restent conservées. Pour les lever : arbitrage humain documenté,
ou paire valide dans la source déploiement autorisée. Une fiche contact reçue après
le déploiement reste au journal et ne remplace pas sa projection ni sa provenance.

Les notes humaines avant/après le bloc sont préservées à l’octet près. Un seul
bloc `[EUNEOS_CONTACT_V1]` est remplacé ; un bloc invalide/dupliqué est refusé.
Le contrat parent est conservé, y compris les champs supplémentaires
`sourceResponses`, `formation.validationSource`, `participants.identityNotes` et
les horodatages ISO avec fuseau et 1–6 décimales. Les noms déclarés de formateurs
ne sont pas des affectations. Les emails extraits ne sont pas dans leur libellé.
`participants.importedCount` reste celui de l’import humain ; les déclarations
libres sont conservées comme non résolues. Aucun nom/prénom n’est inventé.
Les coordonnées du contact sont conservées dans l’historique privé D1, sans
écraser les coordonnées existantes de l’identité établissement.

## Durabilité et limites précises

`google_form_events` conserve chaque version : source, contenu original,
coordonnées, avant/proposition, résultat et horodatages. **Ce nouveau journal
contient des données personnelles**, contrairement aux anciens reçus de
candidature. Réserver son accès aux administrateurs support autorisés. Aucun
contenu du journal n’est exposé par l’API, écrit dans les logs ou versionné.
L’historique reste conservé pour la campagne ; définir sa durée d’archivage et
son nettoyage après la campagne. Ne pas purger les incidents non réconciliés.

Une révision persistante croissante par ligne, réservée dans Script Properties
**avant** tout envoi, distingue les changements A → B → A. La clé D1 hache source
+ révision ; une empreinte du contenu canonique (hors `readAt`) interdit de
réutiliser cette révision pour un contenu différent. Une réponse perdue réutilise
la même révision. Sauvegarder ces compteurs ; ne jamais les réinitialiser après
une réinstallation du script.
Un verrou persistant par participation sérialise les différentes réponses vers
le même dossier. Ni délai ni TTL ne libère un résultat d’écriture incertain.
Un arrêt du Worker peut laisser `processing` : inspection requise, pas de rejeu
aveugle. Une panne de lecture avant PATCH est seule automatiquement réessayable.
Une panne pendant/après PATCH, y compris au stockage du reçu final, conserve le
verrou et l’état `review`/`write_uncertain`. Une autre école peut continuer.

Le dossier est relu avant PATCH, puis après, mais **NocoDB v2 ne fournit pas ici
de compare-and-swap atomique**. Le verrou ne couvre que ce raccord : suspendre
les modifications manuelles/concurrentes pendant une reprise. Un conflit observé
avant PATCH refuse l’écriture. Un conflit ou échec observé après exige inspection.
Les champs non concernés ne sont jamais envoyés au PATCH.

L’adaptateur relit toujours les valeurs actuelles de la ligne ; une ancienne
version réussie ne peut pas annuler la suivante. Une version jamais traitée avec
une révision source antérieure à une version déjà traitée est refusée. Un retour
volontaire à un ancien contenu produit une nouvelle révision et peut donc être
appliqué ; un rejeu réseau d’une ancienne révision ne revient pas en arrière.
Ne pas trier, déplacer, insérer ou supprimer des lignes de la feuille de réponses :
la provenance utilise leur numéro. Utiliser une vue filtrée pour la consultation.

## Configuration et activation — opérateur, séparément de cette PR

1. Relire les sources Google actuelles et sauvegarder les scripts/déclencheurs.
   Ce fichier **indépendant** ne remplace pas les handlers existants et ne les appelle
   pas. Le déclencheur déploiement existant est de type Form ; celui du raccord
   sera de type Spreadsheet sur sa **feuille de réponses**, dont l’ID/onglet restent
   à confirmer. Vérifier les libellés exacts et la zone du classeur.
2. Faire vérifier les correspondances connues avant d’activer les événements.
   Les différences de nom ne demandent pas une nouvelle action du répondant :
   l’opérateur peut ajouter des `identityMappings` privés, avec nom/coordonnées
   source exacts, ID NocoDB et identité canonique attendue. Reprendre les preuves
   de rapprochement du lot parent ; ne pas inventer de correspondance. Un mapping
   double, périmé ou contradictoire reste refusé. Les quatorze réponses historiques
   sont le lot distinct du parent ; ne pas rappeler leurs handlers notifiants.
3. Appliquer **la migration existante et `0002_google_form_sync.sql`** dans la base
   `euneos-form-submissions` via le circuit habituel (`wrangler d1 migrations apply`).
   Aucune commande de création de base n’est nécessaire. La migration ne change
   pas `form_submissions` ni les calendriers.
4. Définir côté Cloudflare, comme valeurs serveur uniquement :
   `GOOGLE_FORMS_SYNC_SECRET` (aléatoire, au moins 32 caractères),
   `GOOGLE_FORMS_SYNC_SOURCES` (JSON ci-dessous),
   `GOOGLE_FORMS_SYNC_MODE=plan` initialement (valeur absente ou inconnue = plan). Conserver `NOCODB_TOKEN` et le binding
   `FORM_SUBMISSIONS`. Ne jamais mettre secret, emails ou mappings réels dans
   `wrangler.toml`, un fichier public, une URL ou une commande affichant sa valeur.
   Ces noms sont distincts de `HOOK_SECRET`.
5. Publier le code par le circuit habituel, puis GET authentifié de
   `https://euneos.fr/api/hook/google-forms` : `ready:true`, version 1, cohorte 2.
   Cette vérification lit le schéma D1 ; elle n’écrit ni dans NocoDB ni dans Google.
   **Avant activation, faire un POST authentifié pour chaque correspondance source
   connue en mode plan.** La réponse contient `state:plan`, le dossier et son
   avant/proposition, ou l’anomalie. Aucun reçu D1 ni PATCH n’est créé. Conserver
   cette réponse dans les preuves privées : elle contient des données personnelles.
   Le header `x-google-forms-mode: plan` peut aussi forcer cette simulation lorsque
   le serveur est en mode apply ; il ne peut jamais forcer l’écriture.
   Vérifier que les éventuels hooks NocoDB **de mise à jour** ne notifient pas sur
   ces champs : le raccord lui-même n’appelle aucun transport mail.
6. Ajouter `scripts/google-forms/EuneosNocoSync.gs` au projet Google existant.
   Dans **Paramètres du projet → Propriétés du script**, enregistrer le même
   `GOOGLE_FORMS_SYNC_SECRET` et `GOOGLE_FORMS_SYNC_CONFIG` (exemple ci-dessous).
   Restreindre l’accès éditeur du projet : ses éditeurs peuvent lire ces propriétés.
   Le secret NocoDB reste uniquement dans Cloudflare, jamais dans Apps Script.
7. Définir `firstRow` explicitement **dans la configuration serveur ET Google**
   pour chaque source. La borne serveur empêche un script mal configuré de
   traiter une ancienne campagne. Pour ne pas reprendre le
   stock parent, utiliser la première ligne **après le stock déjà réconcilié**.
   Les futures corrections d’une ligne antérieure ne seront pas lues automatiquement
   si elle est exclue : il faut alors une reprise contrôlée, pas changer la borne
   de tout le stock à l’aveugle. Le numéro de ligne est celui de la feuille réelle.
8. Après revue des plans et contrôle des propriétés, régler volontairement le
   serveur sur `GOOGLE_FORMS_SYNC_MODE=apply`, puis exécuter volontairement `euneosNocoInstallTriggers`.
   Autoriser Sheets/UrlFetch/déclencheurs avec le compte mainteneur. La fonction
   exige le précontrôle API en mode apply, garde les triggers existants, puis ajoute seulement
   `euneosNocoOnSubmit` (Spreadsheet submit) et `euneosNocoSweep` (15 minutes).
   Aucun script n’est exécuté à l’ajout du fichier. Une absence d’accès aux
   propriétés/triggers laisse **l’activation non faite**, même si la PR est publiée.
9. Recette autorisée sur une réponse source contrôlée : vérifier réception,
   provenance/dates/statut dans le bon dossier, déclaration ≠ affectation, reçu D1
   et absence d’email. Répéter le même événement : un seul PATCH, aucune création.
   Une preview ne permet pas cette recette réelle ; les tests locaux simulent les
   services et n’envoient aucun formulaire. Ne pas annoncer le raccord actif avant
   ce contrôle.

Exemple **fictif** de `GOOGLE_FORMS_SYNC_SOURCES` côté serveur :

```json
[{"spreadsheetId":"fictional_sheet_id","sheetId":0,"kind":"contact","cohortId":2,"firstRow":2,
  "identityMappings":[{"submitted":{"name":"Collège Fiction Alias","city":"Ville Fiction","postcode":"01234","referenceEmail":""},
    "schoolId":123,"expected":{"name":"Collège Fiction","city":"Ville Fiction","postcode":"01234"}}]}]
```

Un mapping vérifie **tous** les champs soumis et l’identité canonique attendue.
Ne pas mettre un wildcard ou le premier résultat d’une recherche. Sans mapping,
le rapprochement exact standard s’applique ; rien ne devine un homonyme.

Exemple **fictif** de `GOOGLE_FORMS_SYNC_CONFIG` dans les propriétés Google :

```json
{"sources":[{"spreadsheetId":"fictional_sheet_id","sheetId":0,"kind":"contact","cohortId":2,"firstRow":2,
 "headers":{"timestamp":"Horodatage","name":"Nom de l'établissement","city":"Ville","postcode":"Code postal",
 "referenceEmail":"Email du référent principal","contactName":"Nom du référent","phone":"Téléphone",
 "start":"Date prévisionnelle de début de la formation","end":"Date prévisionnelle de fin de la formation",
 "format":"Format","planning":"Organisation","trainer":"Formateur formation adultes (nom + email)","participants":"Participants"}}]}
```

Tous les libellés configurés doivent exister **exactement une fois** (accents/casse
normalisés). Ne configurer un libellé optionnel que s’il existe ; ne jamais le
remplacer par une recherche de fragment ou une position fixe. Timestamp doit
être une Date Google native (`getValues`), pas une chaîne d’affichage ambiguë.
Le déploiement utilise le même adaptateur, `kind:"deploiement"`, sa propre source
et ses libellés vérifiés. Pas d’URL configurable dans le script : destination HTTPS
fixe, redirections désactivées, secret uniquement dans l’en-tête.

## Reprise et observabilité

L’adaptateur inspecte au plus 100 lignes et envoie au plus cinq lignes modifiées
par invocation ; budget souple de 210 s, sans attente bloquante. Un appel UrlFetch
peut dépasser ce budget ; le registre D1 protège un arrêt pendant l’appel.
Le curseur tourne par source et par ligne : une ligne invalide n’affame pas les autres.
Les retries espacés (5–60 minutes) sont limités à six, puis `stopped`. Un `review`
serveur arrête les reprises automatiques. Une correction change l’empreinte, incrémente la révision et
reprend l’examen ; elle ne contourne jamais un verrou NocoDB incertain.

Les propriétés `EUNEOS_SYNC_ROW_<hash>` gardent seulement état/code/reçu/numéros
techniques. Elles ne contiennent ni réponses, ni noms, ni emails. Les états sont
consultables par le mainteneur dans Script Properties ou en exécutant
`euneosNocoStatus()` (journal technique sans noms, réponses ni emails) ; ce lot n’ajoute pas de
nouvel écran de supervision ni de notification. Les lignes dont l’identité n’est
pas résolue sont conservées dans le journal D1, car il n’existe aucun dossier sûr
dans lequel écrire une anomalie.

Diagnostic D1, sans exporter le contenu des réponses dans un ticket public :

```sql
SELECT event_key, kind, state, code, target_id, updated_at
FROM google_form_events WHERE state != 'complete' ORDER BY created_at;
SELECT target_id, event_key, created_at FROM google_form_locks;
```

Pour `write_uncertain`/`processing` ancien : arrêter les triggers du raccord,
relire le dossier et comparer `before_json` / `patch_json` dans le journal privé.
Si le PATCH et le lien/cohorte sont prouvés, marquer le reçu `complete` puis
supprimer **son seul verrou**. Sinon consigner et réparer l’écart avant de décider
une reprise. Ne pas supprimer un reçu, libérer un verrou par son âge, ou répéter
le PATCH sans contrôle. Pour `identity_unresolved` ou `notes_invalid`, corriger le mapping/les notes puis
appeler explicitement `euneosNocoRetryRow(spreadsheetId, sheetId, row)` avec la
seule source concernée. Le serveur réexamine ces refus avant écriture avec la
même révision ; nul besoin de supprimer le reçu ni de redemander au répondant.
Cette fonction refuse `write_uncertain` et garde les compteurs de révision.
Pour un état Google `stopped`, inspecter d’abord le reçu D1 ; seul un opérateur
peut ensuite remettre l’état technique en `retryable` et `nextAt=0`, sans toucher
à `hash`/`revision` ni aux verrous serveur.

## Tests et références

`bun test tests/google-form-sync.test.js tests/google-form-adapter.test.js` :
SQLite réel pour migration/reçus/verrous, NocoDB simulé, Apps Script exécuté dans
un contexte local simulé. Concurrence, perte de réponse, panne de reçu, identité,
archives, corrections, notes du parent et absence de notification sont couverts.
Compléter par `bun run test` et `bun run build` avant publication. Ce lot n’écrit
aucun fichier du tableau `/etat-candidatures` géré par le chantier UI parallèle.

Références Google consultées : [événement de soumission Sheets](https://developers.google.com/apps-script/guides/triggers/events#form-submit),
[UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app),
[PropertiesService](https://developers.google.com/apps-script/reference/properties/properties-service).
