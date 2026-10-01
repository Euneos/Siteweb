# Visuel privé des fiches éditoriales

Livraison locale du 28 septembre 2026 : **un visuel PNG/JPG par fiche éditoriale**, ajouté après l’enregistrement de la fiche. Aperçu local avant envoi, lecture persistante, remplacement explicite et suppression confirmée. Le texte et les commentaires continuent à s’enregistrer séparément. Les fiches équipe et le catalogue ne changent pas.

## Prérequis bloquants pour le parent

Au moment de la préparation, **aucun binding R2 n’existe en preview/production**. Le contrôle du parent sur `GET r2/buckets` renvoie **HTTP 403, code 10042 : « Please enable R2 through Dashboard »**. L’activation R2 attend une décision explicite ; cette PR doit rester en brouillon tant que ce prérequis et la migration ne sont pas préparés. Aucun bucket, binding, abonnement, autorisation ni migration distante n’a été créé par ce chantier.

1. Obtenir la décision explicite sur l’activation R2 dans le Dashboard. Si elle exige une nouvelle offre payante, des coordonnées de paiement ou un contrat non autorisé, **arrêter cette activation**. Ne pas remplacer/élargir automatiquement l’OAuth ; le refus observé concerne l’activation R2. Aucune activation n’est incluse dans cette PR.
2. Créer ou identifier deux buckets R2 **privés et distincts** (preview/production), avec la localisation/juridiction conforme au compte client. Désactiver `r2.dev`, ne configurer ni domaine public ni partage public. Aucun accès S3 ou URL présignée n’est nécessaire au navigateur.
3. Versionner les deux bindings `EDITORIAL_IMAGES` dans `wrangler.toml` avec les **noms réels vérifiés**. Les exemples ci-dessous sont des emplacements à compléter, pas des ressources créées. Ne pas toucher aux bindings D1, variables ni secrets existants. Une configuration ajoutée seulement dans le dashboard peut être remplacée par Wrangler.
4. Vérifier que la base cible possède déjà les migrations `0001` à `0004`, sauvegarder puis appliquer **seulement `0005_editorial_images.sql`**, d’abord en preview. La migration ajoute deux tables et deux triggers, sans modifier les fiches, commentaires, ressources ou heures. Vérifier `PRAGMA foreign_key_check` et les comptes avant/après. Ne jamais rejouer `0003` après `0004`. Le workflow de déploiement n’applique pas les migrations distantes.
5. Maintenir l’application Access **équipe** sur `/interne`, `/interne/*`, `/api/interne/*` pour chaque domaine/alias servi. `/api/interne/images` ne doit pas relever de l’audience bibliothèque/formateurs. Vérifier les refus anonymes sur le domaine principal et l’URL directe Pages, ainsi que les refus de l’audience formateurs, avant d’y mettre un visuel réel.
6. Faire la recette avec des images synthétiques sur la preview isolée. Le parent gère ensuite la validation métier et toute publication autorisée. Ne pas tester dans les fiches réelles de production.

```toml
# Production — noms à remplacer par ceux des buckets privés réellement créés.
[[r2_buckets]]
binding = "EDITORIAL_IMAGES"
bucket_name = "<BUCKET_PRIVE_PRODUCTION>"

# Preview — impérativement distinct.
[[env.preview.r2_buckets]]
binding = "EDITORIAL_IMAGES"
bucket_name = "<BUCKET_PRIVE_PREVIEW>"
```

Sans bucket ou sans migration, la zone de visuel affiche une indisponibilité explicite. Le reste de la fiche fonctionne. Aucun repli vers des images en base64 dans D1, KV ou un hébergeur public n’est activé. Il n’est pas possible d’annoncer cette fonctionnalité opérationnelle en ligne avant ces prérequis.

