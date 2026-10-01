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

Le rattachement manuel est distinct : bloc `[EUNEOS_GOOGLE_REVIEW_V1]` avec
`version,sourceKey,target:{kind:'school'|'trainer',id,label},actor,at,reason,
action:'attachment-only',id` puis `[/EUNEOS_GOOGLE_REVIEW_V1]`.
L’identifiant cible est celui de la **participation annuelle** ou du **parcours
formateur**, pas la fiche personne/établissement. La sélection montre les noms,
la ville ou l’email, la cohorte et le code. Aucun dossier n’est préselectionné.

## Garanties et limites

Les écritures touchent uniquement `detail_reprise`. `statut_reprise` est inchangé :
ses éventuels choix NocoDB ne sont pas supposés. Les réponses, noms, dates,
statuts métier et liens métier ne sont jamais réécrits. L’historique complet
précédent et la nouvelle valeur sont conservés dans le registre D1 privé.

Une empreinte de la source et une relecture avant écriture détectent les
modifications depuis l’affichage. Une réservation D1 unique par réponse empêche
les confirmations concurrentes depuis cet écran. Toute erreur après réservation
conserve le reçu pending : pas de nouvelle tentative automatique, pas d’expiration
silencieuse. Un contrôle opérateur doit comparer before/after et la source pour
régler ces cas. Une correction d’un rattachement existant nécessite ce contrôle.

NocoDB ne fournit pas de PATCH conditionnel ici : un autre système qui modifie
`detail_reprise` entre la dernière relecture et le PATCH peut encore concourir.
Coordonner les reprises historiques/collecteurs avec ce registre ; ne pas lancer
une réécriture concurrente de la même ligne. La relecture après PATCH confirme la
valeur enregistrée, sans transformer ce PATCH en transaction multi-système.

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
