# Préformation A : réponse publique et réception adulte vérifiée

Lot autonome basé sur PR38 : `/suivi/pre-formation` →
`POST /api/questionnaires/pre-formation` → source conservée au journal privé →
projection contrôlée sur l'adulte → catalogue interne.

Les 17 questions, descriptions, choix et obligations proviennent de la définition
répondant relue le 1er octobre 2026. Les preuves et les identifiants Google restent
dans le pilotage privé. Aucune donnée réelle ni correspondance établissement /
dossier / cohorte n'est dans le code public. L'email professionnel est déclaré ;
aucune authentification du répondant ou collecte du compte Google n'est simulée.

## Prérequis serveur, sans activation dans ce lot

- PR38 (`bce6c6c`) fournit `planGooglePerson`, `checkGooglePersonPlan` et le contrat
  `PersonProjectionConfig`. Ces modules sont réutilisés sans modification.
- Le journal `PUBLIC_FORMS_TABLE`, `NOCODB_TOKEN`, `FORM_SUBMISSIONS` et
  `OPERATIONAL_FORMS_ENABLED` restent les configurations existantes.
- Le binding site `FORM_SUBMISSIONS` doit viser **la même base physique D1** que
  `STATE` du Worker Google actif, avec la table existante
  `google_transition_person_claims` de `workers/google-transition/schema.sql`.
  Aucun reset, changement de clé ou remplacement de claim Google. La présence
  de la table est contrôlée avant collecte ; l’identité du binding est un
  prérequis de configuration à vérifier par le parent.
- Migration additive `0010_preformation_projection.sql` dans `FORM_SUBMISSIONS` :
  reçus de projection et revendications d'identités. Aucune migration NocoDB.
- Secret serveur **`PRE_FORMATION_PERSON_PROJECTION`** : copie exacte de l'objet
  `personProjection` déjà audité pour la famille `preformation_a` dans les sources
  privées du Worker. Il contient les tables, cohortes, alias d'établissements,
  dossiers confirmés et la politique `createMissingAdults`. Ne pas le versionner
  ni le transférer au navigateur.
- Variante : réutiliser les mêmes tableaux secrets `SOURCES`, `SOURCES_2`, …,
  `SOURCES_12` côté site. Les parties doivent être contiguës et contenir exactement
  une source `personProjection.family=preformation_a`. Le secret dédié, s'il est
  présent, prime ; un secret dédié invalide n'autorise pas un repli silencieux.

Le site adapte seulement les sélecteurs et le digest des questions : le timestamp
est celui du serveur, les champs sont les clés du formulaire site. Les tables,
cohortes, correspondances et autorisations de création viennent exclusivement du
même objet privé audité. Pas de correspondance par titre du Form, campagne active,
nom d'école approchant ou ordre supposé prénom/nom.

**Sans configuration valide ou sans migration, GET et POST sont indisponibles
(503), avant toute collecte.** Le lot ne peut pas ouvrir une collecte brute seule.
Aucun secret, réglage, migration distante ou déploiement n'est appliqué ici.

## Source, projection et reprises

1. La réponse normalisée réserve un reçu de contenu unique. La date `received_at`
   est inscrite une seule fois dans D1, avant capture NocoDB ; elle accompagne la
   source du journal et ne dépend jamais du jour du rejeu.
2. Les 17 couples libellé/réponse et la version sont conservés puis relus dans le
   journal NocoDB avant toute écriture métier. Deux contenus différents restent
   deux réponses. Un POST de capture incertain n'est jamais réémis à l'aveugle.
3. Le plan PR38 vérifie email et nom exacts, année et établissement explicitement
   configurés, relation à la participation et cohorte, et absence de fusion.
   Si l'adulte manque, seule la politique privée explicite autorise sa création,
   après recherche de collisions de noms dans le dossier. Le nom complet est
   conservé sans le découper ni attribuer un statut de formation.
4. Seul `date_pre_recu` est modifié pour un adulte existant. Une date différente
   devient un conflit explicite. Les réponses pédagogiques restent au journal ;
   elles ne deviennent ni notes de personne, ni scores, ni statut « formé ».
5. Le plan et son digest de configuration sont figés dans D1. Une revendication
   d'identité couvre création **et** mise à jour entre réponses distinctes du site.
   Une réservation atomique protège chaque reçu ; le jeton de possession est
   contrôlé avant de marquer l'écriture. Pour toute **création**, un second
   claim dans la table commune `google_transition_person_claims` utilise la clé
   complète du plan PR38 : `sha256(participationId + ':' + lowercaseEmail)`.
   Son `response_key` vaut `site-preformation:<receipt>` et reste durable.
   Un claim détenu par une autre réponse, Google ou site, interdit le POST ;
   seule une réception déjà relue conforme peut terminer sans nouvelle écriture.
