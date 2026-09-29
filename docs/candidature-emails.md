# Emails des candidatures établissements

Ce lot ajoute l’écran privé **Décision et emails**, accessible depuis chaque dossier
du suivi, et son registre durable dans le binding D1 `FORM_SUBMISSIONS`.
Une décision future exige un aperçu et une confirmation explicite ; le responsable
choisit de l’enregistrer sans email ou de prévenir le référent avec un modèle validé.
Ce lot ne migre aucun statut historique, ne crée aucun hook NocoDB, ne modifie pas
GAS et ne rattrape aucun ancien accusé ou ancienne décision.

## Sources et contenus

Le site envoie déjà un AR après un nouveau dépôt. Son texte est conservé :
« EUNEOS a bien reçu votre candidature WISE-UP », dossier enregistré puis étudié.
Le modèle NocoDB `accuse_etab` est distinct ; il n'est pas substitué discrètement.
La table `templates_emails` contient les modèles établissement `accuse_etab`,
`lettre_interet`, `fiche_contact`, `form_deploiement`, `liste_participants`,
`bilan_etab`, `equipe_cand_etab`, et les questionnaires. Aucun modèle nommé
acceptation/refus **établissement** n'était présent dans la lecture du 29/09.
`refus_formateur` ne convient pas à cet usage.

