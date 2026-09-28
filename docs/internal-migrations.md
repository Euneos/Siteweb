# Migrations D1 des pages internes

Ce circuit concerne uniquement `TEAM_WORKSPACE` et `migrations/interne`. Le registre
des formulaires `FORM_SUBMISSIONS`, NocoDB, R2 et les rôles applicatifs sont hors
périmètre. Il fonctionne avec les seules migrations 0001–0004 : aucune dépendance
à la migration des images ou à un bucket R2.

## État initial et garde-fous

Au 28 septembre 2026, la lecture SELECT/PRAGMA des deux bases a confirmé le schéma
0001–0004, dont `daily_hours`, sans table `d1_migrations`. Les contrôles
`quick_check` et `foreign_key_check` passent. Cette observation n'est pas une
autorisation de rejouer les fichiers : les exports privés et reçus du parent
restent la preuve des applications manuelles antérieures.

**Ne jamais lancer `wrangler d1 migrations apply` sur ces bases.** En particulier,
0003 reconstruit les tables avec une définition antérieure à `daily_hours`.
Le circuit refuse un registre absent/partiel ; il ne tente aucun rattrapage.

| Environnement | Nom                           | ID autorisé                          |
| ------------- | ----------------------------- | ------------------------------------ |
| preview       | euneos-team-workspace-preview | e4d5fb32-d56e-4e37-a589-72cf0e9d4bc5 |
| production    | euneos-team-workspace         | b178cff0-1860-4929-b697-d7152b32b53f |

Les cibles sont fixes et vérifiées contre `wrangler.toml`, qui n'est pas modifié
par ce chantier. Les SQL sont découverts par nom consécutif, sans trous ni doublons.
0001–0004 sont figées dans `scripts/lib/internal-migrations-history.json`. Le
registre natif conserve les noms ; `euneos_migration_hashes` conserve les SHA256.
Toute migration déjà enregistrée doit rester strictement identique.

## Rollout initial — le parent exécute

Effectuer le bootstrap **avant de fusionner ce workflow**. Sans lui, le workflow
s'arrêtera volontairement avant Pages, même pour un changement éditorial simple.
Le worker n'a fait aucune écriture distante, aucun export distant ni publication.

1. Réserver une fenêtre sans migration/déploiement manuel et attendre la fin des
   anciens workflows de publication. Leur ancienne concurrence par branche ne
   partage pas le nouveau verrou. Utiliser le commit livré, intégré au main
   courant et relu. Vérifier les permissions D1 du jeton CI existant : l'accès
   Pages ne prouve pas l'accès D1. Conserver les secrets uniquement dans GitHub.
2. Exporter **chaque base séparément** dans un dossier privé hors dépôt, relever
   son point Time Travel et conserver les exports d'heures avant/après existants.
   Les commandes ci-dessous sont à lancer par le parent avec son accès autorisé.
   Ne pas copier un export client dans un artifact GitHub, le dépôt ou une PR.

   ```sh
   bunx --no-install wrangler d1 export euneos-team-workspace-preview --env preview --remote --output=/chemin/prive/preview-before.sql
   bunx --no-install wrangler d1 time-travel info euneos-team-workspace-preview --env preview --json
   bunx --no-install wrangler d1 export euneos-team-workspace --remote --output=/chemin/prive/production-before.sql
   bunx --no-install wrangler d1 time-travel info euneos-team-workspace --json
   ```