6. Les identités, relations et anciennes valeurs sont relues avant écriture.
   Le marqueur `writing` est durable avant le POST/PATCH NocoDB. Une relecture
   après écriture doit vérifier la personne et la date avant le statut `complete`.

États de `public_preformation_projections` :

| État | Signification et reprise |
|---|---|
| `queued` | Source en attente de vérification/projection. |
| `planning` | Préparation réservée pour 60 secondes ; seul ce travail sans écriture peut être repris avec un nouveau propriétaire. |
| `retryable` | Lecture indisponible avant écriture ; le même envoi peut relancer la préparation à partir de la source et date conservées. |
| `writing` | Une écriture a pu être envoyée ; toute reprise est exclusivement une relecture du plan conservé. |
| `complete` | Personne, dossier et `date_pre_recu` relus conformes ; identifiants et date certifiés enregistrés dans D1. |
| `review` | Cas métier ou écriture incertaine à vérifier explicitement ; aucun nouveau POST/PATCH métier automatique. |

Une configuration changée depuis la capture ne redirige jamais une réponse vers
un autre dossier. Une revendication d'identité incertaine n'est pas libérée par un
timeout. Un cas `review` demande une décision humaine ; aucune nouvelle commande
publique de rattachement ni nouvelle file concurrente de PR38 n'est ajoutée.
La création partage donc le verrou du Worker Google ; le registre local conserve
sa protection supplémentaire entre réponses site. Pour les **mises à jour d’un
adulte existant**, ce registre local ne sérialise pas les PATCH du Worker : les
contrôles PR38 avant/après détectent les conflits observés, mais ne constituent
pas un compare-and-swap NocoDB. Deux canaux écrivant des dates différentes dans
le même intervalle peuvent encore se concurrencer ; ce correctif ne revendique
pas leur sérialisation. Aucun verrou existant n’est expiré ou réinitialisé.

Le catalogue privé montre **« Réception préformation vérifiée sur l'adulte »**
avec la date et le dossier, ou **« Réception préformation en attente — à vérifier »**
avec un motif lisible. D1 fait foi pour ce résultat ; le journal reçoit aussi un
résumé terminal et conserve les annotations antérieures. Une panne du miroir
journal ne transforme pas une réception métier vérifiée en échec ni ne perd sa
preuve. La lecture reste limitée aux 50 dernières réponses publiques existantes ;
ce catalogue n'est pas un historique exhaustif ni une nouvelle file de décisions.

La réponse publique reste uniforme et ne révèle pas si un adulte ou dossier
existe. Les lectures momentanément indisponibles retournent 202 pour permettre la
vérification du même envoi. En cas d'incertitude, le navigateur fige la saisie et
réessaie exactement ce contenu ; aucun stockage navigateur persistant. Hors du
domaine de production, la préversion simule uniquement et ne contacte aucun
stockage, même en présence de secrets.

Origine identique exigée, taille bornée, choix vérifiés, limite de débit D1,
`no-store`, `noindex`, `no-referrer`, aucune lecture publique des réponses et
aucun email. Pas de modification de configuration globale, de moteur Google,
de file PR38, de calendrier ou de disponibilités.

## Vérification locale

```sh
bun run test
bun run build
bun scripts/check-preformation.mjs
bun run test:operational
```

La recette compilée sert uniquement sur la boucle locale, utilise SQLite en
mémoire et intercepte tous les appels NocoDB, sans repli réseau. Elle vérifie
sept largeurs, clavier, champs requis, source conservée, adulte/date vérifiés,
cas d'identité ambigu explicitement en attente, lecture authentifiée et reprise
après perte d'une réponse POST. Captures : `/tmp/euneos-preformation-qa` ou
`CHECK_SCREENSHOTS`. Les tests ciblés couvrent aussi la création autorisée,
concurrence, date figée malgré changement de jour, valeurs contradictoires,
configuration modifiée, interruption après écriture et absence de configuration.
Deux tests exécutent le vrai Worker et la vraie route site sur la même SQLite :
le POST du gagnant est suspendu avant création, le second canal voit toujours
l’adulte absent mais refuse son POST grâce au claim commun. Les deux ordres sont
vérifiés ainsi que la conservation du claim après rejeu ; aucun transport réel.

Le lot n'est ni poussé ni publié. Les conditions d'activation restent : intégration
sur PR38, migration et secret serveur privé par le parent, puis recette autorisée.
L'ancien commit brut sans projection est remplacé et ne doit pas être publié.
