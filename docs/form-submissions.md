# Candidatures publiques : déduplication et reprise

Les deux endpoints réutilisent `src/lib/candidature-store.ts`. Une soumission
publique formateur est unique pour un email normalisé, toutes cohortes confondues.
Pour un établissement, elle reste unique par nom, code postal, ville et cohorte
active. Ce rapprochement ne prétend pas résoudre les alias ou changements
d’adresse. Le suivi des reprises de formation reste une opération de l’équipe.

Le registre Cloudflare D1 `euneos-form-submissions`, binding `FORM_SUBMISSIONS`,
contient uniquement une clé SHA-256, le type de formulaire, la cohorte, les IDs
NocoDB, l’état, l’étape et les dates techniques. Pour les nouveaux reçus formateurs,
`cohort_id = 0` désigne la portée permanente de la clé, jamais une cohorte NocoDB.
Il ne duplique ni coordonnées,
ni réponses du formulaire. Il est accessible uniquement au serveur.

Un INSERT avec clé primaire arbitre les requêtes simultanées entre Workers.
Les lectures et écritures passent par le primaire D1 (pas de Sessions API).
Il n’y a pas de verrou mémoire, ni d’expiration qui relancerait une écriture
NocoDB dont la réponse s’est perdue. Les appels SQL utilisent des paramètres.

Avant de créer, la lecture paginée de NocoDB cherche une identité et un parcours
existant. Un unique parcours formateur est reconnu quelle que soit sa cohorte,
même absente, sans réaffecter sa session ni ses validations. Plusieurs identités
ou parcours formateurs passent à la vérification humaine. Pour les établissements,
le contrôle reste annuel et un parcours sans cohorte nécessite une vérification.
Une absence de cohorte active, ou plusieurs cohortes actives, refuse toute
nouvelle création, mais ne bloque pas la reconnaissance d'un formateur existant.
Une nouvelle année autorise une nouvelle participation établissement seulement.
Aucun statut existant n’est écrasé par une nouvelle soumission.

Les anciens reçus formateurs par cohorte sont également contrôlés avant toute
création : leurs clés sont recalculées pour l'email soumis, à partir des cohortes
conservées dans D1 (y compris une cohorte retirée depuis de NocoDB). Un ancien
reçu `processing` ou `review` bloque la demande même si son ID métier est inconnu.
Un reçu `complete` empêche un nouvel enregistrement et un nouvel accusé. Aucun
reçu historique n'est supprimé ou modifié lors de ce changement de portée.

Après création, les liens identité/cohorte sont relus avant le succès. Le reçu
est marqué `complete` avant l’accusé de réception Brevo : une répétition ne
renvoie pas d’email. Une interruption à cet instant peut laisser un dossier sans
accusé ; l’équipe peut vérifier sa livraison. Ce n’est pas un envoi garanti.
Les notifications NocoDB déjà configurées restent celles du produit.

## Déploiement

La base est créée dans le compte Cloudflare EUNEOS, juridiction UE. Le schéma
versionné se trouve dans `migrations/`. Appliquer toute migration avant de
publier le code qui l’utilise :

```sh
bunx wrangler d1 migrations apply euneos-form-submissions --remote
```

Le binding est versionné dans `wrangler.toml` et le déploiement Pages usuel le
reprend. Sans ce binding, le serveur refuse l’enregistrement explicitement.
Les previews court-circuitent les écritures avant l’accès à D1/NocoDB/Brevo.
Ne pas utiliser de vrais candidats pour un test : les hooks de création et les
accusés enverraient des emails.

## Reprise d’un incident

Lister les demandes à vérifier depuis un poste autorisé :

```sh
bunx wrangler d1 execute euneos-form-submissions --remote --command "SELECT submission_key, form_type, cohort_id, state, phase, parent_id, record_id, created_at, updated_at FROM form_submissions WHERE state != 'complete' ORDER BY created_at"
```

- `processing` récent : une requête peut encore être active. Ne rien débloquer
  pendant son exécution. Une ancienne demande `processing` peut provenir d’un
  arrêt du Worker et nécessite la même vérification que `review`.
- `review` : une création ou liaison peut avoir réussi malgré une réponse perdue.
  Relire les IDs connus dans NocoDB, leur année et leurs liens. Ne pas supprimer
  une identité en cascade, ni relancer aveuglément le POST initial.
- Si l’ID d’une création est inconnu, utiliser sa fenêtre de création, puis
  recalculer la clé avec les coordonnées de la fiche candidate et la portée du
  reçu (`cohort_id`, zéro pour la nouvelle clé formateur ; `submissionKey` dans
  le store) pour vérifier la correspondance.
- Quand le parcours et ses deux liens sont prouvés, réparer uniquement les liens
  manquants puis marquer le reçu `complete` avec les bons IDs. Une suppression
  du reçu n’est permise qu’après preuve qu’aucune écriture n’a eu lieu et qu’aucun
  Worker ne travaille encore dessus. Consigner l’opération dans le dossier client.

Les erreurs de lecture avant toute mutation libèrent automatiquement le reçu.
Les reprises de formation volontaires et les candidatures à compléter sont
traitées par l’équipe ; elles ne justifient pas de supprimer l’historique.

## Vérification

`bun run test` exécute les tests sur le schéma SQL réel avec SQLite et un serveur
NocoDB simulé : concurrence, relecture, changement d’année distinct par type,
reprise formateur sans cohorte, anciens reçus incertains, identité ambiguë,
réponse perdue après écriture, lien non persisté et panne de lecture. Aucun email
ni écriture dans la base métier ne part des tests. Compléter par le build Astro
et les contrôles de formulaire sur la preview avant publication.

Références : [requêtes préparées D1](https://developers.cloudflare.com/d1/worker-api/prepared-statements/),
[cohérence des lectures D1](https://developers.cloudflare.com/d1/best-practices/read-replication/).
