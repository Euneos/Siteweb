# Accord formateur public

## Périmètre livré

- Lien commun `/suivi/accord-formateur`, sans lien personnel ni compte Google.
- Six questions obligatoires et huit clauses intégrales de l’accord WISE-UP 2026/27, lus dans la source rendue le 1 octobre 2026. Aucun identifiant Google, compte privé ni URL éditeur dans le code.
- Aucun choix, signature ou date prérempli. Le formateur remplit lui-même. Le choix « Non » est conservé sans signer. La signature simple reste une déclaration du répondant, pas une authentification forte de sa personne.
- `POST /api/questionnaires/accord-formateur` : même origine, JSON strict/version, limites de texte/corps, piège robot, limitation du registre public. Aperçus sans écriture ni email.
- Source complète et contrat exact/versionné conservés, puis seuls `accord_signe` et `date_accord` peuvent être reportés sur un parcours existant. Aucun formateur/parcours créé ; statut, email, candidature et cohorte intacts.

Le bilan formateur est livré dans un commit complémentaire documenté dans `docs/bilan-formateur.md`, avec contrat privé de mission audité (année + dossier + formateur). Ne pas utiliser le plan Google historique `bilan_formateur` linkOnly comme preuve de report métier.

## Configuration privée et circuit

En plus de `OPERATIONAL_FORMS_ENABLED=true`, `FORM_SUBMISSIONS`, `NOCODB_TOKEN` et `PUBLIC_FORMS_TABLE` existants :

- `ACCORD_FORMATEUR_PERSON_PROJECTION` : JSON `PersonProjectionConfig` audité de la source Google `accord_formateur` ; aucune clé secrète dans le JSON.
- À défaut uniquement, rechercher **exactement une** configuration `personProjection.family=accord_formateur` dans les tableaux JSON `SOURCES`, `SOURCES_2` … `SOURCES_12`, contigus sans trou. Une configuration dédiée invalide ne retombe pas sur SOURCES.
- Exiger `family: accord_formateur`, `fixedCohort: null`, `cohorts: [{id:null}]`, `agreementAnswer: Oui`, les deux tables auditées `people` (formateurs) et `records` (parcours), aucun `businessFields`, aucun `createMissingAdults`.
- Les sélecteurs et le digest de la source doivent passer `validatePersonConfig`; le site adapte ensuite seulement ses sélecteurs : `receivedAt`, `email`, `firstName`, `lastName`, `agreement`, `agreementDate`, et conserve `signature` sans la projeter.
- NULL est le périmètre explicite actuel. Le titre 2026/27 n’assigne **aucune année**. Une cohorte future non NULL exige une évolution auditée du contrat et de ses tests.
- Migration additive **`migrations/0012_accord_formateur.sql` dans FORM_SUBMISSIONS**, après 0009 ; indépendante de 0010 pré-A et 0011 B/J45. Ne pas l’appliquer à TEAM_WORKSPACE. Les pages et API refusent la collecte (503) sans configuration/schéma. Le parent applique le circuit FORM_SUBMISSIONS documenté, pas le manifest TEAM_WORKSPACE.
- Aucun secret ni activation de production fournis par ce commit. Lien et lecture du catalogue intégrés dans le commit de raccord ; le parent conserve les dispatchers pré-A/B/J45 lors du cherry-pick.

## Identité, preuve et reprise