Les deux textes de `candidature-mail-templates.ts` sont donc des **propositions**.
Sans configuration approuvée, l'API permet leur aperçu mais refuse confirmation
et envoi. La validation doit préciser le texte, sa version et sa référence
(décision/validation de l'équipe). Ne pas inventer de date, délai, pièce jointe,
lien vers une lettre ou motif de refus. L'acceptation ne certifie pas l'engagement.
Le contenu pérenne retenu doit également être consigné dans les modèles NocoDB
par leur propriétaire ; cette livraison n'en crée aucun.

## Accusé durable

Avec `CANDIDATURE_MAIL_REGISTRY_ENABLED=true`, la route publique remplace son
appel Brevo direct par le registre. L'extension optionnelle `beforeComplete` du
store prépare l'AR seulement après une **nouvelle** création NocoDB et la relecture
de ses liens, avant de marquer le dépôt terminé. Une préparation échouée laisse
le dépôt en vérification : ne pas le supprimer ni rejouer sa création.

Le trigger SQL local fait passer l'AR de `awaiting_receipt` à `queued` dans la
même instruction qui marque `form_submissions` terminé, phase `saved`. Il ne
parcourt aucune ligne historique. Les chemins `existing`/`existing_receipt`,
les imports et les changements de statut ne le déclenchent pas.

Le site tente ensuite d'envoyer cet AR. S'il s'arrête entre la fin du dépôt et
l'appel, la ligne `queued` reste reprenable par l'action interne `dispatch`.
Si l'arrêt a lieu avant la fin du dépôt, il faut contrôler le reçu en
`processing`/`review` et ses IDs ; aucune réparation de ces reçus n'est automatisée.

La branche historique reste en place si le registre est **absent ou false**,
uniquement pour un déploiement progressif. Une fois le registre activé, une
panne ne rebascule jamais sur l'ancien envoi. Pour suspendre ensuite les emails,
mettre **SEND_ENABLED=false et laisser REGISTRY_ENABLED=true**.

## Décision future : aperçu, confirmation et journal

L’écran `/interne/decision-candidature?dossier=<id>` est accessible depuis le suivi
privé des établissements. Le responsable prépare une acceptation ou un refus,
relit le dossier, le destinataire et le message, puis confirme explicitement
« Enregistrer sans email » ou « Enregistrer et envoyer ».

Le serveur vérifie la campagne active, les liens et l’absence d’archive ou de
participation concurrente pour le même établissement et la même cohorte. Il fige
un aperçu valable quinze minutes, avec l’identité de son auteur. Seuls les
dossiers « Candidature reçue » peuvent suivre ce parcours : aucune ancienne
acceptation, aucun refus et aucun statut « à qualifier » n’est rejoué.

`candidature-decision.ts` réserve l’opération dans D1, relit le dossier et ne
modifie que son statut dans NocoDB. Il vérifie ensuite le statut et les autres
champs avant de confirmer puis tenter l’envoi demandé. Le service mail ne
modifie jamais NocoDB. Une édition manuelle dans NocoDB ou par `scripts/base.mjs`
ne déclenche aucun email.

Les écritures exigent `CANDIDATURE_DECISIONS_ENABLED=true`,
`CANDIDATURE_DECISION_WRITE_OWNER=site` et une référence d’examen du périmètre
concurrent dans `CANDIDATURE_DECISION_CONCURRENCY_REVIEW`. Le verrou D1 coordonne
le site et la passerelle Google ; il ne verrouille pas les utilisateurs externes
NocoDB. Vérifier les autres rédacteurs avant activation et conserver cette limite
dans le compte rendu d’exploitation.

Une écriture distante incertaine reste à vérifier : pas de nouvelle tentative ni
d’email automatique. L’historique distingue la décision enregistrée de l’état du
message. Un brouillon non appliqué peut être annulé par son auteur, puis préparé
à nouveau si le dossier n’a pas changé d’étape. Un email confirmé mais devenu
incompatible reste bloqué ; aucun contenu n’est remplacé silencieusement.

## API interne

`/api/interne/candidature-emails` utilise l'identité Cloudflare Access de
l'équipe. GET accessible à l'équipe ; POST réservé à `INTERNAL_ADMIN_EMAILS`,
JSON et même origine obligatoires. Aperçus `pages.dev` : aucune écriture ni mail.
Ni clé API navigateur, ni nouveau secret de hook. Réponses privées, non mises en cache.

- GET `?participationId=7` : journal de ce dossier, contenu figé et preuve fournisseur.
- POST `{"action":"prepare","participationId":7,"kind":"accepted"}`
  (ou `refused`) : crée un aperçu, sans modifier le statut ni envoyer.
- POST `{"action":"confirm","id":"identifiant","previewHash":"EMPREINTE","confirm":true}` :
  exige le statut décidé et relu, puis met en attente, **sans envoyer**.
- POST `{"action":"dispatch","id":"ID","confirm":true}` : tentative d'envoi.
- POST `{"action":"reconcile","id":"ID"}` : lit les preuves Brevo et met à jour
  le journal ; aucun envoi. `not_found` n'autorise jamais un renvoi.
- POST `{"action":"retry-rejected","id":"ID","confirm":true}` : remet en attente
  un **rejet explicite** seulement ; il faut ensuite `dispatch`.
- POST `{"action":"cancel","id":"identifiant"}` : annule un brouillon non envoyé de son auteur.

Les identifiant, dates, auteurs, source et contenus sont fixés côté serveur. Une charge
NocoDB `data.rows`/migration n'est pas une commande acceptée. Une préparation
concurrente de décisions opposées est refusée. Pour un dossier, un même type
d'email non annulé ne peut pas être recréé avec une autre clé.

## Preuves et limites de livraison

Quatre tables : `candidature_decisions` (aperçu et résultat de décision),
`candidature_mails` (intention + contenu + IDs),
`candidature_mail_attempts` (chaque tentative) et `candidature_mail_events`
(événements fournisseur dédupliqués). Le contenu et le destinataire sont privés.
Cela étend le registre technique D1 antérieur : le journal email y contient
maintenant des données personnelles, avec les mêmes restrictions de l'espace
interne. Pas de copie dans Git, logs ou journal NocoDB non relié.

- Un `UPDATE … WHERE state='queued' RETURNING id` arbitre les Workers.
  Un trigger crée la tentative dans la même instruction SQL.
- Le POST Brevo contient un tag opaque propre à la tentative. Le `messageId`
  reçu est conservé. `accepted` signifie accepté par Brevo, **pas livré**.
- Timeout, HTTP 5xx, JSON invalide, absence de `messageId` : `uncertain`.
  Worker interrompu ou écriture du résultat perdue : `sending` peut rester.
  **Ces états n'expirent pas vers une nouvelle tentative.**
- Seuls les rejets HTTP explicites 400/401/403/404/422/429 sont `rejected`.
  Leur remise en attente est explicite, pas une boucle de réessais.
- Le rapprochement lit `/smtp/statistics/events` avec tag, email et éventuellement
  `messageId`, puis contrôle les valeurs et dates retournées. Deux messages
  différents pour une tentative imposent une vérification. Les preuves positives
  peuvent résoudre un état incertain ; l'absence de preuve ne le résout pas.
- `provider_state=delivered` est une preuve fournisseur distincte ; les ouvertures
  ne sont pas utilisées. Les erreurs ou rebonds sont conservés, sans renvoi.

Il n'y a **pas de garantie exactly once** : D1, NocoDB et Brevo ne partagent pas
une transaction, et le contrôle NocoDB avant l'envoi n'est pas un verrou sur
les éditions humaines. Un changement peut intervenir après cette relecture.
Les interruptions inconnues privilégient une vérification à un envoi en double.
Le registre ne déduplique pas les emails envoyés hors site par GAS ou une boîte
manuelle. C'est pourquoi la propriété exclusive du transport doit être réglée
avant activation. La consultation Brevo est limitée à la fenêtre du fournisseur
(maximum 90 jours) ; au-delà, rapprochement manuel, jamais renvoi automatique.

## Installation et activation

1. Examiner le diff, les propositions de texte et l'intégration au parcours de
   statut. L’activation des envois doit rester conforme aux contenus et au périmètre validés.
2. Sauvegarder D1 et préparer l’application contrôlée de
   `0007_candidature_mails.sql` et `0008_candidature_decisions.sql` avant activation.
   Le pipeline actuel migre **TEAM_WORKSPACE uniquement**. FORM_SUBMISSIONS est
   actuellement commun aux previews et à la production : aucune séparation
   preview/production ni application automatique de ces deux SQL n’est acquise.
   Répéter les migrations sur une copie locale et vérifier les versions distantes
   avant toute intervention ; aucun backfill ni rejeu aveugle.
3. Publier le code avec les nouveaux flags absents/false. Le site garde alors
   son ancien AR ; les nouvelles routes restent désactivées. Le SQL seul ne
   crée aucun email. Les modes de preview restent sans envoi.
4. Auditer les triggers et files Google (notamment `action_email`,
   `onEditEtabsCandidats`, `sendTemplate('accuse_etab',…)`, `viderFileEmails`,
   `checkRelances`), leurs éléments déjà en attente et les notifications NocoDB.
   Arrêter/vider ou exclure les envois candidats transférés avec leurs propriétaires.
   Le hook **after insert vers l'équipe** est distinct et reste à l’équipe.
5. Activer en un déploiement coordonné :
   `CANDIDATURE_MAIL_REGISTRY_ENABLED=true`, `CANDIDATURE_MAIL_SEND_ENABLED=false`,
   `CANDIDATURE_MAIL_OWNER=site`. Garder `CANDIDATURE_DECISION_SEND_ENABLED=false`
   jusqu’à la validation des modèles. Les nouveaux dépôts préparent alors le seul AR
   géré par le site, sans POST Brevo. Vérifier un parcours de recette autorisé.
6. Configurer `CANDIDATURE_DECISION_TEMPLATES` si les deux contenus sont approuvés.
   JSON objet `accepted`/`refused`, chacun avec `version`, `approvalRef`, `subject`,
   `text` ; substitutions autorisées `{{etablissement}}` et `{{cohorte}}`.
   Une entrée absente reste une proposition non envoyable. Le registre doit être
   activé dans le runtime déployé, pas seulement dans une configuration non publiée.
7. Après validation du propriétaire unique et d'un destinataire de recette,
   activer `CANDIDATURE_MAIL_SEND_ENABLED=true` pour les nouveaux accusés et
   `CANDIDATURE_DECISION_SEND_ENABLED=true` pour les décisions explicitement
   confirmées, puis vérifier `messageId` puis
   l'événement `delivered`. La recette réelle est distincte des mocks.
   Les lignes `queued` préexistantes exigent une lecture avant `dispatch` ; aucune
   ancienne acceptation ni accusé sans preuve ne doit être mis artificiellement en file.
8. Suspension : SEND_ENABLED=false, garder REGISTRY_ENABLED=true et toutes les
   tables/preuves. Ne pas revenir au code antérieur qui envoie hors registre.
   Une désactivation n'annule pas un POST fournisseur déjà parti.

Aucun cron, hook de décision, configuration Cloudflare, modèle NocoDB ou email
réel n'est installé/exécuté par ce patch. Les dates métier incertaines restent
hors du contenu des messages.

## Vérifier localement

```sh
bun test tests/candidature-mail.test.ts tests/candidature-mail-routes.test.ts
bun scripts/check-candidature-mails-d1.mjs
bun run test
bun run build
bun scripts/check-candidature-decisions-ui.mjs
```

Le script D1 refuse les arguments ; base fictive temporaire, `--local` explicite,
aucune clé ni adresse réelle. Les tests simulent tout le transport réseau.

Références fournisseur : [envoi transactionnel Brevo](https://developers.brevo.com/reference/send-transac-email),
[événements transactionnels](https://developers.brevo.com/reference/get-email-event-report).
