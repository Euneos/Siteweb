# Réponses à vérifier — transition Google Forms

Page privée `/interne/reponses-google`, API `/api/interne/reponses-google`.
Le suivi quotidien reste dans `/etat-candidatures`. Cette page permet de comprendre
les réponses Google en attente, puis de corriger les champs vérifiables dans NocoDB.
Elle ne constitue pas une deuxième base ni une preuve que tout le questionnaire a
été intégré.

## Parcours équipe

La liste affiche l’identité et l’établissement explicitement déclarés, le formulaire,
le motif restant et une action. Le détail remplace la liste ; le retour conserve les
filtres et la recherche. Un lien `#reponse-ID` ouvre directement un cas. La réponse
originale et les preuves restent consultables, sans interprétation des textes libres.

Un responsable choisit le dossier **annuel** et l’année, indique les valeurs confirmées
et la raison, puis ouvre un aperçu « actuellement → après correction ». La préparation
ne modifie pas NocoDB. Une seconde confirmation applique uniquement ces changements,
puis relit les valeurs. Le résultat et l’auteur sont conservés dans D1. Une correction
ciblée vérifiée ne transforme pas le reçu historique en intégration complète.

Cas pris en charge, sous réserve d’une correspondance source configurée et vérifiée :

- Fiche contact / organisation : dates de formation et confirmation de réception.
- Questionnaires adultes préformation, postformation, suivi J+45, évaluation : date
  de réception sur un participant existant, identifié sans ambiguïté dans le dossier.
- Accord formateur : accord explicitement donné et date source sur le parcours existant.
- Bilan établissement : réception sur le dossier annuel confirmé.

Aucune création de personne, aucun changement de statut, d’identité ou d’email, aucun
message envoyé. Une identité absente, contradictoire ou multiple est refusée. Les
questions pédagogiques restent conservées dans la réponse source. Si le cas n’est pas
corrigeable ici, une demande préremplie peut être copiée, sans envoi automatique.

## Accès et configuration

Cloudflare Access est vérifié à l’origine. Réponses privées sans cache, previews
publiques refusées. Seuls `INTERNAL_ADMIN_EMAILS` peuvent préparer/confirmer ; les
membres peuvent consulter. Le rôle est visible avant le choix d’une réponse. Chaque
POST exige Origin exact et refuse Sec-Fetch-Site cross-site. Aucun droit n’est élargi.

Configuration :

- `GOOGLE_REVIEW_JOURNAL_TABLE` : table du journal, sans valeur par défaut.
- `NOCODB_TOKEN`, `TEAM_WORKSPACE`, `FORM_SUBMISSIONS`, paramètres Access existants.
- `GOOGLE_REVIEW_CORRECTION_SOURCES` : configuration privée JSON de correspondances
  auditées `{label,family,mapping,headerDigest?,agreementAnswer?}`. Aucune correspondance
  n’est déduite d’un nom ressemblant. Sans configuration, lecture disponible mais
  corrections désactivées.
- Migration interne `0006_google_review_corrections.sql`, après `0005`, appliquée par
  le circuit habituel `docs/internal-migrations.md` avant déploiement Pages.

Ne pas modifier le socle `internal-migrations-history.json` ni lancer de migration à
la volée depuis une page. La recette utilise des correspondances et données fictives.

## Écritures et concurrence

Le plan privé D1 contient source, version, valeurs avant/après, gardes d’identité,
configuration, dossier, acteur et motif. Il expire après quinze minutes. La confirmation
revérifie source, configuration, schéma NocoDB, identité, unicité du dossier annuel et
valeurs actuelles. Un changement concurrent invalide l’aperçu. L’API accepte uniquement
les champs prévus par chaque famille ; elle ne reçoit aucun PATCH arbitraire du client.

Les réservations D1 commencent à la confirmation, pas à la préparation. Les écritures
utilisent le verrou du collecteur et les réservations des formulaires publics concernés.
Un résultat incertain reste réservé et suspend la collecte Google jusqu’à une vérification concluante. Ce blocage est signalé dans le résultat ; si la relecture ne prouve pas les valeurs attendues, un contrôle technique est nécessaire, sans lever les verrous à l’aveugle. Un seul PATCH est tenté : ni timeout ni réponse
inconnue ne provoquent une répétition. « Vérifier le résultat sans réécrire » relit NocoDB
et les gardes ; cette vérification appartient à l’auteur de l’opération. Le bouton ne
s’affiche pas pour un autre utilisateur.

La source Google et `detail_reprise` ne sont jamais réécrits par cette correction.
L’audit des corrections est séparé du reçu du collecteur. Les champs non concernés
restent inchangés. Une actualisation retrouve le résultat, sans réexécuter le PATCH.

## Preuves et compatibilité

Le collecteur conserve dans `detail_reprise` son reçu :

```text
[EUNEOS_GOOGLE_RECONCILIATION_V1]{"version":1,"sourceKey":"clé exacte","targets":[{"table":"table","id":123,"fields":["champ vérifié"]}],"state":"partial","reasons":["Point restant"],"at":"2026-10-01T12:00:00.000Z"}[/EUNEOS_GOOGLE_RECONCILIATION_V1]
```

Le dernier bloc valide lié à la bonne clé fait foi. Les statuts libres historiques
ne prouvent ni intégration ni absence d’intégration. `GET` combine `receipt`, `state`,
`resolvedTargets`, les anciens `attachment`/`operation` D1 et la dernière `correction`.
Les lecteurs, dont Stella, doivent consulter cette API authentifiée pour voir les
corrections. Lire seulement le journal brut omet les audits D1.

L’ancien POST de rattachement reste compatible : il enregistre uniquement un audit
D1 dans `google_review_attachments`. Il n’est plus proposé comme action de correction.
Les anciens états incertains ne sont pas promus automatiquement.

Les filtres comptent les entrées/versions, jamais les personnes uniques. Le filtre
initial comprend les reprises en attente, non attestées et anciennes confirmations
incertaines. Les reports partiels sont distincts : ils n’exigent pas tous une ressaisie.
Les corrections ciblées sont indiquées séparément sans effacer les motifs historiques.

## Validation

`bun test tests` puis `bun run build` et `bun scripts/check-google-review.mjs`.
La recette compile les pages/API réelles, signe un JWT fictif, applique les migrations
sur SQLite en mémoire et simule NocoDB. Toute requête externe inattendue échoue.
Contrôles à 320, 390, 768 et 1440 px : accès, filtres, retour, source échappée, aperçu,
confirmations, deux corrections avec relecture, audit restauré et rôle consultation.
`CHECK_SCREENSHOTS` et `GOOGLE_REVIEW_TEST_PORT` personnalisent sortie et port.
