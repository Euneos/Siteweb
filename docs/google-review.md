# Revue manuelle des réponses Google

Page `/interne/reponses-google`, API `/api/interne/reponses-google`.
Accès équipe Cloudflare Access vérifié à l’origine, réponses privées sans cache,
aucun accès depuis les previews publiques. Seuls les responsables configurés dans
`INTERNAL_ADMIN_EMAILS` peuvent confirmer. POST JSON exige Origin exact et refuse
Sec-Fetch-Site cross-site. Aucun envoi d’email ni projection métier.

## Configuration et activation par le parent

- `GOOGLE_REVIEW_JOURNAL_TABLE` : ID de la table du journal Google (aucun défaut).
- `NOCODB_TOKEN`, `TEAM_WORKSPACE`, paramètres Access déjà existants.
- Ajouter cette table **par une nouvelle migration TEAM_WORKSPACE**, via le circuit
  `docs/internal-migrations.md`, avant activation. Ne pas créer la table à la volée.
  Ce chantier fournit le SQL ici pour intégration par le parent, sans déploiement :

```sql
CREATE TABLE google_review_attachments (
  journal_id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','complete')),
  audit_json TEXT NOT NULL,
  before_detail TEXT NOT NULL,
  after_detail TEXT NOT NULL
);
```

Le parent doit ajouter le lien à la navigation ou au catalogue des formulaires
(ces fichiers sont volontairement hors du périmètre de ce chantier).

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