3. Préparer deux lots, **entièrement localement**, avec la liste explicite du
   préfixe dont l'application manuelle est prouvée :

   ```sh
   bun scripts/internal-migrations.mjs list
   bun scripts/internal-migrations.mjs bootstrap --environment preview --dump /chemin/prive/preview-before.sql --out /chemin/prive/preview-bootstrap --names 0001_workspace.sql,0002_programme_status.sql,0003_editorial_statuses.sql,0004_daily_hours.sql
   bun scripts/internal-migrations.mjs bootstrap --environment production --dump /chemin/prive/production-before.sql --out /chemin/prive/production-bootstrap --names 0001_workspace.sql,0002_programme_status.sql,0003_editorial_statuses.sql,0004_daily_hours.sql
   ```

   Le script importe chaque dump dans SQLite en mémoire, compare toutes les
   définitions métier (tables, colonnes, CHECK, défauts, FK, index, triggers) au
   schéma calculé depuis les migrations, vérifie intégrité et FK, applique le
   bootstrap deux fois, puis compare toutes les lignes par empreinte. Il écrit
   deux fichiers privés `.sql` et `.json` en permissions 0600, sans les écraser.
   Il n'appelle pas Cloudflare. Le reçu contient les empreintes du dump, du SQL,
   du schéma et des fichiers, les effectifs et empreintes des données préservées.
   Les dates du registre sont les dates d'adoption, pas des dates historiques
   reconstituées. Les dates natives déjà présentes sont préservées.

4. Relire le SQL et les reçus. Appliquer d'abord le lot preview, puis le lot
   production après relecture preview. Chaque fichier doit être envoyé en
   **un seul lot transactionnel D1**, jamais instruction par instruction.
   Le parent peut utiliser son helper autorisé `/query` avec `{sql: contenu}` ou
   Wrangler `d1 execute --remote --command=<contenu complet>`. Ne pas utiliser
   l'import de fichier : il emprunte un autre transport que celui testé ici.
   Aucun `yes`, `--yes`, approbation automatique ou outil de bootstrap distant
   n'est fourni. La cible et la décision d'application restent au parent.

   Le lot vérifie à nouveau le schéma observé et l'état du registre dans sa
   transaction, puis enregistre uniquement les noms et empreintes. Il ne rejoue
   aucun SQL métier. Le même lot est idempotent sur le même préfixe ; un schéma
   ou registre devenu différent le fait échouer. Il ne peut pas adopter une
   migration ultérieure ajoutée depuis sa préparation.

5. Relire chaque base, exporter après adoption localement et comparer avec les
   exports avant : toutes les données métier, dont `daily_hours`, restent
   identiques. Vérification technique du registre et du schéma :

   ```sh
   bun scripts/internal-migrations.mjs verify --environment preview
   bun scripts/internal-migrations.mjs verify --environment production
   ```

6. Refaire tests/build sur l'intégration à main, puis publier la PR du pipeline
   via le parent. La première CI doit produire les deux reçus sans aucune
   migration métier en attente si seuls 0001–0004 sont présents. Attendre son
   déploiement terminé et vérifier l'espace interne réel avant d'annoncer la
   mise en ligne. Aucun formulaire réel ni email de recette n'est nécessaire.

## Fonctionnement des changements suivants

Les PR passent les tests, le build et les vérifications de rendu **sans secrets
Cloudflare**. Un autre job, uniquement pour une PR du même dépôt ou main, récupère
le build testé. Les PR de forks et Dependabot ne peuvent ni migrer ni déployer.
Ne jamais convertir ce circuit en `pull_request_target` exécutant le code d'un
fork avec les secrets. Les auteurs de branches du dépôt sont des collaborateurs
de confiance ; leurs changements de scripts, SQL et workflows restent à relire.

Un verrou global `euneos-team-workspace-deployment`, sans annulation d'un job en
cours, couvre toute la phase preview → production → Pages. GitHub ne garantit
pas FIFO et peut remplacer un job encore en attente : le circuit revérifie donc
le SHA courant avant les migrations et publications. Une ancienne PR dont main
a avancé doit être synchronisée et revalidée. Un dispatch hors main ne publie pas.

- PR interne : précontrôle, point Time Travel si nécessaire, migrations preview,
  postcontrôle, puis publication de `pr-N`.