Références officielles : [bindings R2 de Pages](https://developers.cloudflare.com/pages/functions/bindings/#r2-buckets), [configuration Wrangler Pages](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), [API R2 Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## Accès, format et persistance

- Le JWT signé Access est vérifié côté serveur avant D1/R2, y compris pour chaque lecture binaire. Tous les membres équipe peuvent modifier les visuels éditoriaux, conformément aux droits existants des fiches. Aucun nouveau rôle n’est créé.
- `GET /api/interne/images?entryId=…` retourne la référence courante et sa version indépendante de celle du texte. Avec `imageId=…`, cette route sert uniquement le visuel actuellement attaché à cette fiche. Un ancien UUID ou celui d’une autre fiche retourne 404 ; connaître un UUID ne donne aucun accès.
- `PUT` transmet les octets PNG/JPEG, `DELETE` retire le visuel. Ces méthodes imposent l’origine du site, refusent `Sec-Fetch-Site: cross-site` et exigent `If-Match: "VERSION"`. Une sélection périmée reçoit 409. La version du visuel est conservée après suppression : un ancien onglet ne peut pas recréer silencieusement un visuel après plusieurs modifications.
- Les réponses sont `private, no-store`, `noindex`, `nosniff`, sans CORS public. Les images ne passent ni par le CDN public, ni par `astro:assets`, ni par un journal de requête applicatif.
- Limite de 5 Mio vérifiée pendant la lecture du flux, même sans Content-Length ; maximum 24 millions de pixels et 12 000 pixels par côté. Le navigateur décode puis réencode l’image en normalisant son orientation. Le serveur contrôle le format, les dimensions, les segments JPEG et les chunks/CRC PNG ; les animations PNG transmises directement à l’API sont refusées. Ce contrôle structurel serveur n’est pas un décodeur complet ni un antivirus.
- Les métadonnées EXIF/GPS/XMP/commentaires/texte sont retirées ; les noms originaux ne sont jamais envoyés ni enregistrés. R2 reçoit uniquement `editorial/<UUID aléatoire>`, les pixels et le type MIME. D1 conserve références, dimensions, taille, état technique et date, jamais les octets d’image. Une image peut toujours représenter une personne : les droits d’utilisation du contenu restent à vérifier par l’équipe.
- Le réencodage JPEG utilise une qualité de 92 % ; ce parcours fournit un visuel de travail, pas une archive de l’original. Les PNG animés sont aussi refusés avant décodage dans le navigateur. SVG, PDF et autres pièces jointes ne font pas partie de cette tranche.

## Échecs et nettoyage

Le candidat est inscrit en D1 (`workspace_images`, état `pending`), puis envoyé dans R2. La référence (`workspace_entry_images`) bascule seulement après réussite de R2, par une écriture conditionnelle retournant la version. Les triggers attachent le nouveau visuel et retirent l’ancien dans la même transaction SQL. Le code ne dépend pas du compteur `changes`, dont le traitement des triggers diffère entre adaptateurs.

Les objets `retired` ne sont plus servis. Chaque écriture confirmée tente leur suppression R2 puis celle de leurs métadonnées D1 (10 objets maximum). Une panne laisse une trace à reprendre et une indication dans l’interface ; une prochaine modification reprend le nettoyage. Le contrôle de version empêche aussi un retrait concurrent d’effacer un remplacement plus récent.

Une réponse R2/D1 perdue peut laisser un objet `pending` ou un changement déjà confirmé côté serveur. Aucun nouvel essai automatique et aucune suppression aveugle du candidat : l’interface conserve la sélection, demande une actualisation et permet de vérifier ce qui a réellement été enregistré. La référence active ne pointe jamais volontairement vers un objet dont l’envoi a échoué.

**Reprise opérateur** après incident, sans toucher aux données métier :

1. Lire les états techniques et les références, sans extraire d’images ni de données client :
   ```sql
   SELECT state, COUNT(*) AS count FROM workspace_images GROUP BY state;
   SELECT i.id, i.state, i.created_at
   FROM workspace_images i
   LEFT JOIN workspace_entry_images s ON s.image_id=i.id
   WHERE i.state IN ('pending','retired') AND s.image_id IS NULL;
   ```
2. `retired` peut être repris par la fonction `cleanRetiredImages` avec les bindings du même environnement. Elle supprime R2 avant D1, sans réattacher d’ancien objet.
3. Pour un `pending` ancien, confirmer qu’aucune requête d’ajout n’est encore en cours, puis relire les références. **Ne jamais purger sur la seule ancienneté pendant des écritures actives**. En fenêtre de maintenance, les candidats vérifiés sans référence peuvent être marqués `retired`, puis nettoyés. Une suppression R2 ambiguë reste idempotente. Ne pas supprimer la référence d’un visuel actif pour nettoyer un orphelin.
4. Ne pas appliquer une règle R2 d’expiration générale à `editorial/` : elle supprimerait aussi les visuels actifs. Il n’y a pas de cron de purge dans cette livraison.

Pour revenir au code précédent, conserver le bucket et les tables ; ne pas lancer de rollback destructif. Les fiches et commentaires restent compatibles.

## Validation locale reproductible

```bash
bun run test
bun run build
bun run test:editorial-images
bun scripts/check-internal-workspace.mjs
```

`test:editorial-images` utilise les pages/API réellement compilées, des JWT signés locaux, SQLite en mémoire avec toutes les migrations et un double R2. Il interdit les appels navigateur externes. Les fixtures PNG/JPG sont des formes géométriques synthétiques, sans photographie ni donnée réelle. Les captures à 320/390/860/1440 et `checks.json` vont dans `/tmp/euneos-editorial-images` (ou `CHECK_SCREENSHOTS`). La CI exécute cette recette après le build. Les tests unitaires couvrent aussi les limites, JWT, origines, suppression, conflits et pannes R2/D1 ambiguës.
