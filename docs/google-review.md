# Revue manuelle des réponses Google

Page `/interne/reponses-google`, API `/api/interne/reponses-google`.
Accès équipe Cloudflare Access vérifié à l’origine, réponses privées sans cache,
aucun accès depuis les previews publiques. Seuls les responsables configurés dans
`INTERNAL_ADMIN_EMAILS` peuvent confirmer. POST JSON exige Origin exact et refuse
Sec-Fetch-Site cross-site. Aucun envoi d’email ni projection métier.

## Configuration et activation par le parent

- `GOOGLE_REVIEW_JOURNAL_TABLE` : ID de la table du journal Google (aucun défaut).
- `NOCODB_TOKEN`, `TEAM_WORKSPACE`, paramètres Access déjà existants.
- `migrations/interne/0005_google_review_attachments.sql` ajoute le registre via
  le circuit `docs/internal-migrations.md` (preview puis production avant Pages).
  La page est reliée à la navigation interne, sous « Réponses Google ».

Le manifeste de migration est calculé automatiquement :
`bun scripts/internal-migrations.mjs list` doit inclure 0005 et son SHA256.
Ne pas modifier `internal-migrations-history.json` : il fige uniquement le socle
0001–0004 déjà adopté. Aucune migration n'est exécutée à la volée par la page.

## Contrat des preuves de reprise

Préserver le texte existant de `detail_reprise` et ajouter un bloc :

```text
[EUNEOS_GOOGLE_RECONCILIATION_V1]{"version":1,"sourceKey":"valeur exacte de cle_reponse","targets":[{"table":"identifiant table ou nom métier","id":123,"fields":["champ effectivement vérifié"]}],"state":"partial","reasons":["Champ restant à vérifier"],"at":"2026-10-01T12:00:00.000Z"}[/EUNEOS_GOOGLE_RECONCILIATION_V1]
```

`state` vaut `integrated`, `partial` ou `pending`. Le dernier bloc valide lié à la
bonne `cle_reponse` fait foi. Aucun statut libre historique (« Source conservée »
inclus) ne prouve l’intégration. La vue indique « Intégration non attestée » en
l’absence de reçu valide ; elle ne prétend pas que rien n’a été importé.

## Contrat du rattachement et lecture par l’API / Stella

Le rattachement manuel est distinct de la preuve d’intégration. Il est désormais
conservé **uniquement dans D1 `google_review_attachments`**, pas dans le journal
NocoDB. Le JSON `audit_json` garde le contrat version 1 :
`version,sourceKey,target:{kind:'school'|'trainer',id,label},actor,at,reason,
action:'attachment-only',id`.

L’identifiant cible est celui de la **participation annuelle** ou du **parcours
formateur**, pas la fiche personne/établissement. La sélection montre les noms,
la ville ou l’email, la cohorte et le code. Aucun dossier n’est préselectionné.

`GET /api/interne/reponses-google`, avec l’authentification équipe habituelle,
combine les preuves NocoDB et les audits D1. Chaque `rows[]` expose :

- `attachment` : audit D1 `complete` validé et lié à la même `sourceKey`, sinon
  ancien marqueur NocoDB valide, sinon `null` ;
- `operation` : état et audit du registre ; un ancien `pending`, un audit illisible
  ou un lien source incohérent reste à contrôler et ne prouve pas un rattachement ;
- `receipt`, `state`, `resolvedTargets` : preuves d’intégration du journal,
  indépendantes du rattachement. Un audit D1 `complete` ne signifie jamais que
  les champs métier ont été intégrés.

Stella et les lecteurs doivent utiliser cette API authentifiée pour voir les
nouveaux rattachements ; lire uniquement `detail_reprise` ne suffit plus.
L’interface explique que le rattachement est conservé dans l’espace interne.
Les anciens blocs `[EUNEOS_GOOGLE_REVIEW_V1]` restent lisibles, sans réécriture.

## Garanties et concurrence

**Aucune écriture NocoDB** : ni `detail_reprise`, ni statut, réponse ou champ métier.
Après vérification du dossier et relecture de la version de la source, un INSERT
D1 atomique crée directement l’audit en état `complete`. La contrainte unique par
`journal_id` arbitre les confirmations concurrentes. Le schéma de la migration
0005 reste inchangé et aucune migration supplémentaire n’est requise.

`before_detail` et `after_detail` conservent tous deux la même dernière valeur lue
avant l’INSERT : le journal n’est pas modifié. `audit_json` contient le nouveau
rattachement. Ce sont des instantanés de provenance, pas des valeurs à réappliquer
au journal. Un reçu ajouté par le collecteur pendant ou après l’enregistrement
n’est jamais remplacé par la page. L’actualisation relit ses nouvelles preuves.

Si la source change avant la dernière validation, réponse 409 sans réservation :
l’utilisateur peut actualiser, relire et confirmer à nouveau. Si la réponse D1
est perdue après le commit, l’actualisation retrouve l’audit ; une répétition reçoit
409 et ne remplace pas le premier rattachement. Si D1 n’a rien enregistré, une
nouvelle confirmation reste possible. Pas de retry automatique du POST.

Les anciens `pending` issus du protocole avec PATCH NocoDB ne sont ni supprimés
ni promus automatiquement : le résultat ancien peut être incertain. Ils restent
bloqués jusqu’au contrôle opérateur de leurs instantanés et du journal. Une
correction d’un rattachement enregistré nécessite également ce contrôle.

## Filtres et décompte

La sélection initiale « À examiner » comprend `pending`, `unknown` et toute
opération D1 `pending`, sans doublonner une entrée. Les intégrations `partial`
ont leur propre filtre ; elles restent aussi dans « À examiner » si leur
confirmation est incertaine. Les deux autres choix sont « Intégrations attestées »
et « Toutes les entrées ». Les compteurs comptent les entrées et leurs versions
conservées, jamais les personnes ou dossiers uniques. Les titres n’affichent que
« Réponse #ID » ; le nom brut du formulaire reste consultable dans le détail.

Le client reprend la temporisation 650 ms et les reprises explicites 429 du
collecteur, dont le client n’est pas exporté. Requêtes séquentielles, trois essais
maximum, Retry-After borné à dix secondes, aucun retry de timeout/5xx écriture,
aucun suivi de redirection avec le jeton. Il n’y a pas de polling automatique.

## Recette compilée sans compte ni donnée de production

Après `bun run build`, lancer `bun scripts/check-google-review.mjs`. Le serveur
local utilise les pages/API compilées, un JWT fictif signé localement, toutes les
migrations en SQLite mémoire et des réponses NocoDB simulées. Toute requête
externe non prévue fait échouer la recette. Contrôles à 390 et 1440 px, confirmation,
double envoi, noms des dossiers dans les reçus, filtres, accès et captures.
`CHECK_SCREENSHOTS` et `GOOGLE_REVIEW_TEST_PORT` personnalisent sortie/port.