- Main : même séquence preview, publication de `validation-main`, puis migrations
  production et publication main. La production exige un reçu preview du même
  plan SHA256, commit, run et tentative. Aucun reçu d'une autre PR n'est réutilisé.
- Chaque migration et son inscription aux deux registres partagent un lot D1
  atomique, via le transport `/query` utilisé par Wrangler. Le lot revérifie le
  schéma et l'ancien registre avant le SQL métier. Deux plans concurrents issus
  du même état ne peuvent pas appliquer deux fois la même modification.
- Toute erreur arrête la publication. Les migrations précédentes déjà validées
  restent appliquées. Après timeout ou réponse perdue, aucune répétition immédiate :
  une nouvelle exécution commence par une relecture du registre et du schéma.
  Un échec Pages après migration se reprend sans rejouer cette migration.

Les reçus CI sont des métadonnées, sans contenu de fiches/commentaires, stockées
30 jours. Le point Time Travel est écrit avant la première mutation et conservé
même en cas d'échec ; les exports complets restent privés chez le parent.
Une restauration n'est jamais automatique : elle remplacerait aussi les données
saisies depuis. Le parent doit arrêter les écritures, réconcilier les nouvelles
données, choisir la restauration ou une correction en avant, puis relire les
deux registres. Un rollback du code exige également de vérifier sa compatibilité
avec les nouveaux statuts et données déjà enregistrés.

## Ajouter une migration, dont 0005 images

Créer `migrations/interne/NNNN_nom.sql`, avec le numéro suivant. Aucun manifeste
supplémentaire à modifier pour une nouvelle migration ; `list` expose le plan et
ses empreintes pour la coordination. `0005_editorial_images.sql` peut arriver
plus tard : le pipeline ne la réclame pas si elle n'est pas dans le commit.
Si le parent l'a déjà appliquée manuellement, l'adopter uniquement avec son reçu
et un nouvel export vérifié, via une liste explicite allant jusqu'à 0005. Le
schéma seul ne prouve pas l'exécution passée d'une migration de données.

Préférer des changements additifs et compatibles avec le code actuellement en
production : la base avance avant le déploiement Pages. Une suppression ou une
transformation incompatible demande une stratégie de transition et des tests
spécifiques. Ne jamais modifier 0001–0004 pour changer un CHECK : écrire une
nouvelle reconstruction qui conserve **toutes** les colonnes, dont `daily_hours`,
et les tables/FK ajoutées depuis (notamment celles des images).

Les triggers `CREATE TRIGGER … BEGIN … END` sont acceptés, y compris plusieurs
instructions et CASE ; les transactions explicites BEGIN/COMMIT, ATTACH, VACUUM,
les écritures sur les registres et les PRAGMA dangereux sont interdits. Les seuls
PRAGMA autorisés sont l'activation/différé des FK et leur contrôle. Une migration
ne doit pas désactiver les contrôles ou gérer elle-même les transactions.

## Vérification locale

```sh
bun test tests/internal-migration-pipeline.test.js
bun scripts/check-internal-migrations-d1.mjs
bun run test
bun run build
```

Le test D1 utilise Wrangler/workerd avec `--local`, configuration fictive et
persistance temporaire détruite en fin de test. Il vérifie l'adoption idempotente,
le refus de rejouer 0003 après les heures quotidiennes, la conservation des
données, les rollbacks SQL et FK, un plan concurrent périmé et la reprise après
commit. Il applique également toutes les futures migrations présentes dans le
checkout sur une fixture peuplée. SQLite est exécuté instruction par instruction
**à l'intérieur d'une seule transaction** pour éviter qu'une erreur intermédiaire
soit masquée par certaines versions de Bun. D1 reçoit toujours le lot entier.

Références : [migrations D1](https://developers.cloudflare.com/d1/reference/migrations/),
[transactions batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[exports privés](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
Le transport a aussi été vérifié dans le Wrangler verrouillé du dépôt :
`buildMigrationQuery`, `executeRemotely` et `executeLocally`.
