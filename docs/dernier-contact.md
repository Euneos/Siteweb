# Dernier contact / relance

La colonne du suivi présente le dernier e-mail **envoyé retrouvé** dans la boîte
Charlotte@euneos.fr, pas une relance planifiée ni une preuve de livraison.
Les envois collectifs comptent lorsque le destinataire est vérifié (y compris Bcc).
Un échange avec un formateur compte uniquement lorsque le contenu concerne
explicitement le dossier, et porte le libellé « Échange avec le formateur ».
Une adresse commune à plusieurs établissements ne suffit pas à rattacher un mail.

## Source et actualisation

Les métadonnées vérifiées sont conservées dans les notes de la participation
courante, entre `[EUNEOS_LAST_CONTACT_V1]` et `[/EUNEOS_LAST_CONTACT_V1]`.
Le JSON version 1 contient :

- `account`, `checkedAt` (ISO UTC) et `status` : `found`, `not_found`, `ambiguous` ;
- si `found` : `sentAt` (ISO UTC), `subject`, `mailbox`, `uid`, `messageId`,
  `via` (`etablissement`, `formateur` ou `collectif`).

Les corps des messages et les listes de destinataires ne sont pas copiés dans le
site. L'actualisation se fait sur demande, en relisant les mails envoyés avec les
outils de messagerie, puis les notes courantes avant toute écriture. Préserver
les autres notes, remplacer uniquement ce bloc et relire après écriture.
Ne pas interpréter `not_found` comme la preuve qu'aucun contact n'a jamais eu lieu.

Le lecteur rejette les blocs dupliqués, incomplets, les dates invalides et les UID
invalides. Il ne reprend aucun lien fourni dans les notes : il construit un lien
Roundcube Viaduc à partir du dossier IMAP et de l'UID, selon le client Viaduc.
Le lien est affiché seulement à Charlotte, car l'UID dépend de son compte ; les
autres membres voient la date et l'objet, avec « Message dans la boîte de Charlotte ».
Le webmail demande sa propre connexion. Un déplacement du mail nécessite de
retrouver son UID et dossier actuels à partir du Message-ID.

## Point de situation issu des échanges

Un résumé relu peut être conservé séparément dans `[EUNEOS_SITUATION_V1]` /
`[/EUNEOS_SITUATION_V1]` : `version: 1`, `text`, `checkedAt`, `sourceAt`,
`sourceKind` (`mail-envoye` ou `echange-interne`) et `sourceMessageIds` (1 à 5).
Les dates sont ISO UTC. Ce bloc remplace le résumé automatique pour le dossier,
avec la date de la source affichée. Un abandon/refus reste prioritaire ; un
nouvel envoi postérieur au résumé rétablit le résumé automatique jusqu’à relecture.
Un échange interne ne remplace pas la date du dernier contact extérieur.
Les brouillons ne sont ni des envois ni des relances en retard : ne pas les importer.

Contrôles : `bun test tests/dernier-contact.test.ts`, compilation, puis
`bun scripts/check-internal-table.mjs` pour les colonnes et le rendu mobile.