1. Le digest des six réponses normalisées + contrat complet/version est la clé de réception. D1 conserve le payload et fige `received_at` avant le POST du journal NocoDB. Une reprise le lendemain ne redéfinit pas cette date.
2. Le journal est créé une fois, puis relu intégralement. Une réponse HTTP perdue est réconciliée par `cle_reponse`, jamais par un nouveau POST aveugle. Aucun enum `statut_reprise` n’est supposé. `detail_reprise` initial indique la nécessité de vérifier le registre ; **aucun PATCH ultérieur du journal** ne peut écraser un reçu historique.
3. Seuls un « Oui », une signature nominale concordante (nom/prénom dans l’un des deux ordres), une identité exacte unique, un inventaire complet, un parcours unique non fusionné réellement NULL et une date valide non future permettent le plan PR38. Les ambiguïtés ou valeurs existantes différentes restent `review`.
4. Plan avant/après durable et claim par table+parcours. Lease uniquement pour préparer ; propriétaire SQL vérifié juste avant l’écriture. Identité, unicité et valeurs relues. PATCH exclut toute valeur déjà égale, donc une date existante identique n’est pas réécrite.
5. Marqueur `writing` posé avant PATCH. Une reprise de ce marqueur fait uniquement des lectures, jamais une seconde tentative d’écriture. La perte de réponse après un succès est résolue par relecture exacte. Sans preuve, `review` ou `writing` demeure visible, claim conservé. Une configuration modifiée ne replannifie pas silencieusement une ancienne réponse.
6. `complete/agreement_verified` signifie uniquement que l’accord et la date ont été relus dans le parcours à cet instant. Cela ne signifie ni validation du formateur, ni formation réalisée, ni affectation à une mission. Les autres réponses et le texte contractuel demeurent dans le journal/D1.

NocoDB n’offre pas de CAS ici : les contrôles relisent juste avant le PATCH et après, mais ne peuvent interdire une modification humaine simultanée entre ces lectures. Les clients concurrents du site sont sérialisés par le claim durable ; une incertitude ne libère pas automatiquement ce claim. Aucune purge/reprise manuelle d’un claim ne doit être faite sans vérification de la requête distante et du dossier.

## Lecture équipe / intégration parent

`GET /api/interne/accords-formateurs` utilise l’authentification équipe Cloudflare Access existante, jamais l’audience ressources formateurs. Renvoie au plus 100 réponses (récentes en premier), ou `?receipt=<64 hex>` pour une réception précise ; no-store/noindex. Aucun GET public de statut ou d’identité.

Chaque résultat contient : `receipt`, `receivedAt`, `state`, `code`, `source` (six réponses avec libellés et contrat intégral) ; `verifiedProjection` n’existe que pour `complete` et contient `{trainerId, journeyId, agreementDate}`. Pour les autres états : `verifiedProjection:null`. Le message rappelle la distinction entre réception et report vérifié. Les IDs sont dans les tables privées configurées, **pas** dans la table des participations établissements : ne pas traiter `journeyId` comme un dossier établissement. Ne pas annoncer « intégré » à partir du seul `public_form_receipts`, d’un ancien statut de journal ou d’une capture seule.

La réponse publique est volontairement uniforme : « réponse enregistrée » après réception durable et décision vérifiée/review. Elle ne révèle pas si le formateur ou son parcours existent. Une vérification encore en cours propose de revérifier la même réception. Le navigateur fige le payload après un envoi incertain et conserve la saisie ; pas de refresh, pas d’email.

## Vérifications locales

- `bun test tests/accord-formateur.test.ts` : contrat, refus, signature, date, cohortes, identités ambiguës, valeurs existantes, concurrence, config, réponse perdue, source/plan immuables, privacy, auth et limite.
- `bun run build`.
- `bun scripts/check-accord-formateur.mjs` : vrai site/API compilés, SQLite en mémoire, transport NocoDB et JWT fictifs ; interdit tout réseau extérieur. 320/390/768/860/861/1024/1440 px, contrat entier, contrôles vierges, double envoi et reprise, preuve privée, indisponibilité sans config. Captures et `result.json` dans `/tmp/euneos-accord-qa` par défaut.
- Aucune recette ne charge `.dev.vars`, n’utilise un secret de production ou n’envoie de mail.

### Hook commun obligatoire avant activation

Le commit de raccord coordonné avec Pasteur ajoute dans `listPublicForms`, **avant** d’accéder à `source.answers.referrer`, l’appel :

```ts
const agreement = await accordCatalogueEntry(db, row, source)
if (agreement) return agreement
```

Import depuis `./accord-formateur-catalogue` et callback asynchrone enveloppé dans `Promise.all` (déjà fait par le lot pré-A). Le helper vérifie le payload exact face à D1 avant d’afficher « Accord vérifié ». `participationId` reste toujours NULL. Conserver ce hook et le lien catalogue lors de l’intégration avant activation : le lecteur historique de la table commune suppose sinon des réponses `OperationalInput` et ne sait pas interpréter ce questionnaire. Le GET privé dédié fonctionne indépendamment et expose le contrat complet.
